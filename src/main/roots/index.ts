/**
 * Roots discovery.
 *
 * A folder is a *mirror root* when its index note (`<Folder>/<Folder>.md`)
 * carries `kb_notion_mirror_root: <parent>` — the Notion parent the root's index
 * attaches under (a wiki database id by default, or `page:<id>` to nest under a
 * page, or `db:<id>` explicitly).
 *
 * This is pure DISCOVERY: it returns `[{ subtree, parent }]` and never touches
 * Notion. The client (or the CLI `roots` batch) then drives `tree` ops per root
 * with the returned parent — so there is no frontmatter-driven server-side batch
 * mutation, and every mutation still takes an explicit parent per call.
 *
 * The walk is pruned two ways:
 *  - once a folder is found to be a root, its subtree is NOT descended — a root
 *    cannot nest another root (that subtree belongs to the outer root);
 *  - folders that can't yield a mirrorable root are skipped — an excluded /
 *    skip-listed index, or an index-less skip-prefixed folder. Since the model
 *    whitelists (only notes under a declared root are mirrored), pruning outside
 *    a root is purely a search optimisation.
 */
import { existsSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { NotionParent } from '../notion-client/index.js'
import { isEligible, loadNote, type Note } from '../trees/discover.js'
import type { MirrorSettings } from '../trees/settings.js'

/** A folder declared as a mirror root via `kb_notion_mirror_root` frontmatter. */
export interface MirrorRoot {
  /** kb-relative folder to walk, e.g. "Alpha". */
  subtree: string
  /** kb-path of the root's index note, e.g. "Alpha/Alpha.md". */
  indexKbPath: string
  /** The Notion parent the root index attaches under. */
  parent: NotionParent
}

/**
 * Parse a `kb_notion_mirror_root` value into a Notion parent. A bare id (or
 * `db:<id>`) is a wiki database parent; `page:<id>` nests the root under a page.
 */
const parseRootParent = (value: string): NotionParent => {
  const v = value.trim()
  if (v.startsWith('page:')) return { type: 'page_id', page_id: v.slice('page:'.length).trim() }
  return { type: 'database_id', database_id: v.replace(/^db:/, '').trim() }
}

/** The index note of `folder` (`<folder>/<name>.md`) if it exists, else undefined. */
const indexNoteOf = (kbRoot: string, folder: string): Note | undefined => {
  const idxPath = join(folder, `${basename(folder)}.md`)
  return existsSync(idxPath) ? loadNote(kbRoot, idxPath) : undefined
}

/** The declared root parent value on a note, or undefined when unset / `false`. */
const rootValueOf = (n: Note): string | undefined => {
  const v = n.fields.kb_notion_mirror_root
  return v && v !== 'false' ? v : undefined
}

/**
 * Scan the KB (depth-first, pruned) for every folder that declares itself a
 * mirror root. Returns the roots sorted by subtree.
 */
export const discoverRoots = (kbRoot: string, s: MirrorSettings): MirrorRoot[] => {
  const roots: MirrorRoot[] = []
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const folder = join(dir, e.name)
      const idx = indexNoteOf(kbRoot, folder)
      if (idx) {
        if (!isEligible(idx, s)) continue // excluded / skip-listed index → prune this branch
        const value = rootValueOf(idx)
        if (value) {
          if (value === 'true') throw new Error(`kb_notion_mirror_root on ${idx.kbPath} must be the Notion parent id (a wiki database id), not "true"`)
          roots.push({ subtree: relative(kbRoot, folder), indexKbPath: idx.kbPath, parent: parseRootParent(value) })
          continue // PRUNE — a root cannot nest a root
        }
      } else if (s.skipPrefixes.some((p) => e.name.startsWith(p))) {
        continue // index-less skip-prefixed folder → prune (optimiser)
      }
      visit(folder)
    }
  }
  visit(kbRoot)
  return roots.sort((a, b) => a.subtree.localeCompare(b.subtree))
}

/** List the declared mirror roots (discovery only — no Notion call). */
export const listRoots = (kbRoot: string, s: MirrorSettings): MirrorRoot[] => discoverRoots(kbRoot, s)
