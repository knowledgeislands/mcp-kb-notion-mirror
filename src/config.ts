import * as os from 'node:os'
import * as path from 'node:path'

const expandHome = (p: string): string => {
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

try {
  process.loadEnvFile(`./.env.${process.env.NODE_ENV}`)
} catch {
  // no .env present — that's fine
}

const requireEnv = (name: string, hint: string): string => {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') {
    throw new Error(`${name} is required but not set. ${hint}`)
  }
  return v.trim()
}

/**
 * Notion internal-integration secret (`ntn_…`). The integration must have
 * Read / Insert content / Update content capabilities AND be explicitly
 * Connected to the target wiki page in the Notion UI (Connections menu).
 *
 * Treat it like a password — it grants write access to every page the
 * integration is connected to. It must never appear in logs, errors, or tool
 * output (see SECURITY.md).
 */
export const NOTION_TOKEN: string = requireEnv(
  'MCP_NOTION_MIRROR_TOKEN',
  'Create a Notion internal integration, grant it Insert + Update content, connect it to the target wiki, and copy its secret (ntn_…) here.'
)

/**
 * The Notion wiki database (data source) ID that new mirror pages are created
 * inside. For HNR's current target: 36f9f7187cc280f69272e60aa89bff24.
 */
export const WIKI_DATABASE_ID: string = requireEnv(
  'MCP_NOTION_MIRROR_WIKI_DATABASE_ID',
  'Set it to the Notion wiki database id mirror pages should be created in (the 32-hex id from the database URL).'
)

export const NOTION_API_BASE_URL: string = (process.env.MCP_NOTION_MIRROR_API_BASE_URL ?? 'https://api.notion.com').replace(/\/+$/, '')

/**
 * Notion does not version the API via the URL — every call carries this header
 * instead. Bump this single constant when Notion releases a new stable date.
 */
export const NOTION_API_VERSION = '2022-06-28'

/**
 * Absolute path to the KB root that contains `Pillars/`. Optional: when unset,
 * `kb_path` arguments must be absolute (relative paths are rejected with a
 * clear error). When set, `kb_path` is resolved against it and confined to
 * `<KB_ROOT>/Pillars/`.
 */
export const KB_ROOT: string | undefined = (() => {
  const raw = process.env.MCP_NOTION_MIRROR_KB_ROOT?.trim()
  if (raw === undefined || raw === '') return undefined
  return path.resolve(expandHome(raw))
})()

/**
 * Override the trailing sentence of the mirrored-from-KB banner (the part after
 * the bold "Mirrored from Knowledge Base on <date>" prefix). The runtime date in
 * the bold prefix is always authoritative regardless of this value.
 */
export const BANNER_TEXT: string | undefined = (() => {
  const raw = process.env.MCP_NOTION_MIRROR_BANNER_TEXT
  if (raw === undefined || raw.trim() === '') return undefined
  return raw
})()

/**
 * Single ordinal access level — matches the sibling MCPs. Each level implies
 * all lower ones:
 *   `read`        — only readOnly tools registered (status, list).
 *   `write`       — readOnly + non-destructive mutations (publish).
 *   `destructive` — everything, including archive.
 *
 * Default is `read` (fail-safe, like the rest of the family): publishing mutates
 * both the Notion wiki and the local KB note, so it must be opted into with
 * `write`; archive additionally requires `destructive`. In practice this MCP is
 * configured with `write`.
 */
export type AccessLevel = 'read' | 'write' | 'destructive'
export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'write', 'destructive'] as const
export const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = { read: 1, write: 2, destructive: 3 }

const parseAccessLevel = (raw: string | undefined): AccessLevel => {
  const v = raw?.trim()
  if (v === undefined || v === '') return 'read'
  if ((ACCESS_LEVELS as readonly string[]).includes(v)) return v as AccessLevel
  throw new Error(`Invalid MCP_NOTION_MIRROR_ACCESS_LEVEL="${raw}". Allowed: ${ACCESS_LEVELS.join(', ')}`)
}

export const ACCESS_LEVEL: AccessLevel = parseAccessLevel(process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL)

export const AUDIT_LOG_PATH: string = path.resolve(expandHome(process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH ?? path.join(os.homedir(), '.local', 'state', 'mcp-notion-mirror', 'audit.jsonl')))

export type AuditLogMode = 'off' | 'writes' | 'all'

const parseAuditLogMode = (raw: string | undefined): AuditLogMode => {
  const v = raw?.trim().toLowerCase()
  if (v === undefined || v === '') return 'writes'
  if (v === 'off' || v === 'writes' || v === 'all') return v
  throw new Error(`Invalid MCP_NOTION_MIRROR_AUDIT_LOG="${raw}" — expected one of: off, writes, all.`)
}

export const AUDIT_LOG_MODE: AuditLogMode = parseAuditLogMode(process.env.MCP_NOTION_MIRROR_AUDIT_LOG)

const parseNonNegativeInt = (raw: string | undefined, fallback: number, varName: string): number => {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${varName}="${raw}" — expected a non-negative integer.`)
  }
  return n
}
export const AUDIT_LOG_MAX_BYTES: number = parseNonNegativeInt(process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES, 10 * 1024 * 1024, 'MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES')
export const AUDIT_LOG_KEEP: number = parseNonNegativeInt(process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP, 5, 'MCP_NOTION_MIRROR_AUDIT_LOG_KEEP')
