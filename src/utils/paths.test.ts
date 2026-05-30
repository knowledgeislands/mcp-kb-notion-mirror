import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let kbRoot: string
let pillars: string

const seedRequired = () => {
  process.env.MCP_NOTION_MIRROR_TOKEN = 'ntn_placeholder'
  process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID = '00000000000000000000000000000000'
}

const importPaths = () => import('./paths.js')
const real = (p: string) => fs.realpathSync(p)

beforeEach(async () => {
  kbRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-notion-mirror-paths-'))
  pillars = path.join(kbRoot, 'Pillars')
  await fsp.mkdir(path.join(pillars, 'sub'), { recursive: true })
  await fsp.writeFile(path.join(pillars, 'sub', 'note.md'), 'x')
  vi.resetModules()
  seedRequired()
})

afterEach(async () => {
  await fsp.rm(kbRoot, { recursive: true, force: true })
  delete process.env.MCP_NOTION_MIRROR_KB_ROOT
})

describe('resolveKbNotePath (KB_ROOT set)', () => {
  beforeEach(() => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = kbRoot
    vi.resetModules()
  })

  it('resolves a relative path under Pillars to the note realpath', async () => {
    const { resolveKbNotePath } = await importPaths()
    expect(resolveKbNotePath('Pillars/sub/note.md')).toBe(real(path.join(pillars, 'sub', 'note.md')))
  })

  it('accepts an absolute path under Pillars', async () => {
    const { resolveKbNotePath } = await importPaths()
    expect(resolveKbNotePath(path.join(pillars, 'sub', 'note.md'))).toBe(real(path.join(pillars, 'sub', 'note.md')))
  })

  it('rejects ".." segments', async () => {
    const { resolveKbNotePath, KbPathError } = await importPaths()
    expect(() => resolveKbNotePath('Pillars/../etc/passwd')).toThrow(KbPathError)
  })

  it('rejects an empty path', async () => {
    const { resolveKbNotePath, KbPathError } = await importPaths()
    expect(() => resolveKbNotePath('   ')).toThrow(KbPathError)
  })

  it('rejects an absolute path outside Pillars (lexical confinement)', async () => {
    const { resolveKbNotePath } = await importPaths()
    expect(() => resolveKbNotePath('/etc/hosts')).toThrow(/escapes the allowed KB root/)
  })

  it('rejects a symlink that escapes Pillars (realpath confinement)', async () => {
    const outside = path.join(kbRoot, 'outside')
    await fsp.mkdir(outside, { recursive: true })
    await fsp.symlink(outside, path.join(pillars, 'link'))
    const { resolveKbNotePath } = await importPaths()
    expect(() => resolveKbNotePath('Pillars/link/escaped.md')).toThrow(/escapes the allowed KB root/)
  })
})

describe('resolveKbNotePath (KB_ROOT unset)', () => {
  it('rejects a relative path', async () => {
    const { resolveKbNotePath, KbPathError } = await importPaths()
    expect(() => resolveKbNotePath('Pillars/sub/note.md')).toThrow(KbPathError)
  })

  it('accepts an absolute path (no Pillars confinement)', async () => {
    const { resolveKbNotePath } = await importPaths()
    const abs = path.join(pillars, 'sub', 'note.md')
    expect(resolveKbNotePath(abs)).toBe(real(abs))
  })

  it('still rejects ".." segments', async () => {
    const { resolveKbNotePath, KbPathError } = await importPaths()
    expect(() => resolveKbNotePath('/a/../b')).toThrow(KbPathError)
  })
})

describe('resolvePillarsRoot', () => {
  it('defaults to KB_ROOT/Pillars when no arg is given', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = kbRoot
    vi.resetModules()
    const { resolvePillarsRoot } = await importPaths()
    expect(resolvePillarsRoot()).toBe(real(pillars))
  })

  it('accepts an explicit root equal to KB_ROOT', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = kbRoot
    vi.resetModules()
    const { resolvePillarsRoot } = await importPaths()
    expect(resolvePillarsRoot(kbRoot)).toBe(real(pillars))
  })

  it('rejects a root with ".." segments', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = kbRoot
    vi.resetModules()
    const { resolvePillarsRoot, KbPathError } = await importPaths()
    expect(() => resolvePillarsRoot('/a/../b')).toThrow(KbPathError)
  })

  it('rejects a relative root', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = kbRoot
    vi.resetModules()
    const { resolvePillarsRoot } = await importPaths()
    expect(() => resolvePillarsRoot('relative/root')).toThrow(/must be an absolute path/)
  })

  it('rejects a root outside KB_ROOT', async () => {
    process.env.MCP_NOTION_MIRROR_KB_ROOT = kbRoot
    vi.resetModules()
    const { resolvePillarsRoot } = await importPaths()
    const other = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-notion-mirror-other-'))
    try {
      expect(() => resolvePillarsRoot(other)).toThrow(/escapes the allowed KB root/)
    } finally {
      await fsp.rm(other, { recursive: true, force: true })
    }
  })

  it('throws when no root is given and KB_ROOT is unset', async () => {
    const { resolvePillarsRoot, KbPathError } = await importPaths()
    expect(() => resolvePillarsRoot()).toThrow(KbPathError)
  })

  it('accepts an absolute root when KB_ROOT is unset (no confinement)', async () => {
    const { resolvePillarsRoot } = await importPaths()
    expect(resolvePillarsRoot(kbRoot)).toBe(real(pillars))
  })
})
