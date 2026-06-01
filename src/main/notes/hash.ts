/**
 * Content hash of everything that determines a mirrored page's pushed state, so
 * an unchanged note can be skipped without any Notion call (see `updateNote`).
 *
 * The hash covers the FOUR inputs that decide what `updateNote` writes to Notion:
 *  - `blocks`  — the resolved body blocks (post-wikilink, post-mention); captures
 *                content changes AND link-resolution changes (a `[[link]]` that
 *                newly resolves changes the blocks even when the markdown bytes do not)
 *  - `title`   — the page title (note basename); captures renames
 *  - `icon`    — the page icon (frontmatter `icon`); captures icon changes
 *  - `parent`  — the resolved Notion parent; captures folder-moves / re-parents
 *
 * It deliberately EXCLUDES the banner, which is stamped with the current date on
 * every push — folding it in would change the hash daily and defeat the skip.
 *
 * The hash only needs to be SELF-CONSISTENT (same inputs → same digest across
 * runs of the same code); it is never compared against Notion's own block shape.
 * A dependency/format change that alters the rendered blocks simply invalidates
 * every hash once, forcing a one-off full re-push — acceptable and expected.
 */
import { createHash } from 'node:crypto'
import type { NotionIcon, NotionParent } from '../notion-client/index.js'

/** The inputs that determine a page's pushed body + placement (banner excluded). */
export interface BodyHashInput {
  blocks: unknown[]
  title: string
  icon: NotionIcon | undefined
  parent: NotionParent
}

/** Stable sha256 of the push-determining inputs, hex-encoded. */
export const computeBodyHash = (input: BodyHashInput): string =>
  createHash('sha256')
    .update(JSON.stringify([input.blocks, input.title, input.icon ?? null, input.parent]))
    .digest('hex')
