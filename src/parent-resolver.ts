/**
 * Pure KB-path → parent-KB-path resolution for hierarchical publishing.
 *
 * The KB enforces a folder-index convention: every folder under `Pillars/` has
 * a note named after the folder (e.g. `Pillars/Engineering/Engineering.md`).
 * The Notion mirror replicates that tree, so each published page is parented at
 * its folder's index page. This module is the single source of truth for that
 * rule. It is deliberately PURE — path string in, path string out, no `fs` — so
 * the rule is trivially testable in isolation. The on-disk lookup (reading a
 * parent's `notion_mirror_url`) lives in `parent-lookup.ts`.
 *
 * Rules (see ENHANCEMENT-SPEC-01):
 *   1. The pillars root index (`<pillars>/Pillars.md`) parents at the wiki
 *      database root — the only page that does.
 *   2. A folder-index note (basename === containing-dir name) parents at the
 *      index of its GRANDPARENT folder.
 *   3. Any other (leaf) note parents at the index of its containing folder.
 */
import * as path from 'node:path'

export type ParentResolution = { type: 'database-root' } | { type: 'page'; parentKbPath: string }

const stripMd = (p: string): string => path.basename(p).replace(/\.md$/i, '')

/** The index-note path for a folder: `<dir>/<dirBasename>.md`. */
const indexOf = (dir: string): string => path.join(dir, `${path.basename(dir)}.md`)

/**
 * Resolve the parent of `noteAbsPath` given the absolute realpath of the
 * `Pillars` directory. Both paths should be realpath-resolved by the caller so
 * the equality check in rule 1 is reliable.
 */
export const deriveParent = (noteAbsPath: string, pillarsRootAbsPath: string): ParentResolution => {
  const dir = path.dirname(noteAbsPath)
  const base = stripMd(noteAbsPath)

  // Rule 1: the pillars root index parents at the database.
  if (path.resolve(noteAbsPath) === path.resolve(indexOf(pillarsRootAbsPath))) {
    return { type: 'database-root' }
  }

  // Rule 2: folder index → grandparent's index.
  if (base === path.basename(dir)) {
    return { type: 'page', parentKbPath: indexOf(path.dirname(dir)) }
  }

  // Rule 3: leaf → containing folder's index.
  return { type: 'page', parentKbPath: indexOf(dir) }
}

/**
 * The chain of required ancestor index notes for `noteAbsPath`, from its
 * immediate parent index up to (but not including) the database root, in
 * child→ancestor order. Used to compute the publishable closure.
 */
export const ancestorIndexChain = (noteAbsPath: string, pillarsRootAbsPath: string): string[] => {
  const chain: string[] = []
  let current = noteAbsPath
  // Bounded by tree depth; the pillars-root index always terminates the loop.
  for (let guard = 0; guard < 64; guard++) {
    const parent = deriveParent(current, pillarsRootAbsPath)
    if (parent.type === 'database-root') break
    chain.push(parent.parentKbPath)
    current = parent.parentKbPath
  }
  return chain
}
