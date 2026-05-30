/**
 * Append-only JSONL audit log for tool invocations. Mirrors the sibling MCPs:
 * scope is controlled by MCP_NOTION_MIRROR_AUDIT_LOG (`off` / `writes` /
 * `all`), level is derived from each tool's MCP annotations, path defaults to
 * ~/.local/state/mcp-notion-mirror/audit.jsonl.
 *
 * Only the tool args are recorded — never the Notion token (it lives in env,
 * not in any tool argument). Failures to write the audit line are swallowed
 * (stderr only) — a broken log must never prevent a tool call from completing.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { type AccessLevel, AUDIT_LOG_KEEP, AUDIT_LOG_MAX_BYTES, AUDIT_LOG_MODE, AUDIT_LOG_PATH } from '../config.js'

export interface AuditEvent {
  ts: string
  server: string
  tool: string
  level: AccessLevel
  ok: boolean
  duration_ms: number
  error?: string
  args: unknown
}

const SERVER_NAME = 'mcp-notion-mirror'
const MAX_ARG_CHARS = 4096

const sanitizeArgs = (args: unknown): unknown => {
  const serialized = JSON.stringify(args)
  if (serialized.length > MAX_ARG_CHARS) {
    return { _truncated: true, preview: serialized.slice(0, MAX_ARG_CHARS) }
  }
  return args
}

let chmodEnsured = false

const rotateIfNeeded = async (): Promise<void> => {
  if (AUDIT_LOG_MAX_BYTES === 0) return
  let size: number
  try {
    size = (await fs.stat(AUDIT_LOG_PATH)).size
  } catch {
    /* v8 ignore next 2 — file disappeared between appendFile and stat; nothing to rotate */
    return
  }
  if (size <= AUDIT_LOG_MAX_BYTES) return
  try {
    if (AUDIT_LOG_KEEP > 0) {
      await fs.rm(`${AUDIT_LOG_PATH}.${AUDIT_LOG_KEEP}`, { force: true })
      for (let i = AUDIT_LOG_KEEP - 1; i >= 1; i--) {
        try {
          await fs.rename(`${AUDIT_LOG_PATH}.${i}`, `${AUDIT_LOG_PATH}.${i + 1}`)
        } catch {
          // missing slot — fine, rotation history may not be full yet
        }
      }
      await fs.rename(AUDIT_LOG_PATH, `${AUDIT_LOG_PATH}.1`)
    } else {
      await fs.rm(AUDIT_LOG_PATH, { force: true })
    }
  } catch (err) {
    /* v8 ignore next 2 — outer rename failure is unreachable from a single-process test (every per-slot rename has its own try/catch) */
    console.error(`[audit-log] rotation failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const writeAuditEvent = async (event: AuditEvent): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true })
    await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', mode: 0o600 })
    if (!chmodEnsured) {
      try {
        await fs.chmod(AUDIT_LOG_PATH, 0o600)
      } catch {
        // best-effort — log may have been rotated/removed between write and chmod
      }
      chmodEnsured = true
    }
    await rotateIfNeeded()
  } catch (err) {
    /* v8 ignore next — fs.* always rejects with an Error, so the String(err) fallback is unreachable in practice */
    console.error(`[audit-log] failed to write: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Serialize appends through a single chain so concurrent callers can't race on
// the append → stat → rotate sequence (two simultaneous rotations would have
// one `rename(live → .1)` lose with ENOENT). Each call awaits the prior one;
// errors are swallowed inside writeAuditEvent so the chain never rejects.
let auditQueue: Promise<void> = Promise.resolve()

export const appendAuditEvent = (event: AuditEvent): Promise<void> => {
  auditQueue = auditQueue.then(() => writeAuditEvent(event))
  return auditQueue
}

type ToolCallback = (...callbackArgs: unknown[]) => unknown | Promise<unknown>

const extractErrorText = (result: unknown): string | undefined => {
  const content = (result as { content?: { type: string; text: string }[] }).content
  if (!Array.isArray(content)) return undefined
  const first = content.find((c) => c.type === 'text')
  return first?.text
}

export const withAuditLog = (toolName: string, level: AccessLevel, callback: ToolCallback): ToolCallback => {
  if (AUDIT_LOG_MODE === 'off') return callback
  if (level === 'read' && AUDIT_LOG_MODE !== 'all') return callback
  return async (...callbackArgs: unknown[]) => {
    const start = Date.now()
    const args = callbackArgs[0]
    try {
      const result = await callback(...callbackArgs)
      const isError = typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
      const errText = isError ? extractErrorText(result) : undefined
      void appendAuditEvent({
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        level,
        ok: !isError,
        duration_ms: Date.now() - start,
        error: errText,
        args: sanitizeArgs(args)
      })
      return result
    } catch (err) {
      void appendAuditEvent({
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        level,
        ok: false,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        args: sanitizeArgs(args)
      })
      throw err
    }
  }
}
