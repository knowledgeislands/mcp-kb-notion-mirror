/**
 * Markdown → Notion block conversion for the publish pipeline.
 *
 * The body conversion is delegated to `@tryfabric/martian`
 * (`markdownToBlocks`), which handles paragraphs, headings, lists (incl.
 * nested), code fences, blockquotes, dividers, GFM tables, inline formatting,
 * and links. Two KB-specific transforms wrap it: stripping the frontmatter +
 * leading H1 (Notion takes the title from a page property), and prepending the
 * "Mirrored from KB" banner callout.
 *
 * Known gaps (tracked in ROADMAP.md): local image references render as their
 * alt-text paragraph rather than uploaded images, and `[[wikilinks]]` pass
 * through as literal text.
 */
import * as path from 'node:path'
import { markdownToBlocks } from '@tryfabric/martian'
import { BANNER_TEXT } from './config.js'

const DEFAULT_BANNER_SUFFIX = " — canonical version lives in HNR's KB; feedback via comments here will be triaged back into the KB."

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/

/** Drop the leading `---\n…\n---\n` frontmatter block, if present. */
export const stripFrontmatter = (text: string): string => text.replace(FRONTMATTER_RE, '').replace(/^\n+/, '')

/** Drop the first H1 (`# Title`) line — Notion gets the title from a page property. */
export const stripLeadingH1 = (text: string): string => {
  const lines = text.split('\n')
  const idx = lines.findIndex((l) => l.trim() !== '')
  if (idx !== -1 && /^#\s+/.test(lines[idx] as string)) lines.splice(idx, 1)
  return lines.join('\n')
}

/** Page title = the note's basename minus the `.md` extension. */
export const titleFromPath = (kbPath: string): string => path.basename(kbPath).replace(/\.md$/i, '')

/**
 * The "Mirrored from Knowledge Base" callout. The bold prefix always carries
 * the runtime date (authoritative); MCP_NOTION_MIRROR_BANNER_TEXT, when set,
 * overrides the trailing sentence so a KB can reword it.
 */
export const bannerBlock = (dateStr: string) => ({
  object: 'block' as const,
  type: 'callout' as const,
  callout: {
    icon: { type: 'emoji' as const, emoji: '📘' },
    rich_text: [
      { type: 'text' as const, text: { content: `Mirrored from Knowledge Base on ${dateStr}` }, annotations: { bold: true } },
      { type: 'text' as const, text: { content: BANNER_TEXT ?? DEFAULT_BANNER_SUFFIX } }
    ]
  }
})

/**
 * Build the full child-block array for a new mirror page: banner first, then
 * the converted markdown body (frontmatter + leading H1 already stripped by
 * the caller). `martian` is run with `notionLimits.truncate` so per-block
 * rich-text/character limits never produce an API-rejecting payload.
 */
export const buildPageChildren = (markdownBody: string, dateStr: string): unknown[] => {
  const blocks = markdownToBlocks(markdownBody, { notionLimits: { truncate: true } })
  return [bannerBlock(dateStr), ...blocks]
}
