/**
 * Depth-limited walk of `<root>/Pillars/` computing the **publishable closure**:
 * the KB notes drained from Notion (`notion_source_url` set, `notion_mirror_url`
 * absent) PLUS every required folder-index ancestor that isn't yet mirrored, so
 * a caller iterating the result in order always publishes parents before
 * children.
 *
 * Hidden dirs and `node_modules` are pruned; a note that can't be read is
 * skipped rather than failing the whole walk (per-item resilience). Required
 * index notes that are missing on disk are NOT included here — `publish` /
 * `move` surface that as a clear "folder index missing" error.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import { ancestorIndexChain } from './parent-resolver.js'

const DEFAULT_MAX_DEPTH = 12

export interface PublishableNote {
  path: string
  source_url?: string
  depth: number
}

interface NoteInfo {
  source_url?: string
  has_mirror: boolean
}

export const findPublishableClosure = async (pillarsRoot: string, maxDepth: number = DEFAULT_MAX_DEPTH): Promise<PublishableNote[]> => {
  const all = new Map<string, NoteInfo>()

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        await walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        let text: string
        try {
          text = await fs.readFile(full, 'utf-8')
        } catch {
          continue
        }
        const { fields } = parseFrontmatter(text)
        const info: NoteInfo = { has_mirror: Boolean(fields.notion_mirror_url) }
        if (fields.notion_source_url) info.source_url = fields.notion_source_url
        all.set(full, info)
      }
    }
  }

  await walk(pillarsRoot, 0)

  const selected = new Set<string>()
  for (const [notePath, info] of all) {
    if (info.source_url && !info.has_mirror) selected.add(notePath)
  }
  // For each source note, pull in every required ancestor index that exists on
  // disk and isn't mirrored yet. A source note's chain covers the ancestors of
  // any index it pulls in, so there's no need to recurse on added indexes.
  for (const notePath of [...selected]) {
    for (const indexPath of ancestorIndexChain(notePath, pillarsRoot)) {
      const info = all.get(indexPath)
      if (info && !info.has_mirror) selected.add(indexPath)
    }
  }

  const depthOf = (p: string): number => path.relative(pillarsRoot, p).split(path.sep).length

  const result: PublishableNote[] = [...selected].map((p) => {
    const note: PublishableNote = { path: p, depth: depthOf(p) }
    const src = all.get(p)?.source_url
    if (src) note.source_url = src
    return note
  })
  // Tree order: shallowest first (parents precede children), alphabetical within a depth.
  result.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
  return result
}
