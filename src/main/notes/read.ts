/**
 * Note readers, split by cost.
 *
 * Every note verb resolves the kb-path under the safe root and reads the file,
 * but only `update` needs the body converted to Notion blocks. So we expose two
 * readers: `readNoteFrontmatter` (resolve + read + parse the frontmatter block —
 * used by touch/get/move/delete/status/preflight and the tree/roots walks) and
 * `readFullNote` (adds the frontmatter-and-H1-stripped body markdown — used only
 * by `update`). Both still load the whole file (frontmatter sits at the top of a
 * note); the split is about not running the expensive markdown→blocks pipeline
 * unless a body push actually needs it.
 */
import * as fs from 'node:fs/promises'
import type { Config } from '../../config/index.js'
import { resolveKbNotePath } from '../../utils/paths.js'
import { parseFrontmatter } from './frontmatter.js'
import { stripFrontmatter, stripLeadingH1 } from './markdown.js'

export interface NoteFrontmatter {
  /** Absolute, safe-root-confined path to the note. */
  abs: string
  /** The note's full raw text (needed for frontmatter write-back). */
  raw: string
  /** Parsed top-level scalar frontmatter fields. */
  fields: Record<string, string>
  hasFrontmatter: boolean
}

export interface FullNote extends NoteFrontmatter {
  /** Body markdown with frontmatter + a leading `# Title` H1 stripped, ready for wikilink rewrite + martian. */
  body: string
}

/** Cheap read: resolve the path, read the file, parse the frontmatter block. No body conversion. */
export const readNoteFrontmatter = async (cfg: Pick<Config, 'kbRoot'>, kbPath: string): Promise<NoteFrontmatter> => {
  const abs = resolveKbNotePath(cfg.kbRoot, kbPath)
  const raw = await fs.readFile(abs, 'utf-8')
  const { hasFrontmatter, fields } = parseFrontmatter(raw)
  return { abs, raw, fields, hasFrontmatter }
}

/** Full read: frontmatter plus the stripped body markdown. Only `updateNote` needs this. */
export const readFullNote = async (cfg: Pick<Config, 'kbRoot'>, kbPath: string): Promise<FullNote> => {
  const fm = await readNoteFrontmatter(cfg, kbPath)
  return { ...fm, body: stripLeadingH1(stripFrontmatter(fm.raw)) }
}
