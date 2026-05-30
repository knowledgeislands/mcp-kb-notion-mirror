import * as fs from 'node:fs/promises'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { WIKI_DATABASE_ID } from '../../config.js'
import { parseFrontmatter, removeFrontmatterFields, upsertFrontmatterFields } from '../../frontmatter.js'
import { findPublishableClosure } from '../../kb-scan.js'
import { buildPageChildren, stripFrontmatter, stripLeadingH1, titleFromPath } from '../../markdown.js'
import { archivePage, createMirrorPage, extractPageIdFromUrl, getDatabaseTitleProperty, getPage, movePage, type NotionParent, normalizePublishedAt } from '../../notion-client.js'
import { type ParentTarget, resolveParentTarget } from '../../parent-lookup.js'
import { DESTRUCTIVE_REMOTE, READ_ONLY, WRITE_REMOTE } from '../../utils/annotations.js'
import { atomicWriteFile } from '../../utils/atomic-write.js'
import { pillarsRootForNote, resolveKbNotePath, resolvePillarsRoot } from '../../utils/paths.js'
import { errorResult, jsonResult } from '../../utils/results.js'

const MIRROR_FIELDS = ['notion_mirror_url', 'notion_mirror_published_at'] as const

const noParentSegment = (s: string): boolean => !s.split(/[\\/]/).includes('..')

const kbPathArg = z
  .string()
  .min(1)
  .max(4096)
  .refine(noParentSegment, 'kb_path must not contain ".." segments')
  .describe('Path to the KB markdown note. Relative paths resolve against MCP_NOTION_MIRROR_KB_ROOT; absolute paths must fall under <KB_ROOT>/Pillars/. ".." segments are rejected.')

const rootArg = z
  .string()
  .min(1)
  .max(4096)
  .refine(noParentSegment, 'root must not contain ".." segments')
  .describe('Absolute path to a KB root containing Pillars/. Defaults to MCP_NOTION_MIRROR_KB_ROOT when omitted.')

const statusInput = z.object({ kb_path: kbPathArg }).strict()
const listInput = z.object({ root: rootArg.optional() }).strict()
const publishInput = z
  .object({
    kb_path: kbPathArg,
    force: z.boolean().default(false).describe('Re-publish even if notion_mirror_url is already set. Archives the existing mirror page first, then creates a fresh one (the URL changes).')
  })
  .strict()
const moveInput = z.object({ kb_path: kbPathArg }).strict()
const archiveInput = z
  .object({
    kb_path: kbPathArg,
    dry_run: z
      .boolean()
      .default(true)
      .describe('When true (default) report what would be archived without calling Notion or touching the note. Set false to actually archive and clear the mirror frontmatter fields.')
  })
  .strict()

/** The auto-derived parent state for the status tool. */
const statusParent = (target: ParentTarget): Record<string, unknown> => {
  switch (target.kind) {
    case 'database-root':
      return { kb_path: null, kb_exists: false, mirror_url: null, mirror_published: true, parent_type: 'wiki-database-root' }
    case 'page':
      return { kb_path: target.parentKbPath, kb_exists: true, mirror_url: target.mirrorUrl, mirror_published: true }
    case 'missing-index':
      return { kb_path: target.parentKbPath, kb_exists: false, mirror_url: null, mirror_published: false }
    case 'parent-unpublished':
      return { kb_path: target.parentKbPath, kb_exists: true, mirror_url: null, mirror_published: false }
    case 'malformed-parent-url':
      return { kb_path: target.parentKbPath, kb_exists: true, mirror_url: target.mirrorUrl, mirror_published: false }
  }
}

const blockedBy = (target: ParentTarget): string | null => {
  switch (target.kind) {
    case 'missing-index':
      return 'missing-folder-index'
    case 'parent-unpublished':
    case 'malformed-parent-url':
      return 'parent-not-published'
    default:
      return null
  }
}

/**
 * Map a non-publishable parent target to its `errorResult` message; null when
 * the target is publishable (database-root or an already-mirrored page). Shared
 * by publish and move so both surface identical parent-blocking errors.
 */
const parentBlockMessage = (target: ParentTarget): string | null => {
  switch (target.kind) {
    case 'missing-index':
      return `Folder index missing: ${target.parentKbPath}. Every folder under Pillars/ must have an index note named after the folder.`
    case 'parent-unpublished':
      return `Publish parent first: ${target.parentKbPath}`
    case 'malformed-parent-url':
      return `Parent note has a malformed notion_mirror_url: ${target.parentKbPath}`
    default:
      return null
  }
}

export const registerNotesTools = (server: McpServer): void => {
  server.registerTool(
    'notion_mirror_note_status',
    {
      title: 'Show the mirror state of a KB note',
      description: `Report the mirror state of a single KB note from its frontmatter, plus its auto-derived Notion parent — no Notion call.

Args:
  - kb_path (string, required): path to the KB markdown note.

Returns:
  JSON: { kb_path, notion_source_url, notion_mirror_url, notion_mirror_published_at, status, next_run, next_run_with_force, parent, publish_blocked_by }.
  - status: "published" if notion_mirror_url is set, else "unpublished".
  - next_run / next_run_with_force: what publish would do (publish | skip | republish).
  - parent: { kb_path, kb_exists, mirror_url, mirror_published[, parent_type] } — the folder-index page this note will be nested under.
  - publish_blocked_by: null | "missing-folder-index" | "parent-not-published".

Errors:
  - "Note has no YAML frontmatter." — the file lacks a leading --- block.
  - path errors when kb_path escapes <KB_ROOT>/Pillars/.`,
      inputSchema: statusInput,
      annotations: READ_ONLY
    },
    async ({ kb_path }) => {
      try {
        const abs = resolveKbNotePath(kb_path)
        const text = await fs.readFile(abs, 'utf-8')
        const { hasFrontmatter, fields } = parseFrontmatter(text)
        if (!hasFrontmatter) return errorResult('reading note status', new Error('Note has no YAML frontmatter.'))
        const mirror = fields.notion_mirror_url
        const target = await resolveParentTarget(abs, pillarsRootForNote(abs))
        return jsonResult({
          kb_path: abs,
          notion_source_url: fields.notion_source_url ?? null,
          notion_mirror_url: mirror ?? null,
          notion_mirror_published_at: fields.notion_mirror_published_at ?? null,
          status: mirror ? 'published' : 'unpublished',
          next_run: mirror ? 'skip' : 'publish',
          next_run_with_force: mirror ? 'republish' : 'publish',
          parent: statusParent(target),
          publish_blocked_by: blockedBy(target)
        })
      } catch (err) {
        return errorResult('reading note status', err)
      }
    }
  )

  server.registerTool(
    'notion_mirror_unpublished_list',
    {
      title: 'List KB notes awaiting a mirror, in publish order',
      description: `List the publishable closure under <root>/Pillars/: every note drained from Notion (notion_source_url set, no notion_mirror_url) PLUS every required folder-index ancestor that isn't mirrored yet. Sorted in tree order so iterating the result top-to-bottom always publishes parents before children. No Notion call.

Args:
  - root (string, optional): absolute KB root containing Pillars/. Defaults to MCP_NOTION_MIRROR_KB_ROOT.

Returns:
  JSON: { root, count, notes: [path, ...], details: [{ path, source_url? }, ...] }.
  Index notes have no source_url, so the field is omitted from their details entry.

Bulk publishing is the caller's job: iterate notes here (already in dependency order) and call notion_mirror_note_publish per path.

Errors:
  - "No KB root given and MCP_NOTION_MIRROR_KB_ROOT is not set." — pass an absolute root or set the env var.`,
      inputSchema: listInput,
      annotations: READ_ONLY
    },
    async ({ root }) => {
      try {
        const pillars = resolvePillarsRoot(root)
        const notes = await findPublishableClosure(pillars)
        return jsonResult({
          root: pillars,
          count: notes.length,
          notes: notes.map((n) => n.path),
          details: notes.map((n) => (n.source_url ? { path: n.path, source_url: n.source_url } : { path: n.path }))
        })
      } catch (err) {
        return errorResult('listing unpublished notes', err)
      }
    }
  )

  server.registerTool(
    'notion_mirror_note_publish',
    {
      title: 'Publish a KB note to the Notion mirror',
      description: `Mirror one KB markdown note to the Notion wiki, nested under its folder-index parent, and record the resulting page URL in the note's frontmatter.

Parent is auto-derived from the KB path: the pillars root (Pillars/Pillars.md) parents at the wiki database; a folder index parents at its grandparent's index; any other note parents at its folder's index. The parent must already be published — publish parents-first (see notion_mirror_unpublished_list ordering).

Args:
  - kb_path (string, required): path to the KB markdown note.
  - force (boolean, default false): re-publish even if already mirrored. Archives the old mirror page first, then creates a new one (URL changes).

Returns:
  - On publish: { url, page_id, published_at }.
  - On skip (already mirrored, no force): { skipped: true, existing_url }.

Errors:
  - "Folder index missing: <path>" — a required folder index note is absent on disk (fix the KB).
  - "Publish parent first: <path>" — the parent index isn't mirrored yet.
  - "Note has no YAML frontmatter; refusing to publish."
  - "Notion POST /v1/pages → HTTP 401/403" — token invalid or integration not connected to the wiki.`,
      inputSchema: publishInput,
      annotations: WRITE_REMOTE
    },
    async ({ kb_path, force }) => {
      try {
        const abs = resolveKbNotePath(kb_path)
        const raw = await fs.readFile(abs, 'utf-8')
        const { hasFrontmatter, fields } = parseFrontmatter(raw)
        if (!hasFrontmatter) return errorResult('publishing note', new Error('Note has no YAML frontmatter; refusing to publish.'))

        const existing = fields.notion_mirror_url
        if (existing && !force) return jsonResult({ skipped: true, existing_url: existing })

        const target = await resolveParentTarget(abs, pillarsRootForNote(abs))
        const block = parentBlockMessage(target)
        if (block) return errorResult('publishing note', new Error(block))

        let parent: NotionParent
        let titleProperty: string | undefined
        if (target.kind === 'database-root') {
          parent = { type: 'database_id', database_id: WIKI_DATABASE_ID }
          titleProperty = await getDatabaseTitleProperty(WIKI_DATABASE_ID)
        } else {
          // narrowed to the publishable 'page' kind by parentBlockMessage above
          parent = { type: 'page_id', page_id: (target as Extract<ParentTarget, { kind: 'page' }>).pageId }
        }

        if (existing && force) {
          const oldId = extractPageIdFromUrl(existing)
          // Archive the stale mirror, but continue even if it's already gone.
          if (oldId) await archivePage(oldId).catch(() => undefined)
        }

        const title = titleFromPath(abs)
        const body = stripLeadingH1(stripFrontmatter(raw))
        const dateStr = new Date().toISOString().slice(0, 10)
        const children = buildPageChildren(body, dateStr)
        const page = await createMirrorPage({ parent, title, children, titleProperty })
        const publishedAt = normalizePublishedAt(page.created_time)

        const updated = upsertFrontmatterFields(raw, { notion_mirror_url: page.url, notion_mirror_published_at: publishedAt })
        await atomicWriteFile(abs, updated)

        return jsonResult({ url: page.url, page_id: page.id, published_at: publishedAt })
      } catch (err) {
        return errorResult('publishing note', err)
      }
    }
  )

  server.registerTool(
    'notion_mirror_note_move',
    {
      title: 'Re-parent an already-published mirror page',
      description: `Move an already-published mirror page under its auto-derived folder-index parent (same resolution rule as publish). The page content and URL are unchanged — only its position in the wiki tree. Used to re-home legacy flat-rooted pages, or fix a misplaced page.

Args:
  - kb_path (string, required): path to the KB markdown note (must already have notion_mirror_url).

Returns:
  JSON: { moved: true, page_id, previous_parent, new_parent } — parents in Notion's shape ({ type, page_id|database_id }).

Errors:
  - "Note is not published — cannot move." — no notion_mirror_url on the note.
  - "Publish parent first: <path>" — the destination parent index isn't mirrored yet.
  - "Folder index missing: <path>" — a required folder index is absent on disk.`,
      inputSchema: moveInput,
      annotations: WRITE_REMOTE
    },
    async ({ kb_path }) => {
      try {
        const abs = resolveKbNotePath(kb_path)
        const raw = await fs.readFile(abs, 'utf-8')
        const { hasFrontmatter, fields } = parseFrontmatter(raw)
        if (!hasFrontmatter) return errorResult('moving note', new Error('Note has no YAML frontmatter.'))
        const mirror = fields.notion_mirror_url
        if (!mirror) return errorResult('moving note', new Error('Note is not published — cannot move.'))
        const pageId = extractPageIdFromUrl(mirror)
        if (!pageId) return errorResult('moving note', new Error(`Note has a malformed notion_mirror_url: ${mirror}`))

        const target = await resolveParentTarget(abs, pillarsRootForNote(abs))
        const block = parentBlockMessage(target)
        if (block) return errorResult('moving note', new Error(block))

        const newParent: NotionParent =
          target.kind === 'database-root' ? { type: 'database_id', database_id: WIKI_DATABASE_ID } : { type: 'page_id', page_id: (target as Extract<ParentTarget, { kind: 'page' }>).pageId }

        const current = await getPage(pageId)
        await movePage(pageId, newParent)
        return jsonResult({ moved: true, page_id: pageId, previous_parent: current.parent, new_parent: newParent })
      } catch (err) {
        return errorResult('moving note', err)
      }
    }
  )

  server.registerTool(
    'notion_mirror_note_archive',
    {
      title: 'Archive a KB note Notion mirror page',
      description: `Archive the Notion page referenced by a note's notion_mirror_url and clear the two mirror frontmatter fields. Destructive — defaults to a dry run.

Args:
  - kb_path (string, required): path to the KB markdown note.
  - dry_run (boolean, default true): when true, report what would happen WITHOUT calling Notion or editing the note.

Returns:
  - dry_run true: { dry_run: true, would_archive_page_id, would_archive_url, would_clear_fields }.
  - dry_run false: { archived: true, page_id, url }.
  - note not mirrored: { archived: false, reason }.

Errors:
  - "Note has no YAML frontmatter." — the note lacks a leading --- block.
  - "Could not extract a 32-hex page id …" — the notion_mirror_url is malformed.`,
      inputSchema: archiveInput,
      annotations: DESTRUCTIVE_REMOTE
    },
    async ({ kb_path, dry_run }) => {
      try {
        const abs = resolveKbNotePath(kb_path)
        const raw = await fs.readFile(abs, 'utf-8')
        const { hasFrontmatter, fields } = parseFrontmatter(raw)
        if (!hasFrontmatter) return errorResult('archiving note mirror', new Error('Note has no YAML frontmatter.'))

        const mirror = fields.notion_mirror_url
        if (!mirror) return jsonResult({ archived: false, reason: 'Note has no notion_mirror_url; nothing to archive.' })
        const pageId = extractPageIdFromUrl(mirror)
        if (!pageId) return errorResult('archiving note mirror', new Error(`Could not extract a 32-hex page id from notion_mirror_url: ${mirror}`))

        if (dry_run) {
          return jsonResult({ dry_run: true, would_archive_page_id: pageId, would_archive_url: mirror, would_clear_fields: [...MIRROR_FIELDS] })
        }

        await archivePage(pageId)
        const cleared = removeFrontmatterFields(raw, [...MIRROR_FIELDS])
        await atomicWriteFile(abs, cleared)
        return jsonResult({ archived: true, page_id: pageId, url: mirror })
      } catch (err) {
        return errorResult('archiving note mirror', err)
      }
    }
  )
}
