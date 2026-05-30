/**
 * Discovery + ordering + parent resolution for the tree walk.
 *
 * The convention this encodes (layout-agnostic, folder-index based): a folder's
 * index note (`<Folder>/<Folder>.md`, basename == containing-folder basename) is
 * that folder's Notion page. Leaf notes nest under their folder's index. A
 * sub-folder's index nests under the grandparent folder's index. The
 * subtree-root index (the index of the `subtree` folder itself) attaches to the
 * caller-supplied `rootParent`.
 *
 * Operations act on a `subtree` — a kb-relative folder path (e.g.
 * "Alpha/Beta") — which may be ANY folder under kbRoot. There is no fixed root
 * folder and no fixed wiki database.
 *
 * All functions are pure: filesystem + settings in, plain values out — no
 * Notion calls, no logging. The async work happens in index.ts. The low-level
 * walk helpers (`loadNote`, `isExcluded`, `isEligible`) are exported so the
 * roots walk (src/main/roots) can reuse them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { extractPageIdFromUrl, type NotionIcon, type NotionParent } from '../notion-client/index.js'
import type { MirrorSettings } from './settings.js'

export interface Note {
  /** Path relative to `kbRoot`, e.g. "Alpha/Beta/Beta.md". */
  kbPath: string
  fullPath: string
  /** Filename without `.md`. */
  base: string
  /** Basename of the containing directory. */
  parentFolder: string
  /** True iff `base === parentFolder` — the note is its folder's index. */
  isIndex: boolean
  /** Parsed top-level scalar frontmatter fields. */
  fields: Record<string, string>
}

/**
 * Read top-level scalar `key: value` lines from a YAML frontmatter block. Lists,
 * nested maps, and blank lines are ignored — the walk only needs simple fields
 * (`icon`, `mirror`, `kb_notion_mirror_url`, etc.).
 */
export const readFrontmatter = (content: string): Record<string, string> => {
  if (!content.startsWith('---\n')) return {}
  const close = content.indexOf('\n---', 4)
  if (close === -1) return {}
  const fm = content.slice(4, close)
  const out: Record<string, string> = {}
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (!m) continue
    out[m[1] as string] = (m[2] as string).trim()
  }
  return out
}

export const walkMd = function* (dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue // skip .git, .obsidian, .DS_Store, …
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) yield* walkMd(full)
    else if (st.isFile() && name.endsWith('.md')) yield full
  }
}

export const loadNote = (kbRoot: string, fullPath: string): Note => {
  const kbPath = relative(kbRoot, fullPath)
  const fields = readFrontmatter(readFileSync(fullPath, 'utf-8'))
  const base = basename(fullPath, '.md')
  const parentFolder = basename(dirname(fullPath))
  return { kbPath, fullPath, base, parentFolder, isIndex: base === parentFolder, fields }
}

/**
 * Whether a note is explicitly excluded from the mirror. Honours the legacy
 * `mirror: exclude` and the namespaced `kb_notion_mirror_exclude` (any truthy
 * value other than `false`). When set on a folder index, `discover` additionally
 * prunes the whole subtree — see below.
 */
export const isExcluded = (n: Note): boolean => {
  if (n.fields.mirror === 'exclude') return true
  const v = n.fields.kb_notion_mirror_exclude
  return v !== undefined && v !== '' && v !== 'false'
}

export const isEligible = (n: Note, s: MirrorSettings): boolean => {
  if (isExcluded(n)) return false
  if (s.skipKbPaths.has(n.kbPath)) return false
  if (s.skipPrefixes.some((p) => n.base.startsWith(p))) return false
  return true
}

/**
 * Walk `<kbRoot>/<subtree>/` and return every mirror-eligible note. A note
 * carrying an exclude flag is dropped; when the flag is on a folder index the
 * entire subtree under that folder is pruned, so excluding a folder never
 * orphans its children.
 */
export const discover = (kbRoot: string, subtree: string, s: MirrorSettings): Note[] => {
  const rootPath = join(kbRoot, subtree)
  const all: Note[] = []
  for (const full of walkMd(rootPath)) all.push(loadNote(kbRoot, full))
  // Folders whose index note is excluded → prune the whole subtree under them.
  const excludedFolders = all.filter((n) => n.isIndex && isExcluded(n)).map((n) => `${dirname(n.kbPath)}/`)
  const underExcludedFolder = (kbPath: string): boolean => excludedFolders.some((prefix) => kbPath.startsWith(prefix))
  return all.filter((n) => isEligible(n, s) && !underExcludedFolder(n.kbPath))
}

/**
 * Order `notes` for safe publishing: a folder's index first, then its leaves
 * alphabetically, then descend into sub-folders alphabetically (DFS preorder
 * from the `subtree` dir). Parents always come before children, so
 * `resolveParent` can find their URLs.
 */
export const publishOrder = (kbRoot: string, subtree: string, _s: MirrorSettings, notes: Note[]): Note[] => {
  const byDir = new Map<string, Note[]>()
  for (const n of notes) {
    const d = dirname(n.fullPath)
    if (!byDir.has(d)) byDir.set(d, [])
    byDir.get(d)?.push(n)
  }
  const rootPath = join(kbRoot, subtree)
  const out: Note[] = []
  const visit = (dir: string): void => {
    const here = byDir.get(dir) ?? []
    const idx = here.find((n) => n.isIndex)
    const leaves = here.filter((n) => !n.isIndex).sort((a, b) => a.base.localeCompare(b.base))
    if (idx) out.push(idx)
    for (const l of leaves) out.push(l)
    const subs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name))
      .sort()
    for (const sub of subs) visit(sub)
  }
  visit(rootPath)
  return out
}

/** Compute the kb-path of the index note for a folder's kb-path. */
export const indexKbPathFor = (folderKbPath: string): string => `${folderKbPath}/${basename(folderKbPath)}.md`

/**
 * Resolve the Notion parent for `n`, given the subtree being published, the
 * caller-supplied `rootParent` (where the subtree-root index attaches), and a
 * map of already-published kbPath → URL. Throws if a required ancestor index
 * isn't in the map (parents must be published first; `publishOrder` ensures
 * this for non-degenerate trees).
 */
export const resolveParent = (n: Note, subtree: string, rootParent: NotionParent, urlByKbPath: Map<string, string>): NotionParent => {
  const folderKbPath = dirname(n.kbPath)
  if (n.isIndex) {
    if (folderKbPath === subtree) return rootParent
    const grandparentFolder = dirname(folderKbPath)
    const idx = indexKbPathFor(grandparentFolder)
    return pageParentFrom(idx, urlByKbPath)
  }
  const idx = indexKbPathFor(folderKbPath)
  return pageParentFrom(idx, urlByKbPath)
}

/** Look up the index note's mirror URL and turn it into a page_id parent. */
const pageParentFrom = (idx: string, urlByKbPath: Map<string, string>): NotionParent => {
  const url = urlByKbPath.get(idx)
  if (!url) throw new Error(`required parent index not yet published: ${idx}`)
  const pageId = extractPageIdFromUrl(url)
  if (!pageId) throw new Error(`bad URL on ${idx}: ${url}`)
  return { type: 'page_id', page_id: pageId }
}

/**
 * Build a wikilink → URL map by re-reading each note's `kb_notion_mirror_url` from
 * disk. We read from disk (not from `notes[].fields`) because touch writes URLs
 * back to the file as it goes, so a fresh read gives the post-touch state.
 *
 * Two aliases per note: bare basename (for `[[Beta]]`) and the full path sans
 * `.md` (for `[[Alpha/Beta/Beta|Beta]]`).
 */
export const buildLinkMap = (notes: Note[]): Record<string, string> => {
  const map: Record<string, string> = {}
  for (const n of notes) {
    const fresh = readFrontmatter(readFileSync(n.fullPath, 'utf-8'))
    const url = fresh.kb_notion_mirror_url
    if (!url) continue
    map[n.base] = url
    map[n.kbPath.replace(/\.md$/, '')] = url
  }
  return map
}

/** Build a Lucide external-icon for a kebab-case name, or undefined if no name. */
export const iconFor = (name: string | undefined, s: MirrorSettings): NotionIcon | undefined => {
  if (!name) return undefined
  return { type: 'external', external: { url: `${s.iconBaseUrl}/${name}.svg` } }
}
