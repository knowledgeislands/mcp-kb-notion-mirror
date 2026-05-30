import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESTRUCTIVE_REMOTE, READ_ONLY, WRITE_REMOTE } from './annotations.js'

describe('levelFromAnnotations / makeAccessGatedRegister (mcp-notion-mirror)', () => {
  beforeEach(() => {
    process.env.MCP_NOTION_MIRROR_TOKEN = 'ntn_placeholder'
    process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID = '00000000000000000000000000000000'
    delete process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL
  })

  it('maps READ_ONLY to read', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(READ_ONLY)).toBe('read')
  })

  it('maps WRITE_REMOTE to write', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(WRITE_REMOTE)).toBe('write')
  })

  it('maps DESTRUCTIVE_REMOTE to destructive', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(DESTRUCTIVE_REMOTE)).toBe('destructive')
  })

  it('defaults to destructive (fail-safe) for missing annotations', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(undefined)).toBe('destructive')
  })

  it('rejects an unknown MCP_NOTION_MIRROR_ACCESS_LEVEL at config load', async () => {
    process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL = 'admin'
    await expect(import('../config.js')).rejects.toThrow(/Invalid MCP_NOTION_MIRROR_ACCESS_LEVEL="admin"/)
  })

  const makeStub = () => {
    const calls: string[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: unknown) => calls.push(name) }
    return { calls, stub }
  }

  it('registers read + write but not destructive at gate=write', async () => {
    process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL = 'write'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const { calls, stub } = makeStub()
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('notion_mirror_note_status', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('notion_mirror_note_publish', { title: 't', description: 'd', annotations: WRITE_REMOTE } as never, (async () => ({ content: [] })) as never)
    gated('notion_mirror_note_archive', { title: 't', description: 'd', annotations: DESTRUCTIVE_REMOTE } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual(['notion_mirror_note_status', 'notion_mirror_note_publish'])
  })

  it('registers only read-level tools by default (gate=read)', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const { calls, stub } = makeStub()
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('notion_mirror_note_status', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('notion_mirror_note_publish', { title: 't', description: 'd', annotations: WRITE_REMOTE } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual(['notion_mirror_note_status'])
  })

  it('registers every level when gate=destructive', async () => {
    process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL = 'destructive'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const { calls, stub } = makeStub()
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('notion_mirror_note_status', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('notion_mirror_note_publish', { title: 't', description: 'd', annotations: WRITE_REMOTE } as never, (async () => ({ content: [] })) as never)
    gated('notion_mirror_note_archive', { title: 't', description: 'd', annotations: DESTRUCTIVE_REMOTE } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual(['notion_mirror_note_status', 'notion_mirror_note_publish', 'notion_mirror_note_archive'])
  })

  it('treats an unannotated tool as destructive (fail-safe — skipped under default gate=write)', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const { calls, stub } = makeStub()
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('unannotated_tool', { title: 't', description: 'd' } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual([])
  })
})
