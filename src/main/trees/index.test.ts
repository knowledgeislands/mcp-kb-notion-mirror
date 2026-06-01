/**
 * Tests for the tree verbs (statusTree / preflightTree / touchTree / updateTree
 * / deleteTree / publishTreeNote). A temp KB fixture + a mocked Notion `fetch`
 * (vi.stubGlobal) + injected Config/settings/parent literals exercise every
 * outcome: touch, update, delete, skip, plan, error, the single-note ancestor
 * chain, preflight issues, and status counts.
 *
 * Fixtures use a synthetic Greek scheme (Alpha/Beta/Gamma…), never real KB names.
 * Asserts there is NO stdout/stderr output from the tree layer.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Config, DEFAULT_BANNER_TEMPLATE } from '../../config/index.js'
import { _clearTitlePropertyCache } from '../notes/title-property.js'
import type { NotionParent } from '../notion-client/index.js'
import { baselineTree, deleteTree, preflightTree, publishTreeNote, statusTree, touchTree, updateTree } from './index.js'
import type { MirrorSettings } from './settings.js'

const DB_ID = '36f9f7187cc280f69272e60aa89bff24'
const ROOT_PARENT: NotionParent = { type: 'database_id', database_id: DB_ID }
const SUBTREE = 'Alpha'

const DB_RESPONSE = { properties: { Name: { id: 'p', type: 'title' } } }
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

const pageResponse = (hex: string) => ({
  id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  url: `https://www.notion.so/Note-${hex}`,
  created_time: '2026-05-30T01:13:00.000Z',
  last_edited_time: '2026-05-30T02:00:00.000Z',
  archived: false,
  parent: ROOT_PARENT,
  properties: { Name: { type: 'title', title: [{ plain_text: 'Note' }] } }
})

const fm = (fields: Record<string, string>): string => {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n# title\n\nbody.\n`
}

const settings = (overrides: Partial<MirrorSettings> = {}): MirrorSettings => ({
  skipPrefixes: ['+'],
  skipKbPaths: new Set<string>(),
  iconBaseUrl: 'https://unpkg.com/lucide-static@latest/icons',
  ...overrides
})

describe('tree verbs', () => {
  let kbRoot: string
  let cfg: Config
  let s: MirrorSettings
  let fetchMock: ReturnType<typeof vi.fn>
  let logSpy: ReturnType<typeof vi.spyOn>
  let errSpy: ReturnType<typeof vi.spyOn>

  const write = async (rel: string, content: string): Promise<void> => {
    const abs = path.join(kbRoot, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content)
  }
  const read = (rel: string): Promise<string> => fsp.readFile(path.join(kbRoot, rel), 'utf-8')

  // Stateful Notion stub: POST /v1/pages mints a fresh page whose id is a
  // counter and remembers the parent it was created under; GET/PATCH echo that
  // recorded parent so the cross-parent-type guard never false-fires.
  let pageCounter: number
  const parentByHex = new Map<string, unknown>()
  const routeHappy = (): void => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET'
      if (url.includes('/v1/databases/')) return ok(DB_RESPONSE)
      if (url.endsWith('/v1/pages') && method === 'POST') {
        const hex = (pageCounter++).toString(16).padStart(32, '0')
        const reqParent = init?.body ? (JSON.parse(init.body) as { parent: unknown }).parent : ROOT_PARENT
        parentByHex.set(hex, reqParent)
        return ok({ ...pageResponse(hex), parent: reqParent })
      }
      const m = url.match(/\/v1\/pages\/([a-f0-9]{32})$/)
      if (m && (method === 'GET' || method === 'PATCH')) {
        const hex = m[1] as string
        return ok({ ...pageResponse(hex), parent: parentByHex.get(hex) ?? ROOT_PARENT })
      }
      if (url.includes('/children') && method === 'GET') return ok({ results: [], has_more: false, next_cursor: null })
      return ok({ results: [{ id: 'x' }] })
    })
  }

  beforeEach(async () => {
    kbRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-kb-notion-mirror-tree-'))
    cfg = {
      notionToken: 'ntn_secrettoken',
      notionApiBaseUrl: 'https://api.notion.test',
      notionApiVersion: '2022-06-28',
      kbRoot,
      bannerTemplate: DEFAULT_BANNER_TEMPLATE,
      accessLevel: 'destructive',
      auditLogMode: 'off',
      auditLogPath: '',
      auditLogMaxBytes: 0,
      auditLogKeep: 0
    }
    s = settings()
    pageCounter = 1
    parentByHex.clear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    _clearTitlePropertyCache()
  })

  afterEach(async () => {
    // The whole point: nothing in the tree layer writes to stdout/stderr.
    expect(logSpy).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await fsp.rm(kbRoot, { recursive: true, force: true })
  })

  describe('preflightTree', () => {
    it('reports no issues when every folder with notes has an index', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Beta/Beta.md', fm({}))
      await write('Alpha/Beta/Gamma.md', fm({}))
      expect(preflightTree(kbRoot, SUBTREE, s)).toEqual({ issues: [] })
    })

    it('flags a sub-folder that has notes but no folder index', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Beta/Gamma.md', fm({})) // no Beta/Beta.md
      expect(preflightTree(kbRoot, SUBTREE, s).issues).toEqual(['Missing folder index: Alpha/Beta/Beta.md'])
    })
  })

  describe('statusTree', () => {
    it('counts published vs pending, ordered like a tree op', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: `https://www.notion.so/A-${'a'.repeat(32)}` }))
      await write('Alpha/Leaf.md', fm({}))
      expect(statusTree(kbRoot, SUBTREE, s)).toEqual({
        total: 2,
        published: 1,
        pending: 1,
        notes: [
          { kbPath: 'Alpha/Alpha.md', published: true },
          { kbPath: 'Alpha/Leaf.md', published: false }
        ]
      })
    })
  })

  describe('touchTree', () => {
    it('throws when kbRoot is unset', async () => {
      await expect(touchTree({ ...cfg, kbRoot: undefined }, SUBTREE, ROOT_PARENT, s)).rejects.toThrow(/MCP_KB_NOTION_MIRROR_KB_ROOT must be set/)
    })

    it('scaffolds every note and writes URLs back', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Leaf.md', fm({}))
      routeHappy()
      const res = await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.eligible).toBe(2)
      expect(res.outcomes.map((o) => o.action)).toEqual(['touch', 'touch'])
      expect(await read('Alpha/Alpha.md')).toMatch(/kb_notion_mirror_url:/)
    })

    it('skips an already-mirrored note', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: `https://www.notion.so/A-${'a'.repeat(32)}` }))
      routeHappy()
      const res = await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.outcomes[0]).toMatchObject({ action: 'skip' })
    })

    it('records an error when a parent index is unresolvable', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Sub/Stray.md', fm({})) // no Sub/Sub.md index
      routeHappy()
      const res = await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.outcomes[0]).toMatchObject({ action: 'touch' })
      expect(res.outcomes[1]).toMatchObject({ action: 'error' })
      expect(res.outcomes[1]?.error).toMatch(/required parent index not yet published/)
    })

    it('records an error when touchNote throws (no frontmatter)', async () => {
      await fsp.mkdir(path.join(kbRoot, SUBTREE), { recursive: true })
      await fsp.writeFile(path.join(kbRoot, SUBTREE, 'Alpha.md'), 'no frontmatter\n')
      routeHappy()
      const res = await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.outcomes[0]).toMatchObject({ action: 'error' })
      expect(res.outcomes[0]?.error).toMatch(/no YAML frontmatter/)
    })

    it('walks the ancestor chain for a deep leaf', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Beta/Beta.md', fm({}))
      await write('Alpha/Beta/Gamma.md', fm({}))
      routeHappy()
      const res = await touchTree(cfg, SUBTREE, ROOT_PARENT, s, 'Alpha/Beta/Gamma.md')
      expect(res.outcomes.map((o) => o.kbPath)).toEqual(['Alpha/Alpha.md', 'Alpha/Beta/Beta.md', 'Alpha/Beta/Gamma.md'])
    })

    it('throws when the target note is not discoverable', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await expect(touchTree(cfg, SUBTREE, ROOT_PARENT, s, 'Alpha/Nope.md')).rejects.toThrow(/Not a discoverable/)
    })
  })

  describe('updateTree', () => {
    it('pushes bodies for touched notes (default link map)', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Leaf.md', fm({}))
      routeHappy()
      await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      const res = await updateTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.outcomes.map((o) => o.action)).toEqual(['update', 'update'])
    })

    it('accepts an explicit link map (cross-root resolution)', async () => {
      await write('Alpha/Alpha.md', fm({}))
      routeHappy()
      await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      const res = await updateTree(cfg, SUBTREE, ROOT_PARENT, s, { linkMap: { Other: `https://www.notion.so/O-${'b'.repeat(32)}` } })
      expect(res.outcomes[0]).toMatchObject({ action: 'update' })
    })

    it('skips a note that was never touched', async () => {
      await write('Alpha/Alpha.md', fm({}))
      const res = await updateTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.outcomes[0]).toMatchObject({ action: 'skip', error: 'not yet touched — run touch first' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('records an error when a parent index is unresolvable', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Beta/Beta.md', fm({}))
      await write('Alpha/Beta/Gamma.md', fm({ kb_notion_mirror_url: `https://www.notion.so/G-${'a'.repeat(32)}` }))
      const res = await updateTree(cfg, SUBTREE, ROOT_PARENT, s)
      const gamma = res.outcomes.find((o) => o.kbPath === 'Alpha/Beta/Gamma.md')
      expect(gamma).toMatchObject({ action: 'error' })
      expect(gamma?.error).toMatch(/required parent index not yet published/)
    })

    it('records an error and keeps going when updateNote throws', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: 'https://www.notion.so/no-id-here' }))
      routeHappy()
      const res = await updateTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.outcomes[0]).toMatchObject({ action: 'error' })
      expect(res.outcomes[0]?.error).toMatch(/Could not extract a 32-hex page id/)
    })

    it('maps an unchanged note (hash match) to skip on the next run, with no Notion call', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Leaf.md', fm({}))
      routeHappy()
      await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      await updateTree(cfg, SUBTREE, ROOT_PARENT, s) // first push stamps the hash
      fetchMock.mockClear()
      const res = await updateTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(res.outcomes.map((o) => o.action)).toEqual(['skip', 'skip'])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('force re-pushes unchanged notes (no skip)', async () => {
      await write('Alpha/Alpha.md', fm({}))
      routeHappy()
      await touchTree(cfg, SUBTREE, ROOT_PARENT, s)
      await updateTree(cfg, SUBTREE, ROOT_PARENT, s)
      fetchMock.mockClear()
      const res = await updateTree(cfg, SUBTREE, ROOT_PARENT, s, { force: true })
      expect(res.outcomes.map((o) => o.action)).toEqual(['update'])
      expect(fetchMock).toHaveBeenCalled()
    })
  })

  describe('baselineTree', () => {
    const HEX_A = 'a'.repeat(32)
    const HEX_B = 'b'.repeat(32)

    it('stamps hash + published_at without any Notion call, and a later update then skips both', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: `https://www.notion.so/A-${HEX_A}` }))
      await write('Alpha/Leaf.md', fm({ kb_notion_mirror_url: `https://www.notion.so/L-${HEX_B}` }))
      const res = await baselineTree(cfg, SUBTREE, ROOT_PARENT, s, { publishedAt: '2026-06-01T18:00:00Z' })
      expect(res.outcomes.map((o) => o.action)).toEqual(['baseline', 'baseline'])
      expect(fetchMock).not.toHaveBeenCalled()
      const alpha = await read('Alpha/Alpha.md')
      expect(alpha).toContain('kb_notion_mirror_published_at: 2026-06-01T18:00:00Z')
      expect(alpha).toMatch(/kb_notion_mirror_hash: [a-f0-9]{64}/)
      // Baseline hash equals what update computes → a subsequent publish skips.
      const upd = await updateTree(cfg, SUBTREE, ROOT_PARENT, s)
      expect(upd.outcomes.map((o) => o.action)).toEqual(['skip', 'skip'])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('leaves a skip-listed note unstamped', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: `https://www.notion.so/A-${HEX_A}` }))
      const before = await read('Alpha/Alpha.md')
      const res = await baselineTree(cfg, SUBTREE, ROOT_PARENT, s, { publishedAt: '2026-06-01T18:00:00Z', skip: new Set(['Alpha/Alpha.md']) })
      expect(res.outcomes[0]).toMatchObject({ action: 'skip', error: 'excluded from baseline' })
      expect(await read('Alpha/Alpha.md')).toBe(before)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips an unmirrored note (no url to baseline)', async () => {
      await write('Alpha/Alpha.md', fm({}))
      const res = await baselineTree(cfg, SUBTREE, ROOT_PARENT, s, { publishedAt: '2026-06-01T18:00:00Z' })
      expect(res.outcomes[0]).toMatchObject({ action: 'skip' })
      expect(res.outcomes[0]?.url).toBeUndefined()
    })

    it('records an error when a parent index is unresolvable', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Beta/Beta.md', fm({}))
      await write('Alpha/Beta/Gamma.md', fm({ kb_notion_mirror_url: `https://www.notion.so/G-${HEX_A}` }))
      const res = await baselineTree(cfg, SUBTREE, ROOT_PARENT, s, { publishedAt: '2026-06-01T18:00:00Z' })
      const gamma = res.outcomes.find((o) => o.kbPath === 'Alpha/Beta/Gamma.md')
      expect(gamma).toMatchObject({ action: 'error' })
      expect(gamma?.error).toMatch(/required parent index not yet published/)
    })

    it('records an error when baselineNote throws (no frontmatter)', async () => {
      await write('Alpha/Alpha.md', '# title\n\nbody.\n')
      const res = await baselineTree(cfg, SUBTREE, ROOT_PARENT, s, { publishedAt: '2026-06-01T18:00:00Z' })
      expect(res.outcomes[0]).toMatchObject({ action: 'error' })
      expect(res.outcomes[0]?.error).toMatch(/no YAML frontmatter/)
    })
  })

  describe('deleteTree', () => {
    it('plans (no Notion call) in dry-run', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: `https://www.notion.so/A-${'a'.repeat(32)}` }))
      const res = await deleteTree(cfg, SUBTREE, s, { dryRun: true })
      expect(res.outcomes[0]).toMatchObject({ action: 'plan' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('archives and clears frontmatter when dry_run is false', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: `https://www.notion.so/A-${'a'.repeat(32)}` }))
      routeHappy()
      const res = await deleteTree(cfg, SUBTREE, s, { dryRun: false })
      expect(res.outcomes[0]).toMatchObject({ action: 'delete' })
      expect(await read('Alpha/Alpha.md')).not.toMatch(/kb_notion_mirror_url:/)
    })

    it('skips a note with no mirror URL', async () => {
      await write('Alpha/Alpha.md', fm({}))
      const res = await deleteTree(cfg, SUBTREE, s, { dryRun: false })
      expect(res.outcomes[0]).toMatchObject({ action: 'skip' })
    })

    it('records an error when deleteNote throws', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_url: 'https://www.notion.so/no-id-here' }))
      const res = await deleteTree(cfg, SUBTREE, s, { dryRun: false })
      expect(res.outcomes[0]).toMatchObject({ action: 'error' })
      expect(res.outcomes[0]?.error).toMatch(/Could not extract a 32-hex page id/)
    })
  })

  describe('chain edge cases (notesFor)', () => {
    it('stops the chain at the subtree-root index', async () => {
      await write('Alpha/Alpha.md', fm({}))
      routeHappy()
      const res = await publishTreeNote(cfg, SUBTREE, ROOT_PARENT, s, 'Alpha/Alpha.md')
      expect(res.chain).toEqual(['Alpha/Alpha.md'])
    })

    it('publishes a deep leaf root-down (touch then update)', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Beta/Beta.md', fm({}))
      await write('Alpha/Beta/Gamma.md', fm({}))
      routeHappy()
      const res = await publishTreeNote(cfg, SUBTREE, ROOT_PARENT, s, 'Alpha/Beta/Gamma.md')
      expect(res.chain).toEqual(['Alpha/Alpha.md', 'Alpha/Beta/Beta.md', 'Alpha/Beta/Gamma.md'])
      expect(res.outcomes.some((o) => o.action === 'touch')).toBe(true)
      expect(res.outcomes.some((o) => o.action === 'update')).toBe(true)
    })

    it('stops the chain when a leaf has no folder-index ancestor', async () => {
      await write('Alpha/Alpha.md', fm({}))
      await write('Alpha/Orphans/Stray.md', fm({})) // no Orphans/Orphans.md
      routeHappy()
      const res = await publishTreeNote(cfg, SUBTREE, ROOT_PARENT, s, 'Alpha/Orphans/Stray.md')
      expect(res.chain).toEqual(['Alpha/Orphans/Stray.md'])
    })

    it('stops the chain when a sub-index has no grandparent index', async () => {
      await write('Alpha/Orphans/Orphans.md', fm({})) // no Alpha/Alpha.md grandparent index
      routeHappy()
      const res = await publishTreeNote(cfg, SUBTREE, ROOT_PARENT, s, 'Alpha/Orphans/Orphans.md')
      expect(res.chain).toEqual(['Alpha/Orphans/Orphans.md'])
    })
  })
})
