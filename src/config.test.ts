import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEYS = [
  'MCP_NOTION_MIRROR_TOKEN',
  'MCP_NOTION_MIRROR_WIKI_DATABASE_ID',
  'MCP_NOTION_MIRROR_API_BASE_URL',
  'MCP_NOTION_MIRROR_KB_ROOT',
  'MCP_NOTION_MIRROR_BANNER_TEXT',
  'MCP_NOTION_MIRROR_ACCESS_LEVEL',
  'MCP_NOTION_MIRROR_AUDIT_LOG',
  'MCP_NOTION_MIRROR_AUDIT_LOG_PATH',
  'MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES',
  'MCP_NOTION_MIRROR_AUDIT_LOG_KEEP'
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  // Re-seed the required vars so module evaluation succeeds; tests override.
  for (const k of KEYS) delete process.env[k]
  process.env.MCP_NOTION_MIRROR_TOKEN = 'ntn_placeholder'
  process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID = '00000000000000000000000000000000'
  vi.resetModules()
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('NOTION_TOKEN', () => {
  it('reads the token from env', async () => {
    process.env.MCP_NOTION_MIRROR_TOKEN = 'ntn_abc'
    const { NOTION_TOKEN } = await import('./config.js')
    expect(NOTION_TOKEN).toBe('ntn_abc')
  })

  it('throws when unset', async () => {
    delete process.env.MCP_NOTION_MIRROR_TOKEN
    await expect(import('./config.js')).rejects.toThrow(/MCP_NOTION_MIRROR_TOKEN is required/)
  })

  it('throws when blank', async () => {
    process.env.MCP_NOTION_MIRROR_TOKEN = '   '
    await expect(import('./config.js')).rejects.toThrow(/MCP_NOTION_MIRROR_TOKEN is required/)
  })

  it('trims whitespace', async () => {
    process.env.MCP_NOTION_MIRROR_TOKEN = '  ntn_abc  '
    const { NOTION_TOKEN } = await import('./config.js')
    expect(NOTION_TOKEN).toBe('ntn_abc')
  })
})

describe('WIKI_DATABASE_ID', () => {
  it('reads the database id from env', async () => {
    process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID = '36f9f7187cc280f69272e60aa89bff24'
    const { WIKI_DATABASE_ID } = await import('./config.js')
    expect(WIKI_DATABASE_ID).toBe('36f9f7187cc280f69272e60aa89bff24')
  })

  it('throws when unset', async () => {
    delete process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID
    await expect(import('./config.js')).rejects.toThrow(/MCP_NOTION_MIRROR_WIKI_DATABASE_ID is required/)
  })
})

describe('NOTION_API_BASE_URL + version', () => {
  it('defaults to https://api.notion.com', async () => {
    const { NOTION_API_BASE_URL } = await import('./config.js')
    expect(NOTION_API_BASE_URL).toBe('https://api.notion.com')
  })

  it('respects the override and strips trailing slashes', async () => {
    process.env.MCP_NOTION_MIRROR_API_BASE_URL = 'https://example.test///'
    const { NOTION_API_BASE_URL } = await import('./config.js')
    expect(NOTION_API_BASE_URL).toBe('https://example.test')
  })

  it('pins the Notion API version', async () => {
    const { NOTION_API_VERSION } = await import('./config.js')
    expect(NOTION_API_VERSION).toBe('2022-06-28')
  })
})

describe('KB_ROOT', () => {
  it('is undefined when unset', async () => {
    const { KB_ROOT } = await import('./config.js')
    expect(KB_ROOT).toBeUndefined()
  })

  it('is undefined when blank', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = '  '
    const { KB_ROOT } = await import('./config.js')
    expect(KB_ROOT).toBeUndefined()
  })

  it('resolves and expands ~ in the path', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = '~/kb'
    const { KB_ROOT } = await import('./config.js')
    expect(KB_ROOT).toBe(path.join(os.homedir(), 'kb'))
  })

  it('expands a bare ~', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = '~'
    const { KB_ROOT } = await import('./config.js')
    expect(KB_ROOT).toBe(os.homedir())
  })

  it('passes absolute paths through', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = '/tmp/kb'
    const { KB_ROOT } = await import('./config.js')
    expect(KB_ROOT).toBe('/tmp/kb')
  })
})

describe('BANNER_TEXT', () => {
  it('is undefined when unset', async () => {
    const { BANNER_TEXT } = await import('./config.js')
    expect(BANNER_TEXT).toBeUndefined()
  })

  it('is undefined when blank', async () => {
    process.env.MCP_NOTION_MIRROR_BANNER_TEXT = '   '
    const { BANNER_TEXT } = await import('./config.js')
    expect(BANNER_TEXT).toBeUndefined()
  })

  it('passes a custom string through verbatim', async () => {
    process.env.MCP_NOTION_MIRROR_BANNER_TEXT = ' — see internal docs.'
    const { BANNER_TEXT } = await import('./config.js')
    expect(BANNER_TEXT).toBe(' — see internal docs.')
  })
})

describe('ACCESS_LEVEL', () => {
  it('defaults to read when unset', async () => {
    const { ACCESS_LEVEL } = await import('./config.js')
    expect(ACCESS_LEVEL).toBe('read')
  })

  it('defaults to read when blank', async () => {
    process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL = '  '
    const { ACCESS_LEVEL } = await import('./config.js')
    expect(ACCESS_LEVEL).toBe('read')
  })

  it.each(['read', 'write', 'destructive'] as const)('accepts %s', async (level) => {
    process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL = level
    const { ACCESS_LEVEL } = await import('./config.js')
    expect(ACCESS_LEVEL).toBe(level)
  })

  it('throws on an unknown value', async () => {
    process.env.MCP_NOTION_MIRROR_ACCESS_LEVEL = 'admin'
    await expect(import('./config.js')).rejects.toThrow(/Invalid MCP_NOTION_MIRROR_ACCESS_LEVEL="admin"/)
  })
})

describe('AUDIT_LOG_MODE', () => {
  it('defaults to writes', async () => {
    const { AUDIT_LOG_MODE } = await import('./config.js')
    expect(AUDIT_LOG_MODE).toBe('writes')
  })

  it('defaults to writes when blank', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG = '  '
    const { AUDIT_LOG_MODE } = await import('./config.js')
    expect(AUDIT_LOG_MODE).toBe('writes')
  })

  it.each(['off', 'writes', 'all'] as const)('accepts %s', async (mode) => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG = mode
    const { AUDIT_LOG_MODE } = await import('./config.js')
    expect(AUDIT_LOG_MODE).toBe(mode)
  })

  it('throws on an unknown value', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG = 'sometimes'
    await expect(import('./config.js')).rejects.toThrow(/Invalid MCP_NOTION_MIRROR_AUDIT_LOG/)
  })
})

describe('AUDIT_LOG_PATH', () => {
  it('defaults to ~/.local/state/mcp-notion-mirror/audit.jsonl', async () => {
    const { AUDIT_LOG_PATH } = await import('./config.js')
    expect(AUDIT_LOG_PATH).toBe(path.join(os.homedir(), '.local', 'state', 'mcp-notion-mirror', 'audit.jsonl'))
  })

  it('expands a bare ~ in the override', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH = '~'
    const { AUDIT_LOG_PATH } = await import('./config.js')
    expect(AUDIT_LOG_PATH).toBe(os.homedir())
  })

  it('expands ~/foo in the override', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH = '~/foo/audit.jsonl'
    const { AUDIT_LOG_PATH } = await import('./config.js')
    expect(AUDIT_LOG_PATH).toBe(path.join(os.homedir(), 'foo', 'audit.jsonl'))
  })

  it('passes absolute paths through unchanged', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_PATH = '/tmp/audit.jsonl'
    const { AUDIT_LOG_PATH } = await import('./config.js')
    expect(AUDIT_LOG_PATH).toBe('/tmp/audit.jsonl')
  })
})

describe('AUDIT_LOG_MAX_BYTES / AUDIT_LOG_KEEP', () => {
  it('use sensible defaults when unset', async () => {
    const { AUDIT_LOG_MAX_BYTES, AUDIT_LOG_KEEP } = await import('./config.js')
    expect(AUDIT_LOG_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(AUDIT_LOG_KEEP).toBe(5)
  })

  it('use defaults when blank', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES = '  '
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP = '  '
    const { AUDIT_LOG_MAX_BYTES, AUDIT_LOG_KEEP } = await import('./config.js')
    expect(AUDIT_LOG_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(AUDIT_LOG_KEEP).toBe(5)
  })

  it('accept non-negative ints', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES = '0'
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP = '3'
    const { AUDIT_LOG_MAX_BYTES, AUDIT_LOG_KEEP } = await import('./config.js')
    expect(AUDIT_LOG_MAX_BYTES).toBe(0)
    expect(AUDIT_LOG_KEEP).toBe(3)
  })

  it('throws on a negative value', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES = '-1'
    await expect(import('./config.js')).rejects.toThrow(/MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES/)
  })

  it('throws on a non-numeric value', async () => {
    process.env.MCP_NOTION_MIRROR_AUDIT_LOG_KEEP = 'lots'
    await expect(import('./config.js')).rejects.toThrow(/MCP_NOTION_MIRROR_AUDIT_LOG_KEEP/)
  })
})
