# Changelog

## Unreleased

`feat: publish accepts icon/full_width/link_map; parent child-pages footer maintained automatically by publish/unpublish/move.`

- `notion_mirror_publish` gains three optional args:
  - `icon` — `{ type: "emoji", emoji }` or `{ type: "external", external: { url } }`, set in the page-create call.
  - `full_width` (default `true`) — sets `format.page_full_width` on create; if Notion rejects the hint, the create is retried once without it (default width) and a warning is logged.
  - `link_map` — wikilink target → mirror URL. Resolved `[[…]]` become Notion page mentions; unresolved ones render as italic text. The caller builds the map (the MCP never walks the KB).
- **Child-pages footer (mirror-only).** Page-parented mirror pages get a single `Child Pages` `heading_2` placed immediately above Notion's native `child_page` links (no duplicate mention bullets, no folder emoji). Refreshed automatically after `publish` (page parent), real `unpublish` (page parent), and `move` (both old and new page parents); a refresh also cleans up legacy `📂 Child Pages` heading + bullets. Identified by a sentinel `heading_2` (`Child Pages`) — a future mirror→KB reader must strip it. Refreshes are serialised per parent and never fail the primary operation.
- New modules: `src/wikilinks.ts` (pure rewrite + mention conversion), `src/footer.ts` (`buildFooterBlocks` + locked `refreshFooter`). New `notion-client` block helpers: `getBlockChildren` (paginated), `appendBlockChildren` (with optional `after` anchor), `deleteBlock`.

## 1.0.0

`feat!: rewrite as file-aware Notion publisher (publish/unpublish/move/get by kb_path); orchestration moves to the caller.`

The MCP owns markdown→blocks, the banner, and the `notion_mirror_*` frontmatter write-back. The caller owns file discovery, parent resolution, folder/exclusion conventions, and publish order.

**BREAKING:**

- Tool surface replaced. New: `notion_mirror_publish(kb_path, parent, force?)`, `notion_mirror_move(kb_path, parent)`, `notion_mirror_unpublish(kb_path, dry_run?)`, `notion_mirror_get(kb_path)`. Removed: `notion_mirror_note_status`, `notion_mirror_unpublished_list`, `notion_mirror_note_publish`, `notion_mirror_note_move`, `notion_mirror_note_archive`.
- Mutating tools now take a Notion `parent` (`{ type: "database_id", database_id }` or `{ type: "page_id", page_id }`), passed to Notion verbatim. The MCP no longer derives parents or knows any folder convention.
- `MCP_NOTION_MIRROR_WIKI_DATABASE_ID` removed (the caller passes the parent per call).
- `MCP_NOTION_MIRROR_BANNER_TEXT` replaced by `MCP_NOTION_MIRROR_BANNER_TEMPLATE` — a full template with a `{date}` placeholder; empty string disables the banner.
- `MCP_NOTION_MIRROR_KB_ROOT` confinement is now the root itself (no `Pillars/` sub-confinement); the server is layout-agnostic.
- Default `MCP_NOTION_MIRROR_ACCESS_LEVEL` is now `write` (was `read`) — this MCP exists to mutate the mirror.

**Notes:**

- `notion_mirror_move` detects and clearly errors on the Notion limitation that `PATCH /v1/pages` silently ignores a parent change crossing the page-id ↔ database-id boundary (tested 2026-05-30 against API version `2022-06-28`).
- `notion_mirror_unpublish` cascade-archives descendants on the Notion side but clears only the one note's frontmatter.
