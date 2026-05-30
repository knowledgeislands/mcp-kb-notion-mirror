# Enhancement Spec 01 — Hierarchical publishing

**Status:** ready to hand to the MCP-building project.
**Predecessor:** `BUILD-SPEC.md` (now obsolete — landed in v0.1.0).
**Target version:** v0.2.0.

---

## Why

In v0.1.0 every mirror page is created as a direct child of the wiki database root. The wiki home page is a flat dump of every published note — there's no navigation. The KB has a well-formed folder hierarchy with an index note in every folder (a strictly-enforced KB convention: every folder has a note named after the folder, e.g. `Pillars/Engineering/Bioweave/Bioweave.md`). The mirror should replicate that hierarchy so the wiki gains the same navigation for free.

After this enhancement, the wiki home shows top-level Pillars (`Engineering`, `Operations`, `Product`), each expandable into its sub-folders, leaf pages nested at the right depth — matching the KB's folder shape.

---

## Out of scope

- Cross-pillar navigation (the wiki home doesn't get a hand-curated landing page; we rely on Notion's wiki tree view).
- Rendering KB wikilinks `[[X]]` as Notion mentions or page-references. They stay as literal text. Tracked separately.
- Image upload. Still deferred (see v0.1.0 ROADMAP).

---

## What's already in place after v0.1.0 (do not break)

- 4 tools: `notion_mirror_note_status`, `notion_mirror_unpublished_list`, `notion_mirror_note_publish`, `notion_mirror_note_archive`.
- `notion_mirror_note_publish` parents every new page at the wiki database root via `parent: { type: "database_id", database_id: <WIKI_DB_ID> }`.
- `notion_mirror_unpublished_list` returns only KB notes that have `notion_source_url` set (i.e. drained from Notion). Folder-index notes that are KB-native (no `notion_source_url`) are invisible to it.
- The wiki has 6 pages already published at the root, with no parent:

  | KB path | Notion page id | Should live under |
  | --- | --- | --- |
  | `Pillars/Engineering/Bioweave/Multi-Instance and Multi-Tenant.md` | `3709f7187cc2814e8652f99fd36857ff` | `Bioweave` |
  | `Pillars/Engineering/Bioweave/Platform Architecture.md` | `3709f7187cc2816686f5e2d12b30e795` | `Bioweave` |
  | `Pillars/Engineering/Layers/Platform/Platform Conventions.md` | `3709f7187cc281edbaa4fa4ac239e809` | `Platform` |
  | `Pillars/Engineering/Layers/Platform/Azure Account Structure.md` | `3709f7187cc28101b1a9f40b5c68b033` | `Platform` |
  | `Pillars/Engineering/Layers/Platform/Module System.md` | `3709f7187cc281b79e41f5643e2140f1` | `Platform` |
  | `Pillars/Engineering/Layers/Platform/Operations and Monitoring.md` | `3709f7187cc281d8a98add0a8cce0d4c` | `Platform` |

  These six need to be re-parented after the enhancement (via the new `notion_mirror_note_move` tool — see below). The orchestrator handles that; the MCP just exposes the capability.

---

## Changes

### Change 1 — Parent auto-derivation in `notion_mirror_note_publish`

The publish tool gains an internal step that computes the desired Notion parent from the KB note's filesystem path.

**Resolution rule (applies to all publishes; no caller arg needed):**

Let `P` = the KB note's path under `<KB_ROOT>/Pillars/...`.

1. **The pillars root** — if `P == <KB_ROOT>/Pillars/Pillars.md`, the Notion parent is the wiki database (`{ type: "database_id", database_id: <WIKI_DB_ID> }`). This is the only page that parents at the database root.

2. **Folder-index notes** — if the basename of `P` (sans `.md`) equals the basename of `P`'s containing directory, `P` is a folder index. Its parent is the index note of the **grandparent** folder:

   - `Pillars/Engineering/Engineering.md` → parent is `Pillars/Pillars.md`
   - `Pillars/Engineering/Bioweave/Bioweave.md` → parent is `Pillars/Engineering/Engineering.md`
   - `Pillars/Engineering/Layers/Backend/Backend Components/Backend Components.md` → parent is `Pillars/Engineering/Layers/Backend/Backend.md`

3. **Leaf notes** — for any other note, the parent is the index note of its containing directory:

   - `Pillars/Engineering/Bioweave/Multi-Instance and Multi-Tenant.md` → parent is `Pillars/Engineering/Bioweave/Bioweave.md`

**Parent lookup:** once the parent KB path is computed, the MCP reads its frontmatter and pulls `notion_mirror_url`, then extracts the 32-hex page id from the URL. The publish call uses `parent: { type: "page_id", page_id: <parent_page_id> }`.

**Errors:**

- If the resolved parent KB path does not exist on disk, error with: `"Folder index missing: <parent_kb_path>. Every folder under Pillars/ must have an index note named after the folder."` (This is a KB-side breakage and the user must fix it before publishing can proceed.)
- If the parent KB note has no `notion_mirror_url`, error with: `"Publish parent first: <parent_kb_path>"`. The caller should orchestrate by publishing parents-first.
- Both errors return as `errorResult` (not throws) so the access-gated wrapper logs them correctly.

### Change 2 — `notion_mirror_unpublished_list` includes required index notes

The current list filter is "has `notion_source_url` AND no `notion_mirror_url`". Replace with: the **publishable closure**.

Algorithm:
1. Find all KB notes under `<root>/Pillars/` with `notion_source_url` set and no `notion_mirror_url` → call this `source_set`.
2. For each note in `source_set`, walk up to the pillars root, collecting every required index note (per the resolution rule in Change 1). Skip an index if it already has `notion_mirror_url` (already published). Call this `index_set`.
3. Return `source_set ∪ index_set`, **sorted in tree order** so a naive in-order iteration from the caller publishes parents before children. Tree order = breadth-first by depth, alphabetical within a depth; or equivalently, sort by path depth ascending, then path alphabetical.

Return shape unchanged otherwise: `{ root, count, notes: [path, ...], details: [{ path, source_url? }, ...] }`. For index notes that have no `source_url`, omit the `source_url` field from `details` rather than emitting an empty string.

### Change 3 — New tool `notion_mirror_note_move`

| Tool | Annotations | Args | Returns |
| --- | --- | --- | --- |
| `notion_mirror_note_move` | `readOnlyHint: false, destructiveHint: false` | `kb_path: string` | `{ moved: true, page_id, previous_parent, new_parent }` |

Re-parents an already-published mirror page to its auto-derived parent (per Change 1's resolution rule). Used to fix the six pages currently parented at the wiki root, and as a one-off recovery if a page ends up under the wrong parent.

**Pipeline:**
1. Read the KB note's frontmatter. Require `notion_mirror_url` to be set; otherwise return `errorResult("Note is not published — cannot move.")`.
2. Extract the page id from `notion_mirror_url` (32-hex regex, same as the archive tool).
3. Resolve the desired parent KB path using Change 1's rule. Require its `notion_mirror_url`; otherwise `errorResult("Publish parent first: <parent_kb_path>")`.
4. Fetch the current page via `GET /v1/pages/{id}` to record the previous parent (for the return value).
5. `PATCH /v1/pages/{id}` with body `{ "parent": { "type": "page_id", "page_id": "<new_parent_page_id>" } }`. Notion supports moving a page to a new parent via this call as of API version `2022-06-28`. Both old and new parents must be accessible to the integration; if either isn't, Notion returns a 404 (handle and surface as a clear error).
6. Do **not** modify the KB note's frontmatter — the page URL is stable across moves, so `notion_mirror_url` and `notion_mirror_published_at` are untouched.
7. Return `{ moved: true, page_id, previous_parent, new_parent }` where each parent value is either `{ type: "page_id", page_id: "..." }` or `{ type: "database_id", database_id: "..." }` — preserve Notion's shape for legibility.

No `dry_run` flag — `notion_mirror_note_move` is non-destructive (the page content isn't touched, only its tree position). If the caller wants to preview, they can use `notion_mirror_note_status` to see where the page currently sits.

### Change 4 — `notion_mirror_note_status` enrichment

Extend the returned object to include the auto-derived parent state:

```jsonc
{
  // ... existing fields ...
  "parent": {
    "kb_path": "/Users/.../Pillars/Engineering/Bioweave/Bioweave.md",
    "kb_exists": true,
    "mirror_url": "https://www.notion.so/Bioweave-3709...",
    "mirror_published": true
  },
  "publish_blocked_by": null
}
```

If the parent doesn't exist on disk: `kb_exists: false`, `mirror_url: null`, `mirror_published: false`, `publish_blocked_by: "missing-folder-index"`.

If the parent exists but isn't published yet: `kb_exists: true`, `mirror_url: null`, `mirror_published: false`, `publish_blocked_by: "parent-not-published"`.

For `Pillars/Pillars.md` (which parents at the database, not a page): `parent: { kb_path: null, kb_exists: false, mirror_url: null, mirror_published: true, parent_type: "wiki-database-root" }`.

This lets the caller decide what to publish next without having to compute parents itself.

---

## Acceptance criteria

The enhancement is done when **all** of these are true:

1. `bun run test` passes (unit + integration with mocked HTTP). New tests cover:
   - Parent resolution for each of the three rules (root, index-of-folder, leaf-of-folder).
   - Error path for "publish parent first" when parent is unpublished.
   - Error path for "folder index missing" when the index file is absent.
   - `unpublished_list` ordering: parents always appear before their children.
   - `notion_mirror_note_move` issues the expected `PATCH` body and surfaces the previous parent.
2. Publishing `Pillars/Pillars.md` first (no parent on KB side), then `Pillars/Engineering/Engineering.md`, then `Pillars/Engineering/Bioweave/Bioweave.md`, then `Pillars/Engineering/Bioweave/Multi-Instance and Multi-Tenant.md` (with `force: true` to overwrite the existing flat-rooted publish) produces a nested wiki: `Pillars > Engineering > Bioweave > Multi-Instance and Multi-Tenant`.
3. `notion_mirror_unpublished_list` after step 2 returns the next page to publish AT INDEX 0 with a parent that is already published (no caller-side sorting needed).
4. `notion_mirror_note_move` against `Pillars/Engineering/Bioweave/Multi-Instance and Multi-Tenant.md` (after its parents `Pillars.md`, `Engineering.md`, `Bioweave.md` are published) moves the existing rootless mirror page under `Bioweave` without changing its URL. Verified by fetching the page from Notion and reading `parent`.
5. The 6 already-published rootless pages can be re-homed by 6 sequential `notion_mirror_note_move` calls (orchestrator's job, not the MCP's — but it must work).
6. `biome` lint + format clean.
7. README updates: new "Hierarchy" section explaining the parent-resolution rule and the orchestrator pattern (publish indexes first, then leaves; use `move` for legacy flat-rooted pages).
8. ROADMAP.md: tick "Hierarchy" off the list. Carry forward unchecked: images, wikilink resolution, stable URLs across re-publish.

---

## Sibling-convention sanity checks (don't reinvent)

- The new `notion_mirror_note_move` tool uses the same `errorResult` + audit-log + access-level-gated registration pattern as the existing tools.
- The PATCH call goes through the same single HTTP client module as the existing POST/GET calls — do not build a new `fetch` site inline.
- The parent-resolution helper (KB path → parent KB path) lives in a `src/parent-resolver.ts` module with its own unit tests, separate from the publish tool's pipeline. Keep the resolution logic pure (path string in, path string out) so it's easy to test in isolation.

---

## Open question for the implementer (return an answer when you ship)

Notion's `PATCH /v1/pages/{id}` for page moves — confirm the call shape works for moving a page that is **currently parented at a database** to a **page parent**. Some older Notion API constraints required pages to stay at the same kind of parent. If that constraint still exists, the move tool would need a different path (e.g. delete + recreate, which loses comments). The user has confirmed all 6 currently-flat-rooted pages need to migrate from database-parent to page-parent, so this is a hard requirement. If it fails, surface as a clear blocker rather than silently degrading.

---

## Handoff checklist

- [ ] Read this spec end-to-end.
- [ ] Read `BUILD-SPEC.md` for v0.1.0 context (the conventions still apply).
- [ ] Bump version to `0.2.0` in `package.json`.
- [ ] Implement Changes 1–4.
- [ ] Add tests per Acceptance Criteria 1.
- [ ] Update README (Tools table gains `notion_mirror_note_move`; Hierarchy section added).
- [ ] Update ROADMAP.md.
- [ ] Verify the open question above against a live Notion call before merging.
