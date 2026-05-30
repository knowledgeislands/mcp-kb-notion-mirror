import * as fs from 'node:fs/promises'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { WIKI_DATABASE_ID } from '../../config.js'
import { parseFrontmatter, removeFrontmatterFields, upsertFrontmatterFields } from '../../frontmatter.js'
import { findUnpublishedNotes } from '../../kb-scan.js'
import { buildPageChildren, stripFrontmatter, stripLeadingH1, titleFromPath } from '../../markdown.js'
import { archivePage, createMirrorPage, extractPageIdFromUrl, getDatabaseTitleProperty, normalizePublishedAt } from '../../notion-client.js'
import { DESTRUCTIVE_REMOTE, READ_ONLY, WRITE_REMOTE } from '../../utils/annotations.js'
import { atomicWriteFile } from '../../utils/atomic-write.js'
import { resolveKbNotePath, resolvePillarsRoot } from '../../utils/paths.js'
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
const archiveInput = z
  .object({
    kb_path: kbPathArg,
    dry_run: z
      .boolean()
      .default(true)
      .describe('When true (default) report what would be archived without calling Notion or touching the note. Set false to actually archive and clear the mirror frontmatter fields.')
  })
  .strict()

export const registerNotesTools = (server: McpServer): void => {
  server.registerTool(
    'notion_mirror_note_status',
    {
      title: 'Show the mirror state of a KB note',
      description: `Report the mirror state of a single KB note from its frontmatter — no Notion call.

Args:
  - kb_path (string, required): path to the KB markdown note.

Returns:
  JSON: { kb_path, notion_source_url, notion_mirror_url, notion_mirror_published_at, status, next_run, next_run_with_force }.
  - status: "published" if notion_mirror_url is set, else "unpublished".
  - next_run: what notion_mirror_note_publish would do with no force ("publish" | "skip").
  - next_run_with_force: what it would do with force:true ("publish" | "republish").

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
        return jsonResult({
          kb_path: abs,
          notion_source_url: fields.notion_source_url ?? null,
          notion_mirror_url: mirror ?? null,
          notion_mirror_published_at: fields.notion_mirror_published_at ?? null,
          status: mirror ? 'published' : 'unpublished',
          next_run: mirror ? 'skip' : 'publish',
          next_run_with_force: mirror ? 'republish' : 'publish'
        })
      } catch (err) {
        return errorResult('reading note status', err)
      }
    }
  )

  server.registerTool(
    'notion_mirror_unpublished_list',
    {
      title: 'List KB notes awaiting a mirror',
      description: `List KB notes under <root>/Pillars/ that have notion_source_url but no notion_mirror_url — i.e. drained from Notion but not yet mirrored back. No Notion call.

Args:
  - root (string, optional): absolute KB root containing Pillars/. Defaults to MCP_NOTION_MIRROR_KB_ROOT.

Returns:
  JSON: { root, count, notes: [path, ...], details: [{ path, source_url }, ...] }.

Bulk publishing is the caller's job: iterate notes here and call notion_mirror_note_publish per path, pacing/rate-limiting as you go.

Errors:
  - "No KB root given and MCP_NOTION_MIRROR_KB_ROOT is not set." — pass an absolute root or set the env var.`,
      inputSchema: listInput,
      annotations: READ_ONLY
    },
    async ({ root }) => {
      try {
        const pillars = resolvePillarsRoot(root)
        const notes = await findUnpublishedNotes(pillars)
        return jsonResult({ root: pillars, count: notes.length, notes: notes.map((n) => n.path), details: notes })
      } catch (err) {
        return errorResult('listing unpublished notes', err)
      }
    }
  )

  server.registerTool(
    'notion_mirror_note_publish',
    {
      title: 'Publish a KB note to the Notion mirror',
      description: `Mirror one KB markdown note to the Notion wiki and record the resulting page URL back into the note's frontmatter.

Pipeline: parse frontmatter → (skip if already mirrored and not forced) → strip frontmatter + leading H1 → convert markdown to Notion blocks (via @tryfabric/martian) → prepend a "Mirrored from KB" banner → create the page → write notion_mirror_url + notion_mirror_published_at back atomically.

Args:
  - kb_path (string, required): path to the KB markdown note.
  - force (boolean, default false): re-publish even if already mirrored. Archives the old mirror page first, then creates a new one (URL changes).

Returns:
  - On publish: { url, page_id, published_at }.
  - On skip (already mirrored, no force): { skipped: true, existing_url }.

Errors:
  - "Note has no YAML frontmatter; refusing to publish." — the note lacks a leading --- block.
  - "Notion POST /v1/pages → HTTP 401/403" — token invalid, or the integration is not connected to the wiki.
  - path errors when kb_path escapes <KB_ROOT>/Pillars/.`,
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
        if (existing && force) {
          const oldId = extractPageIdFromUrl(existing)
          // Archive the stale mirror, but continue even if it's already gone.
          if (oldId) await archivePage(oldId).catch(() => undefined)
        }

        const title = titleFromPath(abs)
        const body = stripLeadingH1(stripFrontmatter(raw))
        const dateStr = new Date().toISOString().slice(0, 10)
        const children = buildPageChildren(body, dateStr)
        const titleProperty = await getDatabaseTitleProperty(WIKI_DATABASE_ID)
        const page = await createMirrorPage({ databaseId: WIKI_DATABASE_ID, titleProperty, title, children })
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
