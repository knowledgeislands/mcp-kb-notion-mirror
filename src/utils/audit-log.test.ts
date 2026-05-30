import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('appendAuditEvent / withAuditLog (mcp-notion-mirror)', () => {
  const tmpDir = path.join(os.tmpdir(), 'mcp-notion-mirror-audit-log-tests', `run-${process.pid}-${Date.now()}`)
  const logPath = path.join(tmpDir, 'audit.jsonl')

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    vi.resetModules()
    process.env.MCP_NOTION_MIRROR_TOKEN = 'ntn_placeholder'
    process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID = '00000000000000000000000000000000'
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH = logPath
    delete process.env.MCP_NOTION_MIRROR_AUDIT_LOG
    delete process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH
    delete process.env.MCP_NOTION_MIRROR_AUDIT_LOG
    delete process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP
  })

  const flushAsync = () => new Promise((r) => setTimeout(r, 20))

  it('returns the handler verbatim for read-level tools in default writes mode', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('notion_mirror_note_status', 'read', handler)).toBe(handler)
    await handler({})
    await flushAsync()
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('logs write-level tools by default (writes mode)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ kb_path: 'Pillars/x.md', force: false })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.server).toBe('mcp-notion-mirror')
    expect(event.tool).toBe('notion_mirror_note_publish')
    expect(event.level).toBe('write')
    expect(event.ok).toBe(true)
    expect(event.args).toEqual({ kb_path: 'Pillars/x.md', force: false })
  })

  it('logs read-level tools when MCP_NOTION_MIRROR_AUDIT_LOG=all', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_status', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ kb_path: 'Pillars/x.md' })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.tool).toBe('notion_mirror_note_status')
    expect(event.ok).toBe(true)
  })

  it('records ok:false when isError:true', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ isError: true, content: [{ type: 'text', text: 'bad path' }] }))
    await wrapped({})
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('bad path')
  })

  it('records ok:false when the handler throws', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => {
      throw new Error('kaboom')
    })
    await expect(wrapped({})).rejects.toThrow(/kaboom/)
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('kaboom')
  })

  it('stringifies non-Error throws into the audit log', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => {
      throw 'string-throw'
    })
    await expect(wrapped({})).rejects.toBe('string-throw')
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.error).toBe('string-throw')
  })

  it('skips logging entirely when MCP_NOTION_MIRROR_AUDIT_LOG=off', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG = 'off'
    const { withAuditLog } = await import('./audit-log.js')
    const writeHandler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('notion_mirror_note_publish', 'write', writeHandler)).toBe(writeHandler)
    await writeHandler({})
    await flushAsync()
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('rejects unknown MCP_NOTION_MIRROR_AUDIT_LOG at config load', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG = 'sometimes'
    await expect(import('./audit-log.js')).rejects.toThrow(/Invalid MCP_NOTION_MIRROR_AUDIT_LOG/)
  })

  it('returns a non-error result envelope on success', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const result = (await wrapped({})) as { content: Array<{ type: string; text: string }> }
    expect(result.content[0]?.text).toBe('ok')
  })

  it('handles missing content array on isError results', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ isError: true }) as unknown as { content: { type: string; text: string }[] })
    await wrapped({})
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBeUndefined()
  })

  it('chmods the audit log to 0o600 on first write (even if it pre-existed at 0o644)', async () => {
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, '', { mode: 0o644 })
    expect(((await fs.stat(logPath)).mode & 0o777).toString(8)).toBe('644')

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await flushAsync()

    expect(((await fs.stat(logPath)).mode & 0o777).toString(8)).toBe('600')
  })

  it('truncates oversized argument payloads with a _truncated marker', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ blob: 'x'.repeat(8000) })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args._truncated).toBe(true)
    expect(typeof event.args.preview).toBe('string')
  })

  it('rotates the audit log when it exceeds AUDIT_LOG_MAX_BYTES', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES = '64'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ kb_path: 'Pillars/a.md' })
    await flushAsync()
    await wrapped({ kb_path: 'Pillars/b.md' })
    await flushAsync()
    const rotated = await fs.readFile(`${logPath}.1`, 'utf-8')
    expect(rotated.length).toBeGreaterThan(0)
  })

  it('discards the live log when AUDIT_LOG_KEEP=0', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES = '64'
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP = '0'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ kb_path: 'Pillars/a.md' })
    await flushAsync()
    await wrapped({ kb_path: 'Pillars/b.md' })
    await flushAsync()
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
  })

  it('shifts existing rotation slots when rotating', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES = '64'
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP = '3'
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(`${logPath}.1`, 'prior-rotation\n', { mode: 0o600 })

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ kb_path: 'Pillars/a.md' })
    await flushAsync()
    await wrapped({ kb_path: 'Pillars/b.md' })
    await flushAsync()

    const three = await fs.readFile(`${logPath}.3`, 'utf-8')
    expect(three).toBe('prior-rotation\n')
  })

  it('is a no-op when AUDIT_LOG_MAX_BYTES=0 (rotation disabled)', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES = '0'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ kb_path: 'Pillars/a.md' })
    await flushAsync()
    await wrapped({ kb_path: 'Pillars/b.md' })
    await flushAsync()
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
  })

  it('silently absorbs write failures (writes to a non-writable parent)', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH = path.join(tmpDir, 'no-perms', 'audit.jsonl')
    await fs.mkdir(path.dirname(process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH), { recursive: true })
    await fs.chmod(path.dirname(process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH), 0o500)

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('notion_mirror_note_publish', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = (await wrapped({})) as { content: Array<{ type: string; text: string }> }
    expect(result.content[0]?.text).toBe('ok')
    await flushAsync()
    consoleErr.mockRestore()

    await fs.chmod(path.dirname(process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH), 0o700)
  })
})
