// Generated on 2026-06-27T20:37:57.185Z by @knowledgeislands/mcp-kb-notion-mirror@1.0.0
// Server: hnr-mcp-kb-notion-mirror
// Source: /Users/krisbrown/.mcporter/mcporter.json
// Transport: STDIO /Users/krisbrown/.local/share/mise/installs/node/lts/bin/node /Users/krisbrown/kis/knowledgeislands/mcp-kb-notion-mirror/dist/mcp-server/index.js

import type { CallResult } from 'mcporter'

export interface HnrMcpKbNotionMirrorTools {
  /**
   * Fetch the live Notion page referenced by a note's kb_notion_mirror_url. Pure read — no Notion
   * mutation, no file change.
   * Args:
   * - kb_path (string, required): path to the KB markdown note.
   * Returns:
   * - { id, parent, title, created_time, last_edited_time, archived, url }.
   * - note not mirrored: { exists: false, reason: "not-mirrored" }.
   * Errors:
   * - "Could not extract a 32-hex page id …" — the kb_notion_mirror_url is malformed.
   * - "Notion GET /v1/pages/{id} → HTTP 404" — the page was deleted in Notion.
   *
   * @param kb_path Path to the KB markdown note. Relative paths resolve against
   *                MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".."
   *                segments are rejected.
   */
  kb_notion_mirror_note_get(kb_path: string): Promise<CallResult>

  /**
   * Report whether a note is mirrored, from its frontmatter only. No Notion call, no file change.
   * Args:
   * - kb_path (string, required): path to the KB markdown note.
   * Returns: { published: true, url, published_at } | { published: false }.
   *
   * @param kb_path Path to the KB markdown note. Relative paths resolve against
   *                MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".."
   *                segments are rejected.
   */
  kb_notion_mirror_note_status(kb_path: string): Promise<CallResult>

  /**
   * Local readiness check for a single note — currently, that it has YAML frontmatter to write the
   * mirror URL back into. No Notion call.
   * Args:
   * - kb_path (string, required): path to the KB markdown note.
   * Returns: { ok: boolean, issues: string[] } — empty issues when the note is mirror-ready.
   *
   * @param kb_path Path to the KB markdown note. Relative paths resolve against
   *                MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".."
   *                segments are rejected.
   */
  kb_notion_mirror_note_preflight(kb_path: string): Promise<object>

  /**
   * Create a body-less scaffold page (title + icon + banner) for one KB note under the parent you
   * supply, and record the resulting page URL in the note's frontmatter. This makes the URL a known link
   * target BEFORE any body is rendered. Idempotent: a note that already has a kb_notion_mirror_url is
   * left untouched.
   * There is no separate "create" — touch is how a page comes into existence; call update afterwards to
   * push the body and resolve wikilinks.
   * Args:
   * - kb_path (string, required): path to the KB markdown note.
   * - parent (object, required): { type: "database_id", database_id } or { type: "page_id", page_id }.
   * Passed to Notion verbatim.
   * - icon (object, optional): { type: "emoji", emoji } or { type: "external", external: { url } }.
   * Returns:
   * - created: { url, page_id, published_at }.
   * - already mirrored: { skipped: true, existing_url }.
   * Side effect: when parent.type is "page_id", the parent's "Child Pages" footer is refreshed
   * (mirror-only).
   *
   * @param kb_path Path to the KB markdown note. Relative paths resolve against
   *                MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".."
   *                segments are rejected.
   * @param parent Notion parent object, passed to Notion verbatim: { type: "database_id", database_id }
   *               or { type: "page_id", page_id }. The caller decides which.
   * @param icon? Notion page icon, passed verbatim: { type: "emoji", emoji } or { type: "external",
   *              external: { url } }. Omit for no icon.
   */
  kb_notion_mirror_note_touch(kb_path: string, parent: unknown, icon?: unknown): Promise<CallResult>

  /**
   * Update a touched note's Notion page body in place, applying a link_map to turn [[wikilinks]] into
   * @mentions. The page URL is preserved. REQUIRES a prior touch — errors if the note isn't mirrored
   * yet, so a body never renders before its forward-link targets exist.
   * Body-destructive: replaces the old body blocks (and any block-level comments on them); child pages
   * and page-level comments are preserved.
   * Args:
   * - kb_path (string, required): path to the KB markdown note.
   * - parent (object, required): same shape as touch; normally the parent the note was touched under.
   * - icon (object, optional): page icon; omit to leave the existing icon unchanged.
   * - link_map (object, optional): { "[[target]] text": "mirror url" }. Resolved wikilinks become
   * @mentions; unresolved ones render italic.
   * Returns: { url, page_id, updated_at }.
   * Errors:
   * - "Note is not mirrored yet — call touch before update."
   * - "Notion silently ignored the parent change in update mode …" — page-id ↔ database-id move
   * attempted.
   *
   * @param kb_path Path to the KB markdown note. Relative paths resolve against
   *                MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".."
   *                segments are rejected.
   * @param parent Notion parent object, passed to Notion verbatim: { type: "database_id", database_id }
   *               or { type: "page_id", page_id }. The caller decides which.
   * @param icon? Notion page icon, passed verbatim: { type: "emoji", emoji } or { type: "external",
   *              external: { url } }. Omit for no icon.
   * @param link_map? Wikilink resolution: maps a [[target]] string to that note's mirror URL. Resolved
   *                  [[…]] become Notion @mentions; unresolved ones render as italic text. Omit/empty →
   *                  all wikilinks italic.
   */
  kb_notion_mirror_note_update(kb_path: string, parent: unknown, icon?: unknown, link_map?: Record<string, unknown>): Promise<object>

  /**
   * Move an already-mirrored note's page under a caller-supplied parent. The page content and URL are
   * unchanged — only its position in the Notion tree. No frontmatter change.
   * Caveat: Notion cannot move a page between a page_id parent and a database_id parent — PATCH
   * /v1/pages silently ignores it. This tool detects that case and errors clearly; use delete + touch
   * instead.
   * Args:
   * - kb_path (string, required): the KB markdown note (must already have kb_notion_mirror_url).
   * - parent (object, required): the new Notion parent, same shape as touch.
   * Returns: { moved: true, page_id, previous_parent, new_parent }.
   * Errors:
   * - "Note is not mirrored — cannot move."
   * - "Notion silently ignored the parent change …" — page-id ↔ database-id move attempted.
   *
   * @param kb_path Path to the KB markdown note. Relative paths resolve against
   *                MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".."
   *                segments are rejected.
   * @param parent Notion parent object, passed to Notion verbatim: { type: "database_id", database_id }
   *               or { type: "page_id", page_id }. The caller decides which.
   */
  kb_notion_mirror_note_move(kb_path: string, parent: unknown): Promise<object>

  /**
   * Archive the Notion page referenced by a note's kb_notion_mirror_url and clear the two mirror
   * frontmatter fields. Destructive — defaults to a dry run. Archiving breaks any @mention pointing at
   * this page, hence the preview default.
   * Caveat: archiving cascade-archives descendant pages on the Notion side. This tool only clears the
   * one note's frontmatter; descendants' frontmatter still points at now-archived pages (caller's
   * responsibility — use tree delete to clear a whole subtree).
   * Args:
   * - kb_path (string, required): path to the KB markdown note.
   * - dry_run (boolean, default true): when true, report what would happen WITHOUT calling Notion or
   * editing the note.
   * Returns:
   * - dry_run true: { dry_run: true, would_archive_url, would_archive_page_id, would_clear_fields }.
   * - dry_run false: { archived: true, page_id, url }.
   * - note not mirrored: { archived: false, reason: "not-mirrored" }.
   *
   * @param kb_path Path to the KB markdown note. Relative paths resolve against
   *                MCP_KB_NOTION_MIRROR_KB_ROOT; absolute paths must fall under it when set. ".."
   *                segments are rejected.
   * @param dry_run? When true (default) report what would be archived without calling Notion or editing
   *                 the note. Set false to actually archive and clear the mirror frontmatter fields.
   */
  kb_notion_mirror_note_delete(kb_path: string, dry_run?: boolean): Promise<CallResult>

  /**
   * Report which notes in a KB subtree are already mirrored to Notion, ordered the way a touch/update
   * would visit them.
   * Args:
   * - subtree (string, required): kb-relative folder to walk (e.g. "Alpha/Beta").
   * Returns: { total, published, pending, notes: [{ kbPath, published }] }. Pure read — no Notion call,
   * no file change.
   *
   * @param subtree KB-relative folder path to mirror, e.g. "Alpha/Beta". Any folder under
   *                MCP_KB_NOTION_MIRROR_KB_ROOT. ".." segments are rejected and the path is confined
   *                under the KB root.
   */
  kb_notion_mirror_tree_status(subtree: string): Promise<object>

  /**
   * Check a KB subtree for structural issues that would force notes to be skipped — currently, folders
   * that contain notes but lack a folder-index note (<Folder>/<Folder>.md).
   * Args:
   * - subtree (string, required): kb-relative folder to walk.
   * Returns: { issues: string[] } — empty when the subtree is mirror-ready. Pure read.
   *
   * @param subtree KB-relative folder path to mirror, e.g. "Alpha/Beta". Any folder under
   *                MCP_KB_NOTION_MIRROR_KB_ROOT. ".." segments are rejected and the path is confined
   *                under the KB root.
   */
  kb_notion_mirror_tree_preflight(subtree: string): Promise<object>

  /**
   * Create body-less scaffold pages for a whole KB subtree (or one note within it), attaching the
   * subtree-root index under the parent you supply and nesting the rest by the folder-index convention.
   * Idempotent — already-mirrored notes are skipped. Run this first, then tree_update to push bodies and
   * resolve wikilinks.
   * Args:
   * - subtree (string, required): kb-relative folder to walk (e.g. "Alpha/Beta").
   * - parent (object, required): the Notion parent the subtree-root index attaches under.
   * - kb_path (string, optional): touch just this note (walking up its unmirrored ancestor indexes
   * first).
   * Returns: { eligible, outcomes: NoteOutcome[] } where NoteOutcome = { kbPath, action:
   * "touch"|"skip"|"error", url?, error? }.
   *
   * @param subtree KB-relative folder path to mirror, e.g. "Alpha/Beta". Any folder under
   *                MCP_KB_NOTION_MIRROR_KB_ROOT. ".." segments are rejected and the path is confined
   *                under the KB root.
   * @param parent Notion parent object, passed to Notion verbatim: { type: "database_id", database_id }
   *               or { type: "page_id", page_id }. The caller decides which.
   * @param kb_path? Optional single note (kb-relative) to act on, walking up its ancestor indexes. Omit
   *                 to act on the whole subtree.
   */
  kb_notion_mirror_tree_touch(subtree: string, parent: unknown, kb_path?: string): Promise<object>

  /**
   * Push the body of every touched note in a subtree (or one note within it), resolving [[wikilinks]]
   * into @mentions. Notes not yet touched are reported skipped, not created. By default the link map
   * spans EVERY declared mirror root, so cross-subtree [[wikilinks]] resolve into @mentions even on a
   * partial republish (this subtree is overlaid so a bare [[Name]] that collides across roots stays
   * local); pass link_map to override.
   * Args:
   * - subtree (string, required): kb-relative folder to walk.
   * - parent (object, required): the parent the subtree-root index sits under (same as the touch).
   * - kb_path (string, optional): update just this note's ancestor chain.
   * - link_map (object, optional): wikilink → mirror URL map that overrides the default KB-wide map.
   * Returns: { eligible, outcomes: NoteOutcome[] } where NoteOutcome = { kbPath, action:
   * "update"|"skip"|"error", url?, error? }.
   *
   * @param subtree KB-relative folder path to mirror, e.g. "Alpha/Beta". Any folder under
   *                MCP_KB_NOTION_MIRROR_KB_ROOT. ".." segments are rejected and the path is confined
   *                under the KB root.
   * @param parent Notion parent object, passed to Notion verbatim: { type: "database_id", database_id }
   *               or { type: "page_id", page_id }. The caller decides which.
   * @param kb_path? Optional single note (kb-relative) to act on, walking up its ancestor indexes. Omit
   *                 to act on the whole subtree.
   * @param link_map? Wikilink resolution map ([[target]] → mirror URL) that OVERRIDES the default. Omit
   *                  → the default spans every declared mirror root (so cross-subtree [[wikilinks]]
   *                  resolve into @mentions even on a partial republish), with this subtree overlaid so
   *                  a bare [[Name]] that collides across roots still resolves locally.
   */
  kb_notion_mirror_tree_update(subtree: string, parent: unknown, kb_path?: string, link_map?: Record<string, unknown>): Promise<object>

  /**
   * Archive the mirror page of every note in a subtree (or one note's chain) and clear their mirror
   * frontmatter, children before parents. Destructive — defaults to a dry run. Archiving breaks any
   * @mention pointing at these pages.
   * Args:
   * - subtree (string, required): kb-relative folder to walk.
   * - kb_path (string, optional): delete just this note's ancestor chain.
   * - dry_run (boolean, default true): when true, report what would be archived without calling Notion
   * or editing notes.
   * Returns: { eligible, outcomes: NoteOutcome[] } where NoteOutcome = { kbPath, action:
   * "delete"|"plan"|"skip"|"error", url?, error? }.
   *
   * @param subtree KB-relative folder path to mirror, e.g. "Alpha/Beta". Any folder under
   *                MCP_KB_NOTION_MIRROR_KB_ROOT. ".." segments are rejected and the path is confined
   *                under the KB root.
   * @param kb_path? Optional single note (kb-relative) to act on, walking up its ancestor indexes. Omit
   *                 to act on the whole subtree.
   * @param dry_run? When true (default) report what would be archived without calling Notion or editing
   *                 notes.
   */
  kb_notion_mirror_tree_delete(subtree: string, kb_path?: string, dry_run?: boolean): Promise<object>

  /**
   * Archive Notion pages whose backing KB note has been DELETED under a subtree. Git-driven: an orphan
   * is a note deleted in git history (or in the working tree relative to HEAD) whose
   * kb_notion_mirror_url is no longer present in any live note on disk — a note that merely MOVED keeps
   * its url and is never pruned. Destructive — defaults to a dry run. Requires the KB root to be a git
   * repository.
   * Args:
   * - subtree (string, required): kb-relative folder to scan for deleted notes.
   * - dry_run (boolean, default true): when true, report which orphaned pages would be archived without
   * calling Notion.
   * Returns: { eligible, outcomes: NoteOutcome[] } where NoteOutcome = { kbPath (the deleted note's
   * path), action: "plan"|"delete"|"error", url?, error? }.
   *
   * @param subtree KB-relative folder path to mirror, e.g. "Alpha/Beta". Any folder under
   *                MCP_KB_NOTION_MIRROR_KB_ROOT. ".." segments are rejected and the path is confined
   *                under the KB root.
   * @param dry_run? When true (default) report which orphaned pages would be archived without calling
   *                 Notion.
   */
  kb_notion_mirror_tree_prune(subtree: string, dry_run?: boolean): Promise<object>

  /**
   * Discover every folder that declares itself a mirror root via kb_notion_mirror_root frontmatter, and
   * the Notion parent each attaches under. Pure read — no Notion call, no file change.
   * This is discovery only: take the returned [{ subtree, parent }] and drive the tree tools (tree_touch
   * / tree_update / tree_delete) per root with the parent given here — so you never rescan the KB and
   * every mutation still takes an explicit parent.
   * Args: none.
   * Returns: [{ subtree, indexKbPath, parent }] sorted by subtree. A database parent is { type:
   * "database_id", database_id }; a page parent is { type: "page_id", page_id }.
   */
  kb_notion_mirror_roots_list(): Promise<CallResult>
}
