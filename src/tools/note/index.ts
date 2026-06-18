import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { deleteNote, getNote, moveNote, preflightNote, statusNote, touchNote, updateNote } from '../../main/notes/index.js'
import type { NotionIcon, NotionParent } from '../../main/notion-client/index.js'
import { DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, WRITE_REMOTE_IDEMPOTENT } from '../../utils/annotations.js'
import { parentArg } from '../../utils/notion-args.js'
import { errorResult, jsonResult } from '../../utils/results.js'

const noParentSegment = (s: string): boolean => !s.split(/[\\/]/).includes('..')

const kbPathArg = z
  .string()
  .min(1)
  .max(4096)
  .refine(noParentSegment, 'kb_path must not contain ".." segments')
  .describe('Path to the KB markdown note. Relative paths resolve against MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".." segments are rejected.')

const iconArg = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('emoji'), emoji: z.string().min(1).max(64) }).strict(),
    z.object({ type: z.literal('external'), external: z.object({ url: z.string().url().max(2048) }).strict() }).strict()
  ])
  .describe('Notion page icon, passed verbatim: { type: "emoji", emoji } or { type: "external", external: { url } }. Omit for no icon.')

const linkMapArg = z
  .record(z.string().max(1024), z.string().max(2048))
  .describe(
    "Wikilink resolution: maps a [[target]] string to that note's mirror URL. Resolved [[…]] become Notion @mentions; unresolved ones render as italic text. Omit/empty → all wikilinks italic."
  )

const getInput = z.object({ kb_path: kbPathArg }).strict()
const statusInput = z.object({ kb_path: kbPathArg }).strict()
const preflightInput = z.object({ kb_path: kbPathArg }).strict()
const touchInput = z.object({ kb_path: kbPathArg, parent: parentArg, icon: iconArg.optional() }).strict()
const updateInput = z.object({ kb_path: kbPathArg, parent: parentArg, icon: iconArg.optional(), link_map: linkMapArg.optional() }).strict()
const moveInput = z.object({ kb_path: kbPathArg, parent: parentArg }).strict()
const deleteInput = z
  .object({
    kb_path: kbPathArg,
    dry_run: z
      .boolean()
      .default(true)
      .describe('When true (default) report what would be archived without calling Notion or editing the note. Set false to actually archive and clear the mirror frontmatter fields.')
  })
  .strict()

const notionParent = z.record(z.string(), z.unknown())

const getNoteOutput = z.union([
  z.object({ id: z.string(), parent: notionParent, title: z.string().nullable(), created_time: z.string(), last_edited_time: z.string(), archived: z.boolean(), url: z.string() }),
  z.object({ exists: z.literal(false), reason: z.string() })
])

const statusNoteOutput = z.union([z.object({ published: z.literal(true), url: z.string(), published_at: z.string() }), z.object({ published: z.literal(false) })])

const preflightNoteOutput = z.object({ ok: z.boolean(), issues: z.array(z.string()) })

const touchNoteOutput = z.union([z.object({ url: z.string(), page_id: z.string(), published_at: z.string() }), z.object({ skipped: z.literal(true), existing_url: z.string() })])

const updateNoteOutput = z.object({ url: z.string(), page_id: z.string(), updated_at: z.string() })

const moveNoteOutput = z.object({ moved: z.literal(true), page_id: z.string(), previous_parent: notionParent, new_parent: notionParent })

const deleteNoteOutput = z.union([
  z.object({ dry_run: z.literal(true), would_archive_url: z.string(), would_archive_page_id: z.string(), would_clear_fields: z.array(z.string()) }),
  z.object({ archived: z.literal(true), page_id: z.string(), url: z.string() }),
  z.object({ archived: z.literal(false), reason: z.string() })
])

export const registerNoteTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'kb_notion_mirror_note_get',
    {
      title: 'Fetch the live Notion state of a note mirror page',
      description: `Fetch the live Notion page referenced by a note's kb_notion_mirror_url. Pure read — no Notion mutation, no file change.

Args:
  - kb_path (string, required): path to the KB markdown note.

Returns:
  - { id, parent, title, created_time, last_edited_time, archived, url }.
  - note not mirrored: { exists: false, reason: "not-mirrored" }.

Errors:
  - "Could not extract a 32-hex page id …" — the kb_notion_mirror_url is malformed.
  - "Notion GET /v1/pages/{id} → HTTP 404" — the page was deleted in Notion.`,
      inputSchema: getInput,
      outputSchema: getNoteOutput,
      annotations: READ_ONLY_REMOTE
    },
    async ({ kb_path }) => {
      try {
        return jsonResult(await getNote(cfg, kb_path))
      } catch (err) {
        return errorResult('getting note mirror', err)
      }
    }
  )

  server.registerTool(
    'kb_notion_mirror_note_status',
    {
      title: 'Local mirror-state of a note',
      description: `Report whether a note is mirrored, from its frontmatter only. No Notion call, no file change.

Args:
  - kb_path (string, required): path to the KB markdown note.

Returns: { published: true, url, published_at } | { published: false }.`,
      inputSchema: statusInput,
      outputSchema: statusNoteOutput,
      annotations: READ_ONLY_REMOTE
    },
    async ({ kb_path }) => {
      try {
        return jsonResult(await statusNote(cfg, kb_path))
      } catch (err) {
        return errorResult('reading note status', err)
      }
    }
  )

  server.registerTool(
    'kb_notion_mirror_note_preflight',
    {
      title: 'Check a note is ready to mirror',
      description: `Local readiness check for a single note — currently, that it has YAML frontmatter to write the mirror URL back into. No Notion call.

Args:
  - kb_path (string, required): path to the KB markdown note.

Returns: { ok: boolean, issues: string[] } — empty issues when the note is mirror-ready.`,
      inputSchema: preflightInput,
      outputSchema: preflightNoteOutput,
      annotations: READ_ONLY_REMOTE
    },
    async ({ kb_path }) => {
      try {
        return jsonResult(await preflightNote(cfg, kb_path))
      } catch (err) {
        return errorResult('preflighting note', err)
      }
    }
  )

  server.registerTool(
    'kb_notion_mirror_note_touch',
    {
      title: 'Create a placeholder mirror page so its URL becomes known',
      description: `Create a body-less scaffold page (title + icon + banner) for one KB note under the parent you supply, and record the resulting page URL in the note's frontmatter. This makes the URL a known link target BEFORE any body is rendered. Idempotent: a note that already has a kb_notion_mirror_url is left untouched.

There is no separate "create" — touch is how a page comes into existence; call update afterwards to push the body and resolve wikilinks.

Args:
  - kb_path (string, required): path to the KB markdown note.
  - parent (object, required): { type: "database_id", database_id } or { type: "page_id", page_id }. Passed to Notion verbatim.
  - icon (object, optional): { type: "emoji", emoji } or { type: "external", external: { url } }.

Returns:
  - created: { url, page_id, published_at }.
  - already mirrored: { skipped: true, existing_url }.

Side effect: when parent.type is "page_id", the parent's "Child Pages" footer is refreshed (mirror-only).`,
      inputSchema: touchInput,
      outputSchema: touchNoteOutput,
      annotations: WRITE_REMOTE_IDEMPOTENT
    },
    async ({ kb_path, parent, icon }) => {
      try {
        return jsonResult(await touchNote(cfg, kb_path, parent as NotionParent, { icon: icon as NotionIcon | undefined }))
      } catch (err) {
        return errorResult('touching note', err)
      }
    }
  )

  server.registerTool(
    'kb_notion_mirror_note_update',
    {
      title: 'Push a note body to its mirror page, resolving wikilinks',
      description: `Update a touched note's Notion page body in place, applying a link_map to turn [[wikilinks]] into @mentions. The page URL is preserved. REQUIRES a prior touch — errors if the note isn't mirrored yet, so a body never renders before its forward-link targets exist.

Body-destructive: replaces the old body blocks (and any block-level comments on them); child pages and page-level comments are preserved.

Args:
  - kb_path (string, required): path to the KB markdown note.
  - parent (object, required): same shape as touch; normally the parent the note was touched under.
  - icon (object, optional): page icon; omit to leave the existing icon unchanged.
  - link_map (object, optional): { "[[target]] text": "mirror url" }. Resolved wikilinks become @mentions; unresolved ones render italic.

Returns: { url, page_id, updated_at }.

Errors:
  - "Note is not mirrored yet — call touch before update."
  - "Notion silently ignored the parent change in update mode …" — page-id ↔ database-id move attempted.`,
      inputSchema: updateInput,
      outputSchema: updateNoteOutput,
      annotations: WRITE_REMOTE_IDEMPOTENT
    },
    async ({ kb_path, parent, icon, link_map }) => {
      try {
        return jsonResult(await updateNote(cfg, kb_path, parent as NotionParent, { icon: icon as NotionIcon | undefined, linkMap: link_map }))
      } catch (err) {
        return errorResult('updating note', err)
      }
    }
  )

  server.registerTool(
    'kb_notion_mirror_note_move',
    {
      title: 'Re-parent an already-mirrored note page',
      description: `Move an already-mirrored note's page under a caller-supplied parent. The page content and URL are unchanged — only its position in the Notion tree. No frontmatter change.

Caveat: Notion cannot move a page between a page_id parent and a database_id parent — PATCH /v1/pages silently ignores it. This tool detects that case and errors clearly; use delete + touch instead.

Args:
  - kb_path (string, required): the KB markdown note (must already have kb_notion_mirror_url).
  - parent (object, required): the new Notion parent, same shape as touch.

Returns: { moved: true, page_id, previous_parent, new_parent }.

Errors:
  - "Note is not mirrored — cannot move."
  - "Notion silently ignored the parent change …" — page-id ↔ database-id move attempted.`,
      inputSchema: moveInput,
      outputSchema: moveNoteOutput,
      annotations: WRITE_REMOTE_IDEMPOTENT
    },
    async ({ kb_path, parent }) => {
      try {
        return jsonResult(await moveNote(cfg, kb_path, parent as NotionParent))
      } catch (err) {
        return errorResult('moving note', err)
      }
    }
  )

  server.registerTool(
    'kb_notion_mirror_note_delete',
    {
      title: 'Archive a note mirror page',
      description: `Archive the Notion page referenced by a note's kb_notion_mirror_url and clear the two mirror frontmatter fields. Destructive — defaults to a dry run. Archiving breaks any @mention pointing at this page, hence the preview default.

Caveat: archiving cascade-archives descendant pages on the Notion side. This tool only clears the one note's frontmatter; descendants' frontmatter still points at now-archived pages (caller's responsibility — use tree delete to clear a whole subtree).

Args:
  - kb_path (string, required): path to the KB markdown note.
  - dry_run (boolean, default true): when true, report what would happen WITHOUT calling Notion or editing the note.

Returns:
  - dry_run true: { dry_run: true, would_archive_url, would_archive_page_id, would_clear_fields }.
  - dry_run false: { archived: true, page_id, url }.
  - note not mirrored: { archived: false, reason: "not-mirrored" }.`,
      inputSchema: deleteInput,
      outputSchema: deleteNoteOutput,
      annotations: DESTRUCTIVE_REMOTE
    },
    async ({ kb_path, dry_run }) => {
      try {
        return jsonResult(await deleteNote(cfg, kb_path, dry_run))
      } catch (err) {
        return errorResult('deleting note mirror', err)
      }
    }
  )
}
