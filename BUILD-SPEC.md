# mcp-notion-mirror — Build Specification

**Audience:** the MCP-scaffolding project that takes this spec and produces the working repo.
**Sibling reference:** model the conventions on `kis/knowledgeislands/mcp-voicenotes-edit` (same author, same patterns). Read its `CLAUDE.md`, `package.json`, `src/` layout, and `src/utils/access-level.ts` before writing code.

---

## Purpose

This MCP publishes markdown notes from a local Knowledge Base (KB) to a Notion wiki — the **mirror** — and records the resulting Notion page URLs back into the KB notes' YAML frontmatter. The KB is canonical; the mirror is a derivative read surface for non-KB consumers. Re-publishing overwrites the mirror page (or archives the old and creates a new one — see §Re-publish).

Today there is one mirror target: the "Product & Eng" wiki database in Notion. The MCP must be parameterised so additional mirrors can be configured without code changes.

---

## What's already in place (reference, not requirements)

A working reference implementation exists in Python at the user's `/tmp/publish_one.py` and `/tmp/md_to_notion.py` (the latter is a hand-written md→blocks converter). Three pages were published successfully via this script during a Claude session on 2026-05-30:

- `Multi-Instance and Multi-Tenant` → https://www.notion.so/Multi-Instance-and-Multi-Tenant-3709f7187cc2814e8652f99fd36857ff
- `Platform Conventions` → https://www.notion.so/Platform-Conventions-3709f7187cc281edbaa4fa4ac239e809
- `Platform Architecture` → https://www.notion.so/Platform-Architecture-3709f7187cc2816686f5e2d12b30e795

Their KB notes carry the live frontmatter shape this MCP must produce (see §Frontmatter contract).

---

## Tool surface

All tool names follow the sibling convention `<app>_<resource>_<action>` (snake_case). For this MCP, `<app>` = `notion_mirror`.

| Tool                             | Annotations                                   | Args                                                  | Returns                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notion_mirror_note_status`      | `readOnlyHint: true`                          | `kb_path: string`                                     | Mirror state for one KB note: source URL, mirror URL (if any), `notion_mirror_published_at`, and whether it would be published / skipped / republished on next run                                                                                                               |
| `notion_mirror_unpublished_list` | `readOnlyHint: true`                          | `root: string` (KB root path, default discovered)     | Array of KB note paths under `root/Pillars/` that have `notion_source_url` but no `notion_mirror_url`                                                                                                                                                                            |
| `notion_mirror_note_publish`     | `readOnlyHint: false, destructiveHint: false` | `kb_path: string`, `force?: boolean` (default false)  | On success: `{ url, page_id, published_at }`. On skip (already published, no `force`): `{ skipped: true, existing_url }`. Updates the KB note's frontmatter with `notion_mirror_url` + `notion_mirror_published_at`. With `force: true`, archives the existing mirror page first |
| `notion_mirror_note_archive`     | `readOnlyHint: false, destructiveHint: true`  | `kb_path: string`, `dry_run?: boolean` (default true) | Archives the Notion page referenced by `notion_mirror_url` and clears those two frontmatter fields. With `dry_run: true` (default), reports what _would_ happen                                                                                                                  |

Do **not** ship a bulk-publish tool. Bulk runs orchestrate `notion_mirror_unpublished_list` + repeated `notion_mirror_note_publish` from the calling agent, with the agent handling sleep / rate limiting. Keeps the MCP atomic.

---

## Configuration

Environment variables, prefixed `MCP_NOTION_MIRROR_`:

| Var                                  | Required              | Notes                                                                                                                                                                                              |
| ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_NOTION_MIRROR_TOKEN`            | Yes                   | Notion internal-integration secret (`ntn_...`). The integration must have **Read / Insert content / Update content** capabilities AND be explicitly Connected to the target wiki page in Notion UI |
| `MCP_NOTION_MIRROR_WIKI_DATABASE_ID` | Yes                   | The Notion wiki database ID to publish _into_ (parent of new mirror pages). For HNR's current target: `36f9f7187cc280f69272e60aa89bff24`                                                           |
| `MCP_NOTION_MIRROR_KB_ROOT`          | No (default: derived) | Absolute path to the KB root containing `Pillars/`. If unset, the MCP must error clearly when given relative paths                                                                                 |
| `MCP_NOTION_MIRROR_ACCESS_LEVEL`     | No (default: `write`) | Same gating model as sibling: `read` / `write` / `destructive`. Mirrors the sibling's `makeAccessGatedRegister()`                                                                                  |
| `MCP_NOTION_MIRROR_BANNER_TEXT`      | No                    | Override the default mirrored-banner copy if a KB wants different wording                                                                                                                          |

Notion does **not** version the API via the URL; pass `Notion-Version: 2022-06-28` header on every call. Bump the constant in one place when Notion releases a new stable date.

---

## Frontmatter contract

Every KB note that is publishable has YAML frontmatter shaped like this (only the relevant fields shown):

```yaml
---
status: current — May 2026 # human-readable
purpose: <one-line>
notion_source_url: https://www.notion.so/<32hex> # where the note was drained from (provenance)
notion_source_url_secondary: https://... # optional — for multi-source consolidations
notion_path: Product & Eng (Old) / Platform Architecture / … # human-readable Notion breadcrumb of the source
notion_mirror_url: https://www.notion.so/<slug>-<32hex> # populated by THIS MCP on publish
notion_mirror_published_at: 2026-05-30T01:13:00Z # ISO-8601 UTC, populated by THIS MCP
notion_last_seen_at: 2026-04-08T00:00:00Z # other audit fields, untouched
captured_at: 2026-05-29T00:00:00Z
notion_action: keep
---
```

**Strict rule across the KB:** every date/time frontmatter field ends with the suffix `_at`, is ISO-8601, and is UTC (trailing `Z`). The MCP MUST produce timestamps in that exact shape (`YYYY-MM-DDT00:00:00Z` for day-precision, `YYYY-MM-DDTHH:MM:SSZ` otherwise). Take the value from the Notion API response's `created_time` (and trim trailing `.000` if Notion returns sub-second precision) — that's authoritative.

**Frontmatter write-back rules:**

- Preserve field order. New fields inserted by the MCP go _after_ `notion_path` (or after `notion_source_url_secondary` if present) and _before_ the audit `_at` fields, mirroring the order used in the existing notes.
- Never reorder unrelated fields. Never reformat values (e.g. don't quote strings that weren't quoted).
- If the note has no frontmatter at all, error — the MCP should not invent frontmatter.

The simplest implementation: regex-match the leading `---\n…\n---\n` block, do per-line field manipulation, splice it back. Don't round-trip through a YAML library — `js-yaml`, `yaml`, etc. all lose ordering and rewrite escaping. The Python reference implementation in `/tmp/publish_one.py` (`upsert_frontmatter_fields`) shows the algorithm.

---

## Publish pipeline

For `notion_mirror_note_publish(kb_path, force)`:

1. Read the file at `kb_path`. Reject if outside `MCP_NOTION_MIRROR_KB_ROOT/Pillars/` (path traversal guard).
2. Parse frontmatter. If `notion_mirror_url` is already set and `force === false`, return `{ skipped: true, existing_url }`.
3. If `force === true` AND `notion_mirror_url` exists: extract the 32-hex page UUID from the URL, `PATCH /v1/pages/{uuid}` with `{ archived: true }`. Continue regardless of whether the archive succeeds (the old page may already be archived/deleted).
4. Compute the page title from the basename of `kb_path` minus `.md`.
5. Strip the YAML frontmatter and any leading `# Title` H1 from the markdown body (Notion gets the title from the page property, not the body).
6. Convert the markdown body to Notion block JSON using **`@tryfabric/martian`** (`markdownToBlocks(string): BlockObjectRequest[]`). This handles paragraphs, headings, lists (including nested), code fences, blockquotes, dividers, tables, inline formatting, and links. Wikilinks (`[[X]]`) pass through as literal text — that's an open issue we'll address later.
7. Prepend a "Mirrored from KB" callout block. Default text:

   ```text
   📘 **Mirrored from Knowledge Base on YYYY-MM-DD** — canonical version lives in HNR's KB; feedback via comments here will be triaged back into the KB.
   ```

   The date is the _runtime_ date in UTC (use `new Date().toISOString().slice(0,10)`). Block shape:

   ```json
   {
     "object": "block",
     "type": "callout",
     "callout": {
       "icon": { "type": "emoji", "emoji": "📘" },
       "rich_text": [
         {
           "type": "text",
           "text": { "content": "Mirrored from Knowledge Base on 2026-05-30" },
           "annotations": { "bold": true }
         },
         {
           "type": "text",
           "text": {
             "content": " — canonical version lives in HNR's KB; feedback via comments here will be triaged back into the KB."
           }
         }
       ]
     }
   }
   ```

8. POST to `https://api.notion.com/v1/pages`:

   ```json
   {
     "parent": { "type": "database_id", "database_id": "<MCP_NOTION_MIRROR_WIKI_DATABASE_ID>" },
     "properties": {
       "Page": { "title": [{ "text": { "content": "<title>" } }] }
     },
     "children": [<banner>, ...<body blocks>]
   }
   ```

   The title property is literally named `"Page"` for the HNR wiki — that may vary per wiki, so derive the title-property name by fetching the data source schema on first run and caching it. (Notion API: `GET /v1/databases/{id}` returns `properties.{name}.id` and `properties.{name}.type == "title"`.)

9. Capture `result.url` and `result.created_time` from the response.
10. Upsert `notion_mirror_url` and `notion_mirror_published_at` into the KB note's frontmatter (see §Frontmatter contract). Write file atomically (write to temp + rename) to avoid partial writes if the process is interrupted mid-write.
11. Return `{ url, page_id, published_at }`.

### Re-publish semantics

On `force === true`: archive the old mirror page (PATCH `{ archived: true }`), then create a new one. The URL changes. This is the simplest semantics and matches the canonical-wins rule (mirror is disposable). If users start needing stable URLs across re-publishes, the next iteration of the MCP can switch to "edit in place" via `PATCH /v1/blocks/{page_id}/children` + clearing the old children — but that's harder and not needed yet.

---

## What's deferred to a future iteration

These are _known_ gaps. List them in `ROADMAP.md` so future contributors don't re-discover.

1. **Images.** Many KB notes reference local PNGs (`<Note Name> - images/foo.png`). These need to be uploaded via Notion's `POST /v1/file_uploads` endpoint, then referenced as `image` blocks with `type: file_upload`. **First MCP iteration skips images**: martian will render the markdown image as a paragraph containing the alt text + path, which is visually obvious as "this needs fixing". Don't try to inline data URIs — Notion rejects them.
2. **Wikilinks.** Markdown `[[X]]` doesn't resolve to anything in Notion. For now, leave as literal text. A later pass can resolve targets that have `notion_mirror_url` and rewrite them as `mention` blocks.
3. **Tables.** Martian handles GFM tables out of the box. Verify with a test KB note containing a table before declaring this "done".
4. **Stable URLs across re-publish.** As above.
5. **Bulk runner.** Done by the calling agent, not the MCP.

---

## Sibling conventions to mirror

Crib these from `mcp-voicenotes-edit` — do not invent alternatives:

- **Tool registration**: `src/tools/<resource>/index.ts` exports a `registerTools(server, register)` function. The `register` is the access-gated wrapper from `src/utils/access-level.ts`.
- **HTTP client**: a single module `src/notion-client.ts` (or similar) owns the Bearer header, the `Notion-Version` header, the JSON content type, and the API-error → typed-error translation. Every tool calls into this module — none of them build raw `fetch` calls inline.
- **Schemas**: zod `.strict()`, bounded string lengths, regex-validated identifiers. The KB path argument needs a guard against `..` traversal even though the runtime guard exists.
- **Audit log**: copy the pattern from `src/utils/audit-log.ts`. The Notion token MUST never appear in logs.
- **Error returns**: `errorResult(...)` (not `throw`) so the audit log wrapper sees an `isError` envelope.
- **Build & runtime**: Bun (≥ 1.3) for dev/install, compiled `dist/` runs under Node (≥ 22).
- **Files at repo root**: `README.md`, `CLAUDE.md`, `ROADMAP.md`, `SECURITY.md`, `LICENSE` (same license as siblings), `biome.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `claude-config-sample.json`, `package.json`, `bun.lock`. Pull `biome.json` and the lint/format scripts verbatim from `mcp-voicenotes-edit` for consistency across the family.
- **Testing**: vitest. Real Notion API calls in tests are out — mock the `notion-client` module. Frontmatter parsing/writing has unit-test fixtures; round-trip exact-string comparison to catch unintended reformatting.

---

## SECURITY.md content

Cover at minimum:

1. **The token never leaves the process unredacted.** Don't include in error messages, audit-log payloads, tool outputs.
2. **`kb_path` input is path-traversal-guarded.** Must be under `MCP_NOTION_MIRROR_KB_ROOT/Pillars/`. The `..` segment is rejected before any file read.
3. **Page UUIDs from frontmatter are regex-validated (`^[a-f0-9]{32}$`) before being substituted into URLs.**
4. **Destructive tools require `dry_run: true` by default.** `notion_mirror_note_archive` does NOT delete by default.
5. **Atomic frontmatter writes.** Temp file + rename. Don't corrupt KB notes on crash.
6. **Zod schemas are `.strict()` with bounded sizes.** Title length cap matches Notion's limit (2000 chars).

---

## README outline

Match the sibling's README structure exactly:

1. One-paragraph what + why
2. Install (`bun install` for dev; `npm install -g @knowledgeislands/mcp-notion-mirror` for end-user)
3. Configuration (env vars table, link to claude-config-sample.json)
4. Tools (table with purpose + I/O shape, mirroring the sibling)
5. Access levels (read / write / destructive)
6. Running locally (`bun run server:mcp:dev`, `bun run server:mcp:inspect`)
7. Notion-side setup checklist (create internal integration → grant Insert + Update content → share the wiki page with the integration via Connections menu)

---

## Acceptance criteria

The MCP is done when **all** of these are true:

1. `bun run test` passes (unit + integration with mocked HTTP).
2. `bun run server:mcp:dev` starts cleanly with valid env vars.
3. Running `notion_mirror_note_publish` against the file `Pillars/Engineering/Bioweave/Multi-Instance and Multi-Tenant.md` (force=true) overwrites the existing mirror page and updates the frontmatter to the new URL — verified by re-fetching the file from disk.
4. Running `notion_mirror_note_publish` without `force` on the same file returns `{ skipped: true }` and leaves frontmatter untouched.
5. `notion_mirror_unpublished_list` returns exactly the set of KB notes that have `notion_source_url` but no `notion_mirror_url` — verified by counting `grep -L notion_mirror_url ...` in `Pillars/`.
6. `notion_mirror_note_archive` with `dry_run: true` (default) reports the page it _would_ archive without making any API calls.
7. Token never appears in any test output, audit log file, or error message.
8. `biome` lint + format clean.
9. README documents every tool with the same level of detail as `mcp-voicenotes-edit/README.md`.

---

## Reference reading order (for the implementer)

1. `kis/knowledgeislands/mcp-voicenotes-edit/CLAUDE.md` — pattern & invariants
2. `kis/knowledgeislands/mcp-voicenotes-edit/src/utils/access-level.ts` — access-level gating
3. `kis/knowledgeislands/mcp-voicenotes-edit/src/voicenotes-client.ts` — HTTP client pattern
4. `kis/knowledgeislands/mcp-voicenotes-edit/src/tools/notes/` — tool registration shape
5. `/tmp/publish_one.py` (in the user's session) — reference logic, frontmatter manipulation, banner block JSON
6. `/tmp/md_to_notion.py` — only for comparison; the TS impl should use `@tryfabric/martian` instead
7. Notion API docs: `https://developers.notion.com/reference/post-page`, `https://developers.notion.com/reference/archive-a-page`
