/**
 * Depth-limited walk of `<root>/Pillars/` to find KB notes that have been
 * drained from Notion (`notion_source_url` present) but not yet mirrored
 * (`notion_mirror_url` absent). Hidden dirs and `node_modules` are pruned; a
 * note that can't be read is skipped rather than failing the whole walk
 * (per-item resilience, matching the family convention).
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseFrontmatter } from './frontmatter.js'

const DEFAULT_MAX_DEPTH = 12

export interface UnpublishedNote {
  path: string
  source_url: string
}

export const findUnpublishedNotes = async (pillarsRoot: string, maxDepth: number = DEFAULT_MAX_DEPTH): Promise<UnpublishedNote[]> => {
  const results: UnpublishedNote[] = []

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
        if (fields.notion_source_url && !fields.notion_mirror_url) {
          results.push({ path: full, source_url: fields.notion_source_url })
        }
      }
    }
  }

  await walk(pillarsRoot, 0)
  results.sort((a, b) => a.path.localeCompare(b.path))
  return results
}
