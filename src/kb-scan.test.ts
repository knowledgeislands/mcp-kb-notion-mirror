import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findPublishableClosure } from './kb-scan.js'

const source = (url: string) => `---\nstatus: x\nnotion_source_url: ${url}\n---\nbody\n`
const sourceAndMirror = (s: string, m: string) => `---\nstatus: x\nnotion_source_url: ${s}\nnotion_mirror_url: ${m}\n---\nbody\n`
const indexNote = `---\nstatus: x\n---\nbody\n`
const indexPublished = (m: string) => `---\nstatus: x\nnotion_mirror_url: ${m}\n---\nbody\n`

describe('findPublishableClosure', () => {
  let pillars: string
  const rel = (p: string) => path.relative(pillars, p)

  beforeEach(async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-notion-mirror-closure-'))
    await fsp.mkdir(path.join(root, 'Pillars', 'Engineering', 'Bioweave'), { recursive: true })
    pillars = fs.realpathSync(path.join(root, 'Pillars'))
    // Folder-index notes (KB-native, no source_url, not yet mirrored)
    await fsp.writeFile(path.join(pillars, 'Pillars.md'), indexNote)
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Engineering.md'), indexNote)
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md'), indexNote)
    // A leaf drained from Notion, not yet mirrored
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'Multi.md'), source('https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))
    // A leaf already mirrored — excluded
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'Done.md'), sourceAndMirror('https://www.notion.so/bb', 'https://www.notion.so/cc'))
    // A non-markdown file — ignored by the walk
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'diagram.png'), 'not markdown')
  })

  afterEach(async () => {
    await fsp.rm(path.dirname(pillars), { recursive: true, force: true })
  })

  it('returns the source note plus its required index ancestors, in tree order (parents first)', async () => {
    const notes = await findPublishableClosure(pillars)
    expect(notes.map((n) => rel(n.path))).toEqual([
      'Pillars.md',
      path.join('Engineering', 'Engineering.md'),
      path.join('Engineering', 'Bioweave', 'Bioweave.md'),
      path.join('Engineering', 'Bioweave', 'Multi.md')
    ])
  })

  it('attaches source_url only to source notes, omitting it for index notes', async () => {
    const notes = await findPublishableClosure(pillars)
    const byRel = Object.fromEntries(notes.map((n) => [rel(n.path), n]))
    expect(byRel['Pillars.md'].source_url).toBeUndefined()
    expect(byRel[path.join('Engineering', 'Bioweave', 'Multi.md')].source_url).toBe('https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('skips index ancestors that are already mirrored', async () => {
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Engineering.md'), indexPublished('https://www.notion.so/Engineering-3709f7187cc2814e8652f99fd36857ff'))
    const notes = await findPublishableClosure(pillars)
    expect(notes.map((n) => rel(n.path))).toEqual(['Pillars.md', path.join('Engineering', 'Bioweave', 'Bioweave.md'), path.join('Engineering', 'Bioweave', 'Multi.md')])
  })

  it('does not invent missing index files (publish surfaces that error instead)', async () => {
    await fsp.rm(path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md'))
    const notes = await findPublishableClosure(pillars)
    expect(notes.map((n) => rel(n.path))).toEqual(['Pillars.md', path.join('Engineering', 'Engineering.md'), path.join('Engineering', 'Bioweave', 'Multi.md')])
  })

  it('returns [] when no drained note needs publishing (no unmirrored source, no orphaned ancestor)', async () => {
    // Remove the unpublished leaf AND the already-mirrored leaf — with no note
    // bearing a source_url left, nothing (source or ancestor index) is publishable.
    await fsp.rm(path.join(pillars, 'Engineering', 'Bioweave', 'Multi.md'))
    await fsp.rm(path.join(pillars, 'Engineering', 'Bioweave', 'Done.md'))
    expect(await findPublishableClosure(pillars)).toEqual([])
  })

  it('returns [] for a non-existent root', async () => {
    expect(await findPublishableClosure(path.join(pillars, 'nope'))).toEqual([])
  })

  it('prunes hidden dirs and node_modules', async () => {
    await fsp.mkdir(path.join(pillars, '.hidden'), { recursive: true })
    await fsp.mkdir(path.join(pillars, 'node_modules'), { recursive: true })
    await fsp.writeFile(path.join(pillars, '.hidden', 'h.md'), source('https://www.notion.so/dd'))
    await fsp.writeFile(path.join(pillars, 'node_modules', 'n.md'), source('https://www.notion.so/ee'))
    const notes = await findPublishableClosure(pillars)
    expect(notes.some((n) => n.path.includes('.hidden') || n.path.includes('node_modules'))).toBe(false)
  })

  it('honours the depth cap', async () => {
    // depth 0 reads only the Pillars dir; the source note is at depth 3, so nothing qualifies
    expect(await findPublishableClosure(pillars, 0)).toEqual([])
  })

  it('skips notes it cannot read', async () => {
    const locked = path.join(pillars, 'Engineering', 'Bioweave', 'Locked.md')
    await fsp.writeFile(locked, source('https://www.notion.so/ff'))
    await fsp.chmod(locked, 0o000)
    try {
      const notes = await findPublishableClosure(pillars)
      expect(notes.some((n) => n.path.endsWith('Locked.md'))).toBe(false)
    } finally {
      await fsp.chmod(locked, 0o600)
    }
  })

  // ENHANCEMENT-SPEC-02 Issue 1: a folder index and its sibling leaves share a
  // depth; the index must sort first so a top-to-bottom publish does parents
  // before children even when a leaf's name sorts earlier alphabetically.
  it('orders a folder index before its sibling leaves at the same depth', async () => {
    await fsp.mkdir(path.join(pillars, 'Operations'), { recursive: true })
    await fsp.writeFile(path.join(pillars, 'Operations', 'Operations.md'), indexNote)
    // "Azure" sorts before "Operations" alphabetically — the bug put it first.
    await fsp.writeFile(path.join(pillars, 'Operations', 'Azure.md'), source('https://www.notion.so/0000000000000000000000000000aaaa'))
    await fsp.writeFile(path.join(pillars, 'Operations', 'Basic walkthrough.md'), source('https://www.notion.so/0000000000000000000000000000bbbb'))
    const notes = await findPublishableClosure(pillars)
    const ops = notes.map((n) => rel(n.path)).filter((p) => p.startsWith(`Operations${path.sep}`))
    expect(ops).toEqual([path.join('Operations', 'Operations.md'), path.join('Operations', 'Azure.md'), path.join('Operations', 'Basic walkthrough.md')])
  })

  it('places every folder-tree ancestor before its descendants in the result', async () => {
    await fsp.mkdir(path.join(pillars, 'Operations'), { recursive: true })
    await fsp.writeFile(path.join(pillars, 'Operations', 'Operations.md'), indexNote)
    await fsp.writeFile(path.join(pillars, 'Operations', 'Azure.md'), source('https://www.notion.so/0000000000000000000000000000aaaa'))
    const order = (await findPublishableClosure(pillars)).map((n) => rel(n.path))
    const folderOf = (p: string) => (path.basename(p, '.md') === path.basename(path.dirname(p)) ? path.dirname(path.dirname(p)) : path.dirname(p))
    // For each note, its containing folder's index (if present) must come earlier.
    for (let i = 0; i < order.length; i++) {
      const parentIndex = path.join(folderOf(order[i]), `${path.basename(folderOf(order[i]))}.md`)
      const pIdx = order.indexOf(parentIndex)
      if (pIdx !== -1 && parentIndex !== order[i]) expect(pIdx).toBeLessThan(i)
    }
  })

  // ENHANCEMENT-SPEC-02 Issue 2: an already-mirrored (flat-rooted) leaf still
  // needs its unpublished ancestor indexes surfaced so they can be published
  // and the orphaned leaf later moved under them.
  it('includes ancestor indexes of an already-published (orphaned) leaf', async () => {
    // Remove the unpublished leaf so the ONLY drained note under Bioweave is mirrored.
    await fsp.rm(path.join(pillars, 'Engineering', 'Bioweave', 'Multi.md'))
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'Orphan.md'), sourceAndMirror('https://www.notion.so/11', 'https://www.notion.so/Orphan-22'))
    const notes = (await findPublishableClosure(pillars)).map((n) => rel(n.path))
    expect(notes).toEqual(['Pillars.md', path.join('Engineering', 'Engineering.md'), path.join('Engineering', 'Bioweave', 'Bioweave.md')])
    // The orphaned leaf itself is NOT republished — only its missing ancestors.
    expect(notes).not.toContain(path.join('Engineering', 'Bioweave', 'Orphan.md'))
  })
})
