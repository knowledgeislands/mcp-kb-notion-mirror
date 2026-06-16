/**
 * Tests for roots discovery (discoverRoots / listRoots).
 *
 * A temp KB fixture exercises the pruned walk: a declared root prunes its
 * subtree (no nested roots), excluded / skip-prefixed branches are pruned as a
 * search optimisation, non-root folders are descended, and the three
 * parent-value forms (bare id, db:<id>, page:<id>) parse correctly.
 *
 * Fixtures use a synthetic Greek scheme, never real KB names.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_WALK_DEPTH } from '../trees/discover.js'
import type { MirrorSettings } from '../trees/settings.js'
import { buildGlobalLinkMap, discoverRoots, listRoots } from './index.js'

const DB_ID = '36f9f7187cc280f69272e60aa89bff24'
const PAGE_ID = '3709f7187cc281dd9a32c190c3eaf8b6'

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

describe('discoverRoots', () => {
  let kbRoot: string
  let s: MirrorSettings

  const write = async (rel: string, content: string): Promise<void> => {
    const abs = path.join(kbRoot, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content)
  }

  beforeEach(async () => {
    kbRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-kb-notion-mirror-roots-'))
    s = settings()
  })

  afterEach(async () => {
    await fsp.rm(kbRoot, { recursive: true, force: true })
  })

  it('discovers declared roots, pruning nested roots, excluded/skip-prefixed branches, and descending non-roots', async () => {
    // bare id → database parent; a NESTED root must be pruned (not rediscovered).
    await write('Alpha/Alpha.md', fm({ kb_notion_mirror_root: DB_ID }))
    await write('Alpha/Beta/Beta.md', fm({ kb_notion_mirror_root: DB_ID })) // nested → pruned
    // page:<id> → page parent.
    await write('Omega/Omega.md', fm({ kb_notion_mirror_root: `page:${PAGE_ID}` }))
    // db:<id> → database parent (explicit prefix).
    await write('Gamma/Gamma.md', fm({ kb_notion_mirror_root: `db:${DB_ID}` }))
    // Non-root folder index → descend; a root sits deeper.
    await write('Delta/Delta.md', fm({ icon: 'box' }))
    await write('Delta/Epsilon/Epsilon.md', fm({ kb_notion_mirror_root: DB_ID }))
    // root:'false' → not a root → descend (nothing here).
    await write('Falsy/Falsy.md', fm({ kb_notion_mirror_root: 'false' }))
    // Excluded index → branch pruned.
    await write('Excl/Excl.md', fm({ kb_notion_mirror_exclude: 'true', kb_notion_mirror_root: DB_ID }))
    // Index-less, non-skip folder → descend and find the deeper root.
    await write('Plain/Sub/Sub.md', fm({ kb_notion_mirror_root: DB_ID }))
    // Index-less, skip-prefixed folder → pruned (the deeper root is never seen).
    await write('+Drafts/Hidden/Hidden.md', fm({ kb_notion_mirror_root: DB_ID }))
    // A hidden dir and a top-level file → skipped by the walk.
    await write('.obsidian/workspace.md', fm({ kb_notion_mirror_root: DB_ID }))
    await write('README.md', '# readme\n')

    const roots = discoverRoots(kbRoot, s)
    expect(roots.map((r) => r.subtree)).toEqual(['Alpha', 'Delta/Epsilon', 'Gamma', 'Omega', 'Plain/Sub'])
    expect(roots.find((r) => r.subtree === 'Alpha')?.parent).toEqual({ type: 'database_id', database_id: DB_ID })
    expect(roots.find((r) => r.subtree === 'Gamma')?.parent).toEqual({ type: 'database_id', database_id: DB_ID })
    expect(roots.find((r) => r.subtree === 'Omega')?.parent).toEqual({ type: 'page_id', page_id: PAGE_ID })
    expect(roots.find((r) => r.subtree === 'Alpha')?.indexKbPath).toBe('Alpha/Alpha.md')
  })

  it('throws when the value is "true" rather than a parent id', async () => {
    await write('Alpha/Alpha.md', fm({ kb_notion_mirror_root: 'true' }))
    expect(() => discoverRoots(kbRoot, s)).toThrow(/Notion parent id/)
  })

  it('returns [] when no roots are declared', async () => {
    await write('Alpha/Alpha.md', fm({ icon: 'box' }))
    expect(discoverRoots(kbRoot, s)).toEqual([])
  })

  it('never walks into a node_modules directory when hunting for roots', async () => {
    await write('Alpha/Alpha.md', fm({ kb_notion_mirror_root: DB_ID }))
    // A declared root buried inside node_modules must be invisible to discovery.
    await write('node_modules/pkg/pkg.md', fm({ kb_notion_mirror_root: DB_ID }))
    expect(discoverRoots(kbRoot, s).map((r) => r.subtree)).toEqual(['Alpha'])
  })

  it('stops descending at MAX_WALK_DEPTH (a root past the cap is not discovered)', async () => {
    // A root declared deeper than the cap is never reached; the walk does not throw.
    const segments = Array.from({ length: MAX_WALK_DEPTH + 2 }, (_, i) => `L${i}`)
    let rel = 'Deep'
    await write('Deep/Deep.md', fm({ icon: 'box' })) // non-root index → descend
    for (const seg of segments.slice(0, -1)) {
      rel = path.join(rel, seg)
      await write(path.join(rel, `${seg}.md`), fm({ icon: 'box' }))
    }
    const last = segments[segments.length - 1] as string
    rel = path.join(rel, last)
    await write(path.join(rel, `${last}.md`), fm({ kb_notion_mirror_root: DB_ID })) // past the cap
    expect(discoverRoots(kbRoot, s)).toEqual([])
  })

  it('listRoots is the public alias of discoverRoots', async () => {
    await write('Alpha/Alpha.md', fm({ kb_notion_mirror_root: DB_ID }))
    expect(listRoots(kbRoot, s)).toEqual(discoverRoots(kbRoot, s))
  })

  describe('buildGlobalLinkMap', () => {
    it('spans every declared root so cross-root links resolve', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_root: DB_ID, kb_notion_mirror_url: 'https://notion.so/alpha-aaaa' }))
      await write('Alpha/Leaf/Leaf.md', fm({ kb_notion_mirror_url: 'https://notion.so/leaf-bbbb' }))
      await write('Omega/Omega.md', fm({ kb_notion_mirror_root: `page:${PAGE_ID}`, kb_notion_mirror_url: 'https://notion.so/omega-cccc' }))

      const map = buildGlobalLinkMap(kbRoot, s)
      // Notes from BOTH roots are present (bare basename + full path aliases).
      expect(map.Alpha).toBe('https://notion.so/alpha-aaaa')
      expect(map.Leaf).toBe('https://notion.so/leaf-bbbb')
      expect(map.Omega).toBe('https://notion.so/omega-cccc')
      expect(map['Alpha/Leaf/Leaf']).toBe('https://notion.so/leaf-bbbb')
    })

    it('omits notes that are not yet mirrored', async () => {
      await write('Alpha/Alpha.md', fm({ kb_notion_mirror_root: DB_ID })) // no url yet
      expect(buildGlobalLinkMap(kbRoot, s).Alpha).toBeUndefined()
    })
  })
})
