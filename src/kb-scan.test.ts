import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findUnpublishedNotes } from './kb-scan.js'

const withSource = (url: string) => `---\nstatus: x\nnotion_source_url: ${url}\n---\nbody\n`
const withSourceAndMirror = (s: string, m: string) => `---\nstatus: x\nnotion_source_url: ${s}\nnotion_mirror_url: ${m}\n---\nbody\n`

describe('findUnpublishedNotes', () => {
  let pillars: string

  beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-notion-mirror-scan-'))
    pillars = path.join(root, 'Pillars')
    await fs.mkdir(path.join(pillars, 'A'), { recursive: true })
    await fs.mkdir(path.join(pillars, '.hidden'), { recursive: true })
    await fs.mkdir(path.join(pillars, 'node_modules'), { recursive: true })

    await fs.writeFile(path.join(pillars, 'A', 'note1.md'), withSource('https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))
    await fs.writeFile(path.join(pillars, 'A', 'aaa-note.md'), withSource('https://www.notion.so/99999999999999999999999999999999'))
    await fs.writeFile(path.join(pillars, 'A', 'note2.md'), withSourceAndMirror('https://www.notion.so/bb', 'https://www.notion.so/cc'))
    await fs.writeFile(path.join(pillars, 'A', 'no-frontmatter.md'), 'just text')
    await fs.writeFile(path.join(pillars, 'A', 'notes.txt'), withSource('https://www.notion.so/dd')) // not .md
    await fs.writeFile(path.join(pillars, '.hidden', 'secret.md'), withSource('https://www.notion.so/ee'))
    await fs.writeFile(path.join(pillars, 'node_modules', 'pkg.md'), withSource('https://www.notion.so/ff'))
  })

  afterEach(async () => {
    await fs.rm(path.dirname(pillars), { recursive: true, force: true })
  })

  it('returns only notes with a source URL but no mirror URL, sorted by path, pruning hidden + node_modules', async () => {
    const notes = await findUnpublishedNotes(pillars)
    expect(notes.map((n) => path.basename(n.path))).toEqual(['aaa-note.md', 'note1.md'])
    expect(notes[1]?.source_url).toBe('https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('returns [] for a non-existent root', async () => {
    expect(await findUnpublishedNotes(path.join(pillars, 'does-not-exist'))).toEqual([])
  })

  it('honours the depth cap (subdirectories beyond maxDepth are skipped)', async () => {
    await fs.writeFile(path.join(pillars, 'root-note.md'), withSource('https://www.notion.so/gg'))
    const notes = await findUnpublishedNotes(pillars, 0)
    // depth 0 reads only the Pillars dir itself; A/note1.md (depth 1) is skipped
    expect(notes.map((n) => path.basename(n.path))).toEqual(['root-note.md'])
  })

  it('skips notes it cannot read rather than failing the walk', async () => {
    const unreadable = path.join(pillars, 'A', 'locked.md')
    await fs.writeFile(unreadable, withSource('https://www.notion.so/hh'))
    await fs.chmod(unreadable, 0o000)
    try {
      const notes = await findUnpublishedNotes(pillars)
      expect(notes.map((n) => path.basename(n.path))).toEqual(['aaa-note.md', 'note1.md'])
    } finally {
      await fs.chmod(unreadable, 0o600)
    }
  })
})
