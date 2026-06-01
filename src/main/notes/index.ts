/**
 * The note verbs — get / status / preflight / touch / update / move / delete —
 * as pipeline functions. The tool handlers (src/tools/note/index.ts) are thin
 * wrappers that validate args, call one of these, and map the result/throw to an
 * MCP envelope. Keeping the logic here (not in the excluded aggregator) makes
 * every branch unit-testable against a real temp file + a mocked Notion `fetch`.
 *
 * The note layer is file-aware but layout-agnostic: it reads the note's
 * frontmatter (+ body, for `update`) and writes back ONLY the mirror-owned
 * fields (`MIRROR_FIELDS`: url / published_at / hash). It does not discover files, resolve parents,
 * or know any folder convention — the caller supplies `kb_path` and (for
 * mutations) the Notion `parent`.
 *
 * Mirroring is two-phase by design: `touch` creates a body-less scaffold (title,
 * icon, banner, and the page's place in the child-pages hierarchy) so the page
 * URL becomes known for linking; `update` then pushes the body and resolves
 * `[[wikilinks]]` against a caller-supplied `link_map`. `update` REQUIRES a prior
 * `touch` (it throws if the note isn't mirrored yet), which guarantees every link
 * target exists before any body renders.
 */
import type { Config } from '../../config/index.js'
import { atomicWriteFile } from '../../utils/atomic-write.js'
import {
  appendBlockChildren,
  archivePage,
  createPage,
  deleteBlock,
  extractPageIdFromUrl,
  getBlockChildren,
  getPage,
  type NotionIcon,
  type NotionParent,
  normalizePublishedAt,
  setPageParent,
  updatePage
} from '../notion-client/index.js'
import { bannerBlock } from './banner.js'
import { refreshFooter } from './footer.js'
import { removeFrontmatterFields, upsertFrontmatterFields } from './frontmatter.js'
import { computeBodyHash } from './hash.js'
import { bodyToBlocks, titleFromPath } from './markdown.js'
import { readFullNote, readNoteFrontmatter } from './read.js'
import { getDatabaseTitleProperty } from './title-property.js'
import { convertMentionPlaceholders, rewriteWikilinks } from './wikilinks.js'

/**
 * The frontmatter fields the mirror owns:
 *  - `url`          — the page identity (stable across moves); the link target.
 *  - `published_at` — the last mirror time, for remote-drift detection (`--verify`).
 *  - `hash`         — content hash of the last push, for the zero-call skip in `updateNote`.
 */
export const MIRROR_FIELDS = ['kb_notion_mirror_url', 'kb_notion_mirror_published_at', 'kb_notion_mirror_hash'] as const
const MAX_CHILDREN_PER_REQUEST = 100

/** Optional touch extras: page icon. */
export interface TouchOptions {
  icon?: NotionIcon
}

/** Optional update extras: page icon, wikilink resolution map, force (bypass the hash skip). */
export interface UpdateOptions {
  icon?: NotionIcon
  linkMap?: Record<string, string>
  /** Push even when the content hash is unchanged (used by `--force` and drift reconcile). */
  force?: boolean
}

/** Optional baseline extras: page icon, wikilink resolution map, and the timestamp to stamp. */
export interface BaselineOptions {
  icon?: NotionIcon
  linkMap?: Record<string, string>
  /** The `published_at` value to stamp (a single "now" across the run); defaults to the current time. */
  publishedAt?: string
}

export type TouchResult = { url: string; page_id: string; published_at: string } | { skipped: true; existing_url: string }

export type UpdateResult = { url: string; page_id: string; updated_at: string; hash: string } | { skipped: true; url: string; page_id: string; hash: string }

export type BaselineResult = { baselined: true; url: string; hash: string; published_at: string } | { skipped: true; reason: 'not-mirrored' }

export type DeleteResult =
  | { archived: true; page_id: string; url: string }
  | { dry_run: true; would_archive_url: string; would_archive_page_id: string; would_clear_fields: string[] }
  | { archived: false; reason: string }

export type MoveResult = { moved: true; page_id: string; previous_parent: Record<string, unknown>; new_parent: NotionParent }

export type GetResult =
  | { id: string; parent: Record<string, unknown>; title: string; created_time: string; last_edited_time: string; archived: boolean; url: string }
  | { exists: false; reason: string }

export type StatusResult = { published: true; url: string; published_at: string | undefined } | { published: false }

export type PreflightResult = { ok: boolean; issues: string[] }

/** The page id of a Notion page parent, or undefined for a database/other parent. */
const pageParentId = (parent: Record<string, unknown>): string | undefined => (parent.type === 'page_id' ? (parent.page_id as string) : undefined)

/**
 * Refresh a parent's child-pages footer without ever failing the primary op —
 * the page is already touched/updated/moved/archived, so a flaky footer must not
 * surface as a tool error. Warns and swallows.
 */
const refreshFooterSafe = async (cfg: Config, parentPageId: string): Promise<void> => {
  try {
    await refreshFooter(cfg, parentPageId)
  } catch (err) {
    console.error(`mcp-kb-notion-mirror: child-pages footer refresh failed for parent ${parentPageId}:`, err)
  }
}

/**
 * Replace a page's body in place, preserving its native `child_page` blocks.
 * The new body is inserted immediately before the first child page (so it stays
 * above the children), then the old non-child blocks are deleted. Notion's
 * append-only API can't reorder, hence the insert-then-delete dance.
 */
const replaceBody = async (cfg: Config, pageId: string, children: unknown[]): Promise<void> => {
  const blocks = await getBlockChildren(cfg, pageId)
  // Anchor = the last block before the first child page (end of the old body).
  let anchor: string | undefined
  for (const block of blocks) {
    if (block.type === 'child_page') break
    anchor = block.id
  }
  for (let i = 0; i < children.length; i += MAX_CHILDREN_PER_REQUEST) {
    const ids = await appendBlockChildren(cfg, pageId, children.slice(i, i + MAX_CHILDREN_PER_REQUEST), anchor)
    anchor = ids[ids.length - 1]
  }
  // Remove the old body + old footer heading, sparing real sub-pages.
  for (const block of blocks) {
    if (block.type !== 'child_page') await deleteBlock(cfg, block.id)
  }
}

/**
 * Touch a note: create a body-less scaffold under `parent` (title + icon +
 * banner) and record the resulting page URL in the note's frontmatter, so the
 * URL becomes a known link target. Idempotent — if the note already carries a
 * `kb_notion_mirror_url` it is left untouched and reported as skipped. Creating a
 * child under a page parent refreshes that parent's child-pages footer.
 */
export const touchNote = async (cfg: Config, kbPath: string, parent: NotionParent, options: TouchOptions = {}): Promise<TouchResult> => {
  const { abs, raw, fields, hasFrontmatter } = await readNoteFrontmatter(cfg, kbPath)
  if (!hasFrontmatter) throw new Error('Note has no YAML frontmatter; refusing to mirror.')

  const existing = fields.kb_notion_mirror_url
  if (existing) return { skipped: true, existing_url: existing }

  const title = titleFromPath(abs)
  const banner = bannerBlock(cfg.bannerTemplate, new Date().toISOString().slice(0, 10))
  const children = banner ? [banner] : []
  const titleProperty = parent.type === 'database_id' ? await getDatabaseTitleProperty(cfg, parent.database_id) : undefined

  const page = await createPage(cfg, { parent, title, children, titleProperty, icon: options.icon })
  const publishedAt = normalizePublishedAt(page.created_time)
  await atomicWriteFile(abs, upsertFrontmatterFields(raw, { kb_notion_mirror_url: page.url, kb_notion_mirror_published_at: publishedAt }))

  // A new child page lands in its page parent; refresh that parent's footer.
  // Database parents need none — the database's views already list their rows.
  if (parent.type === 'page_id') await refreshFooterSafe(cfg, parent.page_id)

  return { url: page.url, page_id: page.id, published_at: publishedAt }
}

/**
 * Update a touched note's page body in place under `parent`, applying `linkMap`
 * to resolve `[[wikilinks]]` into `@mentions`. The URL is preserved. REQUIRES the
 * note to already be mirrored (touched) — throws otherwise, so a caller can't
 * render a body whose forward-link targets don't yet exist.
 */
export const updateNote = async (cfg: Config, kbPath: string, parent: NotionParent, options: UpdateOptions = {}): Promise<UpdateResult> => {
  const { abs, raw, fields, hasFrontmatter, body } = await readFullNote(cfg, kbPath)
  if (!hasFrontmatter) throw new Error('Note has no YAML frontmatter; refusing to mirror.')

  const existing = fields.kb_notion_mirror_url
  if (!existing) throw new Error('Note is not mirrored yet — call touch before update.')
  const pageId = extractPageIdFromUrl(existing)
  if (!pageId) throw new Error(`Could not extract a 32-hex page id from kb_notion_mirror_url: ${existing}`)

  const title = titleFromPath(abs)
  // Resolve wikilinks on the stripped body, then turn the mention placeholders
  // martian carried through into real page mentions.
  const rewritten = rewriteWikilinks(body, options.linkMap ?? {})
  const bodyBlocks = convertMentionPlaceholders(bodyToBlocks(rewritten)) as unknown[]

  // Zero-call skip: if nothing that determines the push (body, title, icon,
  // parent) has changed since the last mirror, don't touch Notion at all.
  // `force` bypasses this (manual --force, or a drift reconcile).
  const hash = computeBodyHash({ blocks: bodyBlocks, title, icon: options.icon, parent })
  if (!options.force && fields.kb_notion_mirror_hash === hash) return { skipped: true, url: existing, page_id: pageId, hash }

  const banner = bannerBlock(cfg.bannerTemplate, new Date().toISOString().slice(0, 10))
  const children = banner ? [banner, ...bodyBlocks] : bodyBlocks

  const titleProperty = parent.type === 'database_id' ? await getDatabaseTitleProperty(cfg, parent.database_id) : undefined
  // Read parent before updatePage so we can detect the page_id ↔ database_id
  // silent-failure case Notion exhibits on cross-type re-parents.
  const before = await getPage(cfg, pageId)
  await updatePage(cfg, pageId, { parent, title, titleProperty, icon: options.icon })
  if (before.parent.type !== parent.type) {
    const after = await getPage(cfg, pageId)
    if (JSON.stringify(after.parent) === JSON.stringify(before.parent)) {
      throw new Error('Notion silently ignored the parent change in update mode — cannot move between page-id and database-id parents. Delete the note, then touch it again under the new parent.')
    }
  }
  await replaceBody(cfg, pageId, children)
  // Body replace cleared this page's footer heading; regenerate it. Refresh the
  // OLD parent's footer if we just re-parented away from a page parent, and the
  // new parent's footer if the new parent is a page.
  await refreshFooterSafe(cfg, pageId)
  const oldParentId = pageParentId(before.parent)
  if (oldParentId && oldParentId !== (parent.type === 'page_id' ? parent.page_id : undefined)) await refreshFooterSafe(cfg, oldParentId)
  if (parent.type === 'page_id') await refreshFooterSafe(cfg, parent.page_id)
  // Stamp `published_at` from a FINAL read — after the body + footer writes — so
  // it is >= the page's true last edit; otherwise every page would later look
  // drifted to `--verify`. Stamp the content `hash` so the next run can skip.
  const updatedAt = normalizePublishedAt((await getPage(cfg, pageId)).last_edited_time)
  await atomicWriteFile(abs, upsertFrontmatterFields(raw, { kb_notion_mirror_hash: hash, kb_notion_mirror_published_at: updatedAt }))
  return { url: existing, page_id: pageId, updated_at: updatedAt, hash }
}

/**
 * Baseline a note WITHOUT any Notion call: render the body exactly as `updateNote`
 * would, compute the content hash, and stamp `kb_notion_mirror_hash` +
 * `kb_notion_mirror_published_at`. Valid only when Notion is known to already
 * reflect the note (e.g. straight after a full publish) — it asserts "this is the
 * synced state" so subsequent publishes skip it. Unmirrored notes are left alone.
 */
export const baselineNote = async (cfg: Config, kbPath: string, parent: NotionParent, options: BaselineOptions = {}): Promise<BaselineResult> => {
  const { abs, raw, fields, hasFrontmatter, body } = await readFullNote(cfg, kbPath)
  if (!hasFrontmatter) throw new Error('Note has no YAML frontmatter; refusing to mirror.')

  const existing = fields.kb_notion_mirror_url
  if (!existing) return { skipped: true, reason: 'not-mirrored' }

  const title = titleFromPath(abs)
  const rewritten = rewriteWikilinks(body, options.linkMap ?? {})
  const bodyBlocks = convertMentionPlaceholders(bodyToBlocks(rewritten)) as unknown[]
  const hash = computeBodyHash({ blocks: bodyBlocks, title, icon: options.icon, parent })
  const publishedAt = options.publishedAt ?? normalizePublishedAt(new Date().toISOString())
  await atomicWriteFile(abs, upsertFrontmatterFields(raw, { kb_notion_mirror_hash: hash, kb_notion_mirror_published_at: publishedAt }))
  return { baselined: true, url: existing, hash, published_at: publishedAt }
}

/** Delete the note's mirror page (archive it) and clear the two mirror fields. Dry-run by default. */
export const deleteNote = async (cfg: Config, kbPath: string, dryRun: boolean): Promise<DeleteResult> => {
  const { abs, raw, fields } = await readNoteFrontmatter(cfg, kbPath)
  const mirror = fields.kb_notion_mirror_url
  if (!mirror) return { archived: false, reason: 'not-mirrored' }
  const pageId = extractPageIdFromUrl(mirror)
  if (!pageId) throw new Error(`Could not extract a 32-hex page id from kb_notion_mirror_url: ${mirror}`)

  if (dryRun) {
    return { dry_run: true, would_archive_url: mirror, would_archive_page_id: pageId, would_clear_fields: [...MIRROR_FIELDS] }
  }

  // Learn the parent before archiving so we can refresh its footer afterwards.
  const parentId = pageParentId((await getPage(cfg, pageId)).parent)
  await archivePage(cfg, pageId)
  const cleared = removeFrontmatterFields(raw, [...MIRROR_FIELDS])
  await atomicWriteFile(abs, cleared)

  // The archived child should fall out of its page parent's footer.
  if (parentId) await refreshFooterSafe(cfg, parentId)

  return { archived: true, page_id: pageId, url: mirror }
}

/** Re-parent the note's mirror page to `parent`. No frontmatter change — the URL is stable. */
export const moveNote = async (cfg: Config, kbPath: string, parent: NotionParent): Promise<MoveResult> => {
  const { fields } = await readNoteFrontmatter(cfg, kbPath)
  const mirror = fields.kb_notion_mirror_url
  if (!mirror) throw new Error('Note is not mirrored — cannot move.')
  const pageId = extractPageIdFromUrl(mirror)
  if (!pageId) throw new Error(`Could not extract a 32-hex page id from kb_notion_mirror_url: ${mirror}`)

  const before = await getPage(cfg, pageId)
  await setPageParent(cfg, pageId, parent)

  // Notion silently ignores a parent change that crosses the page-id ↔
  // database-id boundary. Detect it: if the parent type changed but a re-fetch
  // shows the same parent, the move was a no-op.
  if (before.parent.type !== parent.type) {
    const after = await getPage(cfg, pageId)
    if (JSON.stringify(after.parent) === JSON.stringify(before.parent)) {
      throw new Error('Notion silently ignored the parent change — cannot move between page-id and database-id parents. Use delete + touch instead.')
    }
  }

  // The moved child falls out of the old parent's footer and into the new one;
  // refresh both (database parents need no footer).
  const oldParentId = pageParentId(before.parent)
  if (oldParentId) await refreshFooterSafe(cfg, oldParentId)
  if (parent.type === 'page_id') await refreshFooterSafe(cfg, parent.page_id)

  return { moved: true, page_id: pageId, previous_parent: before.parent, new_parent: parent }
}

/** Fetch the live Notion state of the note's mirror page. Pure read — no file mutation. */
export const getNote = async (cfg: Config, kbPath: string): Promise<GetResult> => {
  const { fields } = await readNoteFrontmatter(cfg, kbPath)
  const mirror = fields.kb_notion_mirror_url
  if (!mirror) return { exists: false, reason: 'not-mirrored' }
  const pageId = extractPageIdFromUrl(mirror)
  if (!pageId) throw new Error(`Could not extract a 32-hex page id from kb_notion_mirror_url: ${mirror}`)

  const page = await getPage(cfg, pageId)
  return {
    id: page.id,
    parent: page.parent,
    title: page.title,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    archived: page.archived,
    url: page.url
  }
}

/** Local mirror-state of a note: whether it's mirrored and its URL. No Notion call, no file mutation. */
export const statusNote = async (cfg: Config, kbPath: string): Promise<StatusResult> => {
  const { fields } = await readNoteFrontmatter(cfg, kbPath)
  const url = fields.kb_notion_mirror_url
  if (!url) return { published: false }
  return { published: true, url, published_at: fields.kb_notion_mirror_published_at }
}

/** Local readiness check for a note: would touch/update succeed? No Notion call. */
export const preflightNote = async (cfg: Config, kbPath: string): Promise<PreflightResult> => {
  const { hasFrontmatter } = await readNoteFrontmatter(cfg, kbPath)
  const issues: string[] = []
  if (!hasFrontmatter) issues.push('Note has no YAML frontmatter; cannot be mirrored.')
  return { ok: issues.length === 0, issues }
}
