# CLAUDE.md

Guidance for Claude Code when working in this repo. The user-facing tool surface, install/config, and Claude Desktop setup live in [README.md](./README.md); this file covers what Claude needs that isn't in README and isn't derivable from one grep.

## What this MCP does

Publishes local KB markdown notes to a Notion wiki (the "mirror") and writes the resulting page URL back into each note's frontmatter. The KB is canonical; the mirror is a disposable read surface. This is the TypeScript successor to a throwaway Python script (`publish_one.py` / `md_to_notion.py`) — the markdown→blocks step is delegated to `@tryfabric/martian` rather than the hand-rolled converter.

## Bun vs Node

This project uses Bun (≥ 1.3) for install and dev scripts, but the compiled `dist/` runs under Node (≥ 22) — that's what Claude Desktop launches.

- `bun run test` (NOT `bun test` — the latter invokes Bun's own runner instead of vitest).
- Bun auto-loads `.env.${NODE_ENV}` from the CWD; Node needs the explicit `process.loadEnvFile()` call in [src/config.ts](./src/config.ts). The try/catch swallows the `TypeError` Bun raises (no `process.loadEnvFile`), so the same code works under both.
- `NODE_ENV` is set to `development` only by `server:mcp:dev` and `server:mcp:inspect`. Claude Desktop doesn't set it, so `.env.*` is ignored in production — `MCP_NOTION_MIRROR_TOKEN` and `MCP_NOTION_MIRROR_WIKI_DATABASE_ID` must come from the Claude Desktop config `env` block.

Run `bun run` with no args for the full script list.

## Architecture Invariants

### Naming convention

Tool names follow `<app>_<resource>_<action>` (snake_case) with `<app>` = `notion_mirror`. Plural resource for collection ops, singular for single-item ops. Current surface:

- **notes** (single module, [src/tools/notes/index.ts](./src/tools/notes/index.ts)): `notion_mirror_note_status` (read), `notion_mirror_unpublished_list` (read, collection), `notion_mirror_note_publish` (write — non-idempotent: each force run creates a new page), `notion_mirror_note_move` (write — re-parents a published page), `notion_mirror_note_archive` (destructive).

Deliberately **no** bulk-publish tool — bulk runs orchestrate `notion_mirror_unpublished_list` + repeated `notion_mirror_note_publish` from the calling agent, which owns sleep / rate limiting. Keeps the MCP atomic.

### Access-level gate — driven by annotations, not names

[src/utils/access-level.ts](./src/utils/access-level.ts) `makeAccessGatedRegister()` decides at startup whether to register each tool, based on `config.annotations`:

- `readOnlyHint: true` → `read`
- `destructiveHint: true` → `destructive`
- explicit `readOnlyHint: false` AND `destructiveHint: false` → `write` (non-destructive mutation)
- anything else (unannotated / partially annotated) → `destructive` (fail-safe)

A tool registers when its derived level is at or below `MCP_NOTION_MIRROR_ACCESS_LEVEL` (default: `read`, fail-safe). The default gate exposes only the read tools; `write` adds publish + move, `destructive` adds archive. In practice the MCP is deployed with `write`. The presets live in [src/utils/annotations.ts](./src/utils/annotations.ts) (`READ_ONLY`, `WRITE_REMOTE`, `DESTRUCTIVE_REMOTE`). New tools MUST set `annotations` explicitly to one of those presets — do not bypass the proxy.

### Single HTTP client

All Notion API calls go through [src/notion-client.ts](./src/notion-client.ts). New tools must reuse `createMirrorPage()` / `archivePage()` / `getDatabaseTitleProperty()` rather than building their own `fetch` — the client centralises the Bearer header, the `Notion-Version` header (one constant, `NOTION_API_VERSION` in [src/config.ts](./src/config.ts)), JSON content-type, and the API-error → `NotionApiError` translation. The 100-block-per-request cap is handled there too (`createMirrorPage` appends overflow children via `PATCH /v1/blocks/{id}/children`).

### Title property is discovered, not hard-coded

The wiki's title property is named `"Page"` today, but that varies per wiki. `getDatabaseTitleProperty()` reads `GET /v1/databases/{id}` and caches the title-typed property name. Don't hard-code `"Page"`.

### Hierarchical publishing (parent resolution)

The mirror replicates the KB folder tree (ENHANCEMENT-SPEC-01). The KB→parent rule is split in two so the rule itself stays trivially testable:

- [src/parent-resolver.ts](./src/parent-resolver.ts) — **pure** path→path (`deriveParent`, `ancestorIndexChain`). No `fs`. Keep it that way.
- [src/parent-lookup.ts](./src/parent-lookup.ts) — `resolveParentTarget` reads the parent index note's frontmatter and returns a discriminated `ParentTarget` (`database-root` | `page` | `missing-index` | `parent-unpublished` | `malformed-parent-url`). The publish/move/status tools map that to a Notion parent, an `errorResult`, or a status field.

**Notion properties shape depends on the parent kind** (a real API constraint, handled in `createMirrorPage`): under a `database_id` parent the title goes in the database's title-typed property (name from `getDatabaseTitleProperty`); under a `page_id` parent Notion only accepts the reserved `title` property. `notion_mirror_note_move` re-parents via `PATCH /v1/pages/{id}` with `{ parent }` and does NOT touch frontmatter (the URL is stable across moves). `notion_mirror_unpublished_list` returns the publishable closure (source notes + required unmirrored index ancestors) in tree order so a naive in-order publish always does parents first.

### Frontmatter is edited by line surgery, NOT a YAML round-trip

[src/frontmatter.ts](./src/frontmatter.ts) regex-matches the leading `---\n…\n---\n` block and edits per-line. This is deliberate: `js-yaml` / `yaml` reorder keys and rewrite escaping, which would corrupt the KB's strict field-order and value-formatting rules. `upsertFrontmatterFields` replaces existing fields in place and inserts new ones after `notion_path` (falling back to `notion_source_url_secondary` / `notion_source_url`). The round-trip exact-string tests in [src/frontmatter.test.ts](./src/frontmatter.test.ts) guard against accidental reformatting — keep them green.

## Security Requirements

This server holds a Notion token, walks a user-supplied filesystem tree, and writes back to KB notes. New tools and changes MUST preserve every invariant below.

1. **The token never leaves the process unredacted.** It's read in [src/config.ts](./src/config.ts) and attached as the Bearer header in [src/notion-client.ts](./src/notion-client.ts) only. `NotionApiError` carries the response status/code/body — never the token. The audit log records tool args only (which never contain the token). Tests assert the token string never appears in error messages.
2. **Every `kb_path` / `root` runs through [src/utils/paths.ts](./src/utils/paths.ts) before any `fs.*` call.** Two-layer guard: lexical (`..` rejected, confinement under `<KB_ROOT>/Pillars/`) plus realpath of the deepest existing ancestor (catches symlink escapes). Schemas in [src/tools/notes/index.ts](./src/tools/notes/index.ts) _also_ reject `..` at the zod layer — belt and braces. When `KB_ROOT` is unset, relative paths are rejected and absolute paths are accepted after the `..` check.
3. **Page UUIDs from frontmatter are regex-validated (`^[a-f0-9]{32}$`) before substitution into an API path.** `assertPageId()` in [src/notion-client.ts](./src/notion-client.ts) — `extractPageIdFromUrl()` pulls the id out of a `notion.so` URL, `assertPageId()` validates it.
4. **Destructive tools default to `dry_run: true`.** `notion_mirror_note_archive` only calls Notion / edits the note when `dry_run` is explicitly `false`. The `destructive` access level is opt-in.
5. **Frontmatter write-backs are atomic.** `atomicWriteFile()` in [src/utils/atomic-write.ts](./src/utils/atomic-write.ts) writes a temp file then renames — a crash mid-write can't corrupt a KB note.
6. **Zod schemas are `.strict()` with bounded sizes.** `kb_path` / `root` cap at 4096 chars. Add bounds for every new field.
7. **The directory walk is depth-limited.** `findUnpublishedNotes()` in [src/kb-scan.ts](./src/kb-scan.ts) enforces a depth cap and prunes hidden dirs + `node_modules`. A note that can't be read is skipped, not fatal. New walkers must enforce a depth cap.
8. **Errors return via `errorResult(...)`, not `throw`.** The audit-log wrapper depends on the MCP `isError` envelope to log failures.

## Testing

- `bun run test:coverage` enforces 100% line/branch/function/statement coverage. The aggregator files (`src/mcp-server/index.ts`, `src/tools/**/index.ts`) and the pure-data `src/utils/annotations.ts` are excluded — everything else must stay fully covered.
- Real Notion API calls are out of tests — the client is exercised through `fetch` mocks (`vi.stubGlobal('fetch', …)`).
- Modules that read config at import time (anything importing `KB_ROOT`, `BANNER_TEXT`, etc.) are tested via `vi.resetModules()` + env mutation + dynamic `import()`.

## Tool registration call sites

Tools are registered in [src/tools/notes/index.ts](./src/tools/notes/index.ts). To survey the surface, `grep "registerTool" src/tools/*/index.ts`. README's [Tools](./README.md#tools) section tabulates them with purposes and I/O shapes.
