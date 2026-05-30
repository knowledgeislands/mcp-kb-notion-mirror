# Enhancement Spec — in-place body update (URL stays the same)

**Status:** ready to hand to the MCP-building project.
**Size:** small — one new mode for `publish`, plus a tiny Notion API caveat.

---

## Why

Today `notion_mirror_publish` has two paths against an already-mirrored note:

| `force`           | Behaviour                                          | URL after                |
| ----------------- | -------------------------------------------------- | ------------------------ |
| `false` (default) | Skip — return `{ skipped: true, existing_url }`    | Unchanged (no operation) |
| `true`            | Archive the existing mirror page, create a new one | **Changes**              |

Neither is "freshen this page in place". That gap matters for the wikilink-resolution workflow:

1. First pass: publish every note (no `link_map` — URLs aren't known yet). Wikilinks render italic.
2. Build `link_map` from the URLs that now exist.
3. Second pass: re-render every body with `link_map` so `[[X]]` → `@mention`.

If step 3 uses `force`, every URL changes, so the @mentions in _other_ notes that point at THIS note now reference an archived page. Round-trip never converges.

The fix is a third behaviour: update the body and properties in place, keep the URL.

---

## Change — extend `publish` with a `replace` mode

Replace the boolean `force` with a tri-state `mode`:

```ts
notion_mirror_publish({
  kb_path: string,
  parent: { type, ... },
  mode?: "create" | "replace" | "force",   // default "create"
  // unchanged:
  icon?: ...,
  full_width?: boolean,
  link_map?: Record<string, string>,
})
```

| `mode`               | If `notion_mirror_url` is set                                                               | If not set                             |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| `"create"` (default) | Return `{ skipped: true, existing_url }`. No Notion call.                                   | Create a new page (current behaviour). |
| `"replace"`          | **Update the existing page in place** (see pipeline below). URL is preserved.               | Create a new page (same as `create`).  |
| `"force"`            | Archive the existing page, create a new one (current `force: true` behaviour). URL changes. | Create a new page.                     |

For backward compatibility during the transition: accept `force: true` as an alias for `mode: "force"` but warn that `mode` is preferred. Drop `force` next round.

The `parent` argument is required by all modes. For `replace`, if the page's current parent in Notion differs from the supplied one, the implementer can choose: re-issue a parent change via `PATCH /v1/pages/{id}` (best — keeps the page in sync with the orchestrator's tree understanding), or ignore and only update the body (acceptable, but document). **Recommendation: re-issue the parent change.** This makes `replace` idempotent against orchestrator tree movements.

---

## Pipeline — `mode: "replace"` against an existing page

The pipeline reuses every existing piece (frontmatter parse, body strip, martian, banner, link_map, footer). What's different is that instead of POSTing a new page, it patches the existing one.

1. Resolve `kb_path`. Read the file. Reject if no frontmatter or no `notion_mirror_url`.
2. Extract page id from `notion_mirror_url`.
3. Strip frontmatter and H1; convert markdown body to Notion blocks via martian; prepend banner; resolve wikilinks via `link_map`.
4. **Update page properties** with `PATCH /v1/pages/{id}`:
   - `icon` (if supplied, or `null` to clear)
   - `properties` (title only — derive from `kb_path` basename)
   - `format.page_full_width` (if `full_width` is supplied and the API supports it)
   - `parent` (if changed)
5. **Replace body content:**
   - `GET /v1/blocks/{id}/children` (paginated).
   - Filter the result: keep `child_page` blocks (they represent real sub-pages — deleting them would orphan/break children); delete everything else.
   - For each non-`child_page` block, `DELETE /v1/blocks/{block_id}`.
   - `PATCH /v1/blocks/{id}/children` to append the new body (banner + markdown blocks).
6. **Refresh footer** (same logic as v1.1.0's child-pages footer side effect): if the parent is a `page_id`, regenerate the parent's footer to reflect current children. **Also refresh THIS page's own footer** if it has page-id children — replace draws will have cleared it.
7. Update `notion_mirror_published_at` in the KB frontmatter. **Do not** change `notion_mirror_url` (it didn't change).
8. Return `{ url, page_id, published_at, mode: "replace" }`.

### What's preserved across a replace

- Page URL and page id (stable bookmark target)
- Page-level comments (Notion-side, untouched by API block edits)
- Child pages (because `child_page` blocks are kept, and the children remain parented at this page)

### What's destroyed across a replace

- The previous body content (paragraphs, headings, lists, tables, etc.)
- The previous footer (regenerated)
- Block-level comments (unfortunate — Notion attaches them to specific blocks, which we delete)

Document the comment-loss caveat in the tool description. It is acceptable for our workflow (canonical body always wins; feedback is the user's responsibility to fold back into the KB before a replace runs).

---

## Tool surface impact

No new tools. Just the new `mode` argument on `publish`. `unpublish`, `move`, `get` are unchanged.

---

## Why a tri-state `mode` instead of two booleans

I considered `force` + `replace` as separate booleans. Tri-state is cleaner because:

- Only one of the three behaviours can apply per call (mutually exclusive)
- The intent name (`create` / `replace` / `force`) reads better than `force: true, replace: false` combinations
- Future modes (e.g. `merge`?) slot in without adding more booleans

---

## Acceptance criteria

1. `bun run test` passes. New tests cover:
   - `mode: "create"` against a non-mirrored note: creates a page (existing behaviour).
   - `mode: "create"` against a mirrored note: skip, no Notion call.
   - `mode: "replace"` against a mirrored note: PATCHes properties; deletes existing non-child_page blocks; PATCHes new children. URL in the response matches `notion_mirror_url` before the call.
   - `mode: "replace"` against a non-mirrored note: creates a new page.
   - `mode: "replace"` preserves `child_page` blocks.
   - `mode: "replace"` updates `notion_mirror_published_at` but not `notion_mirror_url`.
   - `mode: "force"` against a mirrored note: archives old, creates new (existing behaviour).
   - `force: true` (legacy boolean) still works and is equivalent to `mode: "force"`.
2. `biome` lint + format clean.
3. README: update the tool table with the `mode` argument, add a "When to use which mode" mini section, document the block-comment-loss caveat in `replace`.
4. CHANGELOG: `feat: publish gains mode: "replace" — in-place body+properties update that preserves the page URL. Enables stable @mention resolution across multiple passes. force boolean kept as backwards-compat alias for mode: "force".`

---

## Notion API caveats to document

1. `PATCH /v1/blocks/{block_id}/children` only **appends** — it cannot replace or insert. Replacing children requires GET → DELETE each → PATCH-append. Notion charges these as individual API calls; replacing a 100-block page takes ~100 + 2 calls. Document expected wall-clock and rate-limit considerations.
2. Notion's block-level comments are attached to block ids; deleting a block destroys its comments. Document that `mode: "replace"` is body-destructive in that narrow sense, but page-level comments are preserved.
3. `child_page` blocks must be preserved during the replace, otherwise the visual representation of sub-pages disappears from the parent's body. Children remain parented (the database/page tree relationship doesn't depend on these blocks) but the parent's body would look empty until Notion's lazy refresh re-creates the blocks.

---

## Two-pass orchestrator workflow (caller-side note, for README)

With `replace`, the canonical orchestrator workflow becomes:

```text
Pass 1 — initial publish
  for each note in tree order:
    notion_mirror_publish({ kb_path, parent, mode: "create", icon, full_width })
  ↓
  Every note has a notion_mirror_url. link_map can now be built.

Pass 2 — wikilink resolution
  build link_map: { target → notion_mirror_url } from every note
  for each note (any order — URLs are stable now):
    notion_mirror_publish({ kb_path, parent, mode: "replace", icon, full_width, link_map })
  ↓
  Every [[X]] in every body is now a Notion @mention pointing at the right page.
```

The orchestrator owns the two-pass loop. The MCP just supports `replace`.

---

## Handoff checklist

- [ ] Read this spec end-to-end.
- [ ] Implement the `mode` argument on `publish`.
- [ ] Keep `force: true` as a legacy alias for `mode: "force"` for one round.
- [ ] Implement the in-place pipeline in §Pipeline.
- [ ] Preserve `child_page` blocks during the body replace.
- [ ] Tests per Acceptance Criteria 1.
- [ ] README + CHANGELOG updates.
