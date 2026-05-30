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

  it('returns [] when nothing is drained-but-unmirrored', async () => {
    await fsp.rm(path.join(pillars, 'Engineering', 'Bioweave', 'Multi.md'))
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
})
