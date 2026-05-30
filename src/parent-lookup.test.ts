import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveParentTarget } from './parent-lookup.js'

const PAGE_HEX = '3709f7187cc2814e8652f99fd36857ff'

const fmWithMirror = (url: string) => `---\nstatus: x\nnotion_mirror_url: ${url}\n---\nbody\n`
const fmNoMirror = `---\nstatus: x\n---\nbody\n`

describe('resolveParentTarget', () => {
  let pillars: string

  beforeEach(async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-notion-mirror-plookup-'))
    await fsp.mkdir(path.join(root, 'Pillars', 'Engineering', 'Bioweave'), { recursive: true })
    pillars = fs.realpathSync(path.join(root, 'Pillars'))
  })

  afterEach(async () => {
    await fsp.rm(path.dirname(pillars), { recursive: true, force: true })
  })

  it('returns database-root for the pillars root index', async () => {
    const target = await resolveParentTarget(path.join(pillars, 'Pillars.md'), pillars)
    expect(target).toEqual({ kind: 'database-root' })
  })

  it('returns the parent page id when the folder index is published', async () => {
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md'), fmWithMirror(`https://www.notion.so/Bioweave-${PAGE_HEX}`))
    const target = await resolveParentTarget(path.join(pillars, 'Engineering', 'Bioweave', 'Leaf.md'), pillars)
    expect(target).toEqual({
      kind: 'page',
      parentKbPath: path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md'),
      pageId: PAGE_HEX,
      mirrorUrl: `https://www.notion.so/Bioweave-${PAGE_HEX}`
    })
  })

  it('returns missing-index when the parent index file is absent', async () => {
    const target = await resolveParentTarget(path.join(pillars, 'Engineering', 'Bioweave', 'Leaf.md'), pillars)
    expect(target).toEqual({ kind: 'missing-index', parentKbPath: path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md') })
  })

  it('returns parent-unpublished when the parent index has no notion_mirror_url', async () => {
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md'), fmNoMirror)
    const target = await resolveParentTarget(path.join(pillars, 'Engineering', 'Bioweave', 'Leaf.md'), pillars)
    expect(target).toEqual({ kind: 'parent-unpublished', parentKbPath: path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md') })
  })

  it('returns malformed-parent-url when the parent mirror url has no 32-hex id', async () => {
    await fsp.writeFile(path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md'), fmWithMirror('https://www.notion.so/no-id-here'))
    const target = await resolveParentTarget(path.join(pillars, 'Engineering', 'Bioweave', 'Leaf.md'), pillars)
    expect(target).toEqual({ kind: 'malformed-parent-url', parentKbPath: path.join(pillars, 'Engineering', 'Bioweave', 'Bioweave.md'), mirrorUrl: 'https://www.notion.so/no-id-here' })
  })
})
