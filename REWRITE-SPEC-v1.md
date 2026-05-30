# MCP Rewrite Spec — v1.0.0 (thin plumbing)

**Status:** ready to hand to the MCP-building project.
**Supersedes:** all prior specs (`BUILD-SPEC.md`, `ENHANCEMENT-SPEC-01..03`). v0.1.x–v0.3.x are conceptually obsolete; this is a clean break.
**Target version:** v1.0.0 — major bump, because the tool surface changes entirely.

---

## Why a rewrite

v0.x evolved into a single MCP that knew both **how to talk to Notion** (REST plumbing) and **what to publish from a KB** (folder conventions, parent resolution, sort order, exclusion rules, banner content, frontmatter write-back). That second category is KB-policy — it shouldn't live in the MCP. A KB change should be a frontmatter change or a script change, never an MCP version bump.

After this rewrite:

- The **MCP** exposes generic Notion page operations. It knows nothing about the KB. The same MCP serves any KB or any "publish-to-Notion" use case.
- The **caller** (a Claude skill, a script, an agent, a CI job) owns all KB-specific orchestration — walking files, reading frontmatter, deciding parents, generating banners, writing back URLs.

This separates "talk to Notion" from "what to publish".

---

## Tool surface (4 tools)

All tools follow the sibling MCP naming convention `<app>_<resource>_<action>`. For this MCP, `<app>` = `notion_mirror` (repo name retained; the "mirror" word now means the act, not a hard-coded concept).

| Tool                          | Annotations                                   | Args                                                                                 | Returns                                                                  |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `notion_mirror_page_create`   | `readOnlyHint: false, destructiveHint: false` | `parent`, `title`, `body_markdown`, `prepend_blocks?`                                | `{ url, page_id, created_time }`                                         |
| `notion_mirror_page_archive`  | `readOnlyHint: false, destructiveHint: true`  | `page_id`, `dry_run?` (default true)                                                 | `{ archived: true, page_id }` or `{ dry_run: true, would_archive: ... }` |
| `notion_mirror_page_move`     | `readOnlyHint: false, destructiveHint: false` | `page_id`, `parent`                                                                  | `{ moved: true, page_id, previous_parent, new_parent }`                  |
| `notion_mirror_page_get`      | `readOnlyHint: true`                          | `page_id`                                                                            | `{ id, parent, title, created_time, last_edited_time, archived, url }`   |

All `parent` arguments accept Notion's native shape: `{ type: "page_id", page_id: "<32hex>" }` or `{ type: "database_id", database_id: "<32hex>" }`. The MCP doesn't interpret it — it passes through to Notion. (The page-id ↔ database-id move limitation is Notion's, not ours; see caveat at the bottom.)

The MCP **does not** ship:

- `notion_mirror_note_publish` — there's no concept of "note" any more, just "page". The caller reads the file, decides the parent, and calls `page_create`.
- `notion_mirror_unpublished_list` — file walking + frontmatter discovery is KB-specific. Caller's job.
- `notion_mirror_note_status` — derived state, not Notion state. Caller's job.
- `notion_mirror_note_move` (by KB path) — only the Notion-id form. If you need KB-path-to-page-id resolution, do it in the caller.

---

## Markdown conversion

`page_create` takes `body_markdown` (string) and converts it to Notion block JSON using `@tryfabric/martian`. The MCP appends those blocks **after** any `prepend_blocks` the caller supplied. The caller controls what goes at the top (banners, callouts, provenance lines) by passing `prepend_blocks` as native Notion block objects.

Schema for `prepend_blocks`: an array of Notion `BlockObjectRequest` shapes. The MCP doesn't validate beyond Notion's own validation — it just splices them in front of the converted markdown body.

If `body_markdown` is empty or whitespace-only, the page is created with just `prepend_blocks` (and no body content). If both are empty, error: `"Refusing to create an empty page."`.

---

## Configuration

Environment variables, prefixed `MCP_NOTION_MIRROR_`:

| Var                              | Required              | Notes                                                                                                                                                                                                                       |
| -------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_NOTION_MIRROR_TOKEN`        | Yes                   | Notion internal-integration secret. Capabilities required: **Read / Insert content / Update content**. Must be explicitly Connected to every Notion page/database the caller intends to publish into.                       |
| `MCP_NOTION_MIRROR_ACCESS_LEVEL` | No (default: `write`) | Same gating model as sibling: `read` / `write` / `destructive`.                                                                                                                                                              |

Note what's **gone**: `MCP_NOTION_MIRROR_WIKI_DATABASE_ID`, `MCP_NOTION_MIRROR_KB_ROOT`, `MCP_NOTION_MIRROR_BANNER_TEXT`. None of these belong to the MCP any more — the caller passes the parent ID per-call and constructs banners as `prepend_blocks`.

---

## Sibling-convention sanity checks (don't reinvent)

- Single HTTP client module — `src/notion-client.ts` owns the Bearer header, `Notion-Version`, JSON content-type, typed error mapping. Every tool calls it.
- `errorResult(...)` (not throws) — the audit-log wrapper depends on the `isError` envelope.
- zod `.strict()` schemas with bounded sizes. `page_id` is regex-validated as 32 hex chars or the dashed UUID form. `title` capped at 2000 chars (Notion's limit).
- Access-gated registration. `notion_mirror_page_archive` is `destructive` (only registers when access level allows); the others are `write`/`read`.
- Bun (≥ 1.3) for dev; compiled `dist/` runs under Node (≥ 22).

---

## Acceptance criteria

The rewrite is done when **all** of these are true:

1. `bun run test` passes — unit + integration with a mocked HTTP client.
2. Tests cover:
   - `page_create` posts to `/v1/pages` with the supplied parent verbatim.
   - `page_create` injects `prepend_blocks` before the markdown-derived blocks (assert order in the body).
   - `page_create` errors on empty body + no prepend.
   - `page_archive` with `dry_run: true` (default) returns the would-archive metadata without calling Notion.
   - `page_archive` with `dry_run: false` issues `PATCH /v1/pages/{id}` with `{ archived: true }`.
   - `page_move` issues `PATCH /v1/pages/{id}` with the new parent — and the tool description warns about the page-id↔database-id limitation.
   - `page_get` round-trips Notion's response.
   - Token never appears in any test output, audit log, or error message.
3. README: tool surface table, env-var setup, brief example showing how a caller composes `page_create` calls to publish a KB note (including a sample `prepend_blocks` banner).
4. `biome` lint + format clean.
5. CHANGELOG entry: `feat!: rewrite as thin Notion plumbing — generic page_create / page_archive / page_move / page_get tools. All KB-specific orchestration moves to the caller. BREAKING: previous tool surface (notion_mirror_note_*) is removed.`

---

## Migration notes for callers (orchestrators)

The pattern that used to be one MCP call now becomes ~4 calls in the caller:

```ts
// Old (v0.x):
notion_mirror_note_publish({ kb_path: "Pillars/.../X.md" })

// New (v1.0 caller orchestration):
const file = await readFile(kb_path);
const { frontmatter, body } = parseFrontmatter(file);
const parentMirrorUrl = resolveParentMirrorUrl(kb_path);   // caller knows folder conventions
const parent = { type: "page_id", page_id: extractPageId(parentMirrorUrl) };
const title = basename(kb_path, ".md");
const banner = bannerBlockFor(title, today);

const { url, page_id, created_time } =
  await notion_mirror_page_create({ parent, title, body_markdown: body, prepend_blocks: [banner] });

await writeFrontmatter(kb_path, {
  notion_mirror_url: url,
  notion_mirror_published_at: created_time.replace(".000Z", "Z"),
});
```

A reference TypeScript module showing this composition lives in the README. The orchestration logic — frontmatter reading, parent resolution, banner construction, write-back — is the **caller's** code, not the MCP's.

---

## Notion API caveats to document in tool descriptions

1. `page_move` cannot move a page between a `page_id` parent and a `database_id` parent. Notion's `PATCH /v1/pages/{id}` silently ignores such requests (no error, parent unchanged). For that case, the caller must archive + recreate. Tested 2026-05-30 against API version `2022-06-28`.
2. Notion's archive call cascades to descendants. Archiving a parent page archives all children too. Document on `page_archive`.

---

## Handoff checklist

- [ ] Read this spec end-to-end. Discard prior specs from your queue.
- [ ] Bump version to `1.0.0`.
- [ ] Rewrite `src/tools/` to expose the 4 new tools. Delete the v0.x tools entirely (no compat shims).
- [ ] Refactor `src/notion-client.ts` to support the 4 underlying API calls (POST page, PATCH page (archive + parent), GET page).
- [ ] Update tests per Acceptance Criteria 2.
- [ ] Rewrite README (tool surface, env-vars, caller example).
- [ ] Update `claude-config-sample.json` to drop the obsolete env vars.
- [ ] Update CHANGELOG with the breaking-change entry.

---

## Out of scope (for the caller / orchestrator, not the MCP)

These belong to the orchestrator that uses this MCP. They're listed here as a reminder to whoever builds the caller next, not as MCP work:

- Folder-index convention (basename = folder name) and parent resolution from path.
- `mirror: exclude` frontmatter signal.
- Walk Pillars/ and discover publishable notes.
- Sort order (DFS preorder so parents publish before children).
- Banner block construction.
- Frontmatter write-back (`notion_mirror_url`, `notion_mirror_published_at`).
- Wipe / migration scripts.

The orchestrator design is a separate spec, owned by the KB that uses this MCP (e.g. kit-hnr).
