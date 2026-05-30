# Enhancement Spec — links, icons, full-width, child-pages footer

**Status:** ready to hand to the MCP-building project.
**Size:** moderate — three additions to `publish`, plus automatic footer maintenance baked into `publish` / `unpublish` / `move`.

---

## Why

The first publish runs against v1.0.0 surfaced four visual gaps in the mirror:

1. **Wikilinks render as literal text.** `[[Product Delivery]]` shows up as the four-character sequence `[[…]]` rather than as a clickable link.
2. **No page icons.** Pages are blank rectangles in the wiki listing.
3. **Pages are narrow (default Notion width).** Wide tables (e.g. `Development Process`'s Cycle Calendar 10-column table) wrap awkwardly.
4. **No per-page child navigation.** When you open a parent page (e.g. `Approach`), there's no inline "what's in here" list — you have to use the wiki sidebar.

All four are addressed without changing the v1.0.0 layering principle (MCP = thin plumbing + markdown + banners + write-back; orchestrator decides what to publish).

---

## Changes

### Change 1 — Wikilinks → Notion @mentions, via caller-supplied `link_map`

`notion_mirror_publish` gains an optional argument:

```ts
link_map?: Record<string, string>   // wikilink target → notion page URL
```

For each `[[target]]` or `[[target|display]]` in the body markdown, the MCP:

- If `target` is a key in `link_map` → emit a Notion **page mention** rich-text element pointing at the corresponding page id (extracted from the URL). Use `display` if provided, otherwise the target's basename.
- If `target` is not in the map → emit _italic_ plain text (`*target*`), so unresolved KB references are visible-but-not-clickable.

The mention's page id is extracted from the URL by the same 32-hex regex used elsewhere.

**Why caller-supplied:** the MCP doesn't walk the KB. The orchestrator builds the map (typically by walking every KB note with `notion_mirror_url`) and passes the slice relevant to this publish call.

**Where the substitution happens:** after frontmatter strip but **before** martian sees the markdown. The MCP rewrites `[[…]]` matches to placeholders martian can pass through (e.g. `[X](mention:<page_id>)`), and post-processes the resulting block tree to convert those placeholder links into proper Notion `mention` rich-text objects.

The MCP **does not** auto-discover the map. If the orchestrator passes `link_map: {}` (or omits it), all wikilinks render as italic plain text.

### Change 2 — Per-page icon

`notion_mirror_publish` gains an optional argument:

```ts
icon?: { type: "emoji"; emoji: string } | { type: "external"; external: { url: string } }
```

Passed verbatim into Notion's page-create body under `icon`. Caller decides.

If absent: no icon (Notion's default — blank).

The orchestrator typically reads the icon from the KB note's frontmatter — proposed convention is a single `icon` field that's either an emoji string or a URL. The orchestrator parses it and constructs the right object. **The MCP is not opinionated about where the icon comes from.**

### Change 3 — Full-width pages

Every mirror page should default to **full width** so wide tables and content lay out properly.

`notion_mirror_publish` gains an optional argument:

```ts
full_width?: boolean   // default true
```

Set in the **same `POST /v1/pages` call** as the rest of the page creation — not via a separate PATCH. Standard Notion shape for this lives under `format: { page_full_width: true }` (or whatever the current field name is — implementer to confirm against the latest API).

`is_full_width` / `page_full_width` is not in the formally documented public schema as of API version `2022-06-28`, but Notion's API has historically accepted it in the POST body. Implementer's job: send it on POST and verify the resulting page is actually full-width. If Notion ignores the field, the call still succeeds (just at default width). If Notion rejects it with a 400 error, the implementer either drops the field on POST (and documents that full-width must be set manually) or finds the correct current field name.

Whatever the outcome, **no separate PATCH** — the icon, parent, properties, format and children all go in the one create call.

### Change 4 — Child-pages footer (automatic, part of every parent-affecting call)

Every non-leaf parent page in the mirror gets a "📂 Child Pages" footer listing its immediate children as Notion page mentions. The footer is **mirror-only** — it is never written into the KB source. It is the mechanism by which child pages are surfaced on their parent's page (the wiki sidebar shows the tree, but the page body itself does not unless we add this).

**This is NOT a separate tool.** Footer maintenance is baked into the calls that affect parent-child relationships:

- After `notion_mirror_publish(kb_path, parent, ...)`: if `parent.type === "page_id"`, refresh the parent's footer (fetch the parent's current children from Notion, regenerate the footer from that list).
- After `notion_mirror_unpublish(kb_path, …)`: if the page had a `page_id` parent, refresh that parent's footer (the archived child should fall out).
- After `notion_mirror_move(kb_path, parent)`: refresh BOTH the old and new parents' footers (the moved child falls out of one, into the other).

When the parent is the wiki database (`parent.type === "database_id"`), no footer maintenance is needed — the database's natural views already list its rows.

**The footer body content (the parent's canonical KB content) is never touched.** The footer is appended at the very end and is identifiable by a sentinel block (a `heading_2` with text exactly `📂 Child Pages`). On regeneration:

1. `GET /v1/blocks/{parent_id}/children` (paginated).
2. Find the sentinel block. If present: delete every block from the sentinel onwards (the existing footer).
3. List the parent's current child pages (filter for `child_page` blocks among the fetched children).
4. Append new footer: the sentinel heading, then one `bulleted_list_item` per child with a `mention` of that child's page id and its title.

**Ordering** in the footer follows Notion's natural child order (creation order). No alphabetical sort — the orchestrator can re-issue moves later if it wants a different order.

**Idempotency.** Regenerating the footer is safe to call any number of times; it always reflects the current Notion-side state of children.

**Sentinel.** A future tool that reads the mirror back into the KB MUST recognise this sentinel and strip blocks at-or-below it before importing.

---

## Updated tool signatures

```ts
notion_mirror_publish({
  kb_path: string,
  parent: { type: "database_id" | "page_id", ... },
  force?: boolean,
  // new in this round:
  icon?: { type: "emoji"; emoji: string } | { type: "external"; external: { url: string } },
  full_width?: boolean,                // default true if API supports; otherwise no-op
  link_map?: Record<string, string>,   // wikilink target → URL
})
// Side effect added in this round: if parent is a page, the parent's child-pages footer is refreshed after the page is created.
```

```ts
notion_mirror_unpublish({ kb_path: string, dry_run?: boolean })
// Side effect added in this round (when dry_run is false and the archived page had a page parent):
// the parent's child-pages footer is refreshed.
```

```ts
notion_mirror_move({ kb_path: string, parent: ... })
// Side effect added in this round: both the old parent's and new parent's child-pages footers are refreshed.
```

`notion_mirror_get` is unchanged — pure read.

All new args on `publish` are optional. Existing callers continue to work, but their parents will start getting footers as side effects. That is the intended behaviour.

---

## Acceptance criteria

The enhancement is done when **all** of these are true:

1. `bun run test` passes. New tests cover:
   - Publishing with a `link_map`: a `[[X]]` whose target is in the map emits a `mention` rich-text element with the right page id.
   - Publishing with an `[[unresolved]]` not in the map: emits italic plain text.
   - Publishing with `[[target|display]]`: uses `display` as the visible text in both resolved and unresolved cases.
   - Publishing with `icon: {type: "emoji", emoji: "📚"}`: the POST body includes the icon field.
   - Publishing with `full_width: true`: the implementation either sets the format (if API supports) or logs that it's a no-op.
   - Publishing under a `page_id` parent: the parent's footer is refreshed after the publish (asserted by the mocked HTTP client: a `GET` then `PATCH` against the parent's children).
   - Publishing under a `database_id` parent: NO footer refresh is attempted.
   - `unpublish` with `dry_run: false` against a page-parented child: footer of that parent is refreshed.
   - `move` from page parent A to page parent B: footers of both A and B are refreshed.
   - Footer sentinel detection: if a parent has prior blocks at the bottom matching the sentinel, those are deleted before the new footer is appended.
2. `biome` lint + format clean.
3. README: tool-surface table updated, orchestrator example shows how to pass `link_map`, `icon`, `full_width`. README documents the footer side-effect and sentinel convention. Note that the footer is mirror-only and must be stripped by any future "read mirror back to KB" path.
4. CHANGELOG: `feat: publish accepts icon/full_width/link_map; parent child-pages footer maintained automatically by publish/unpublish/move.`

---

## Sibling-convention sanity checks (don't reinvent)

- The new `link_map` rewriting happens in a small dedicated module (`src/wikilinks.ts`). It is pure (string → string) and unit-tested with a fixture covering: simple link, link with display, unresolved link, link with special characters in the target, multi-line content with multiple links.
- Footer logic lives in `src/footer.ts` — single pure function `buildFooterBlocks(children: ChildSummary[]): Block[]` plus a side-effecting `refreshFooter(parentPageId): Promise<void>` that fetches, finds the sentinel, deletes the old footer, appends the new one.
- All HTTP goes through the single `notion-client.ts` module — no inline `fetch`.

---

## Notion API caveats to document

1. `full_width` may not be supported by the public API. If `format` isn't a valid property on `POST /v1/pages`, leave the page as default width; the tool should log a warning the first time it's hit and proceed.
2. Footer refresh issues `GET /v1/blocks/{parent}/children` + N × `DELETE /v1/blocks/{block}` + `PATCH /v1/blocks/{parent}/children`. For parents with hundreds of immediate children, this is chatty. Add pagination support (Notion returns 100 children per page) and document that parents with very large child counts may have multi-second footer refreshes.
3. Notion mention objects require the integration to have read access to the mentioned page; mentions of pages outside the integration's scope render as "page not found" for users. Not a concern here (all mentioned pages live in the same wiki the integration is connected to).
4. When the same parent is the target of many concurrent publishes (e.g. parallel publish of 8 sibling leaves), footer refresh becomes a race. Either serialise footer refreshes per parent (lock per parent_id) or accept that one of the refreshes wins and re-issue if needed. **Recommendation: serialise per parent_id with an in-memory lock.** Document the behaviour either way.

---

## Handoff checklist

- [ ] Read this spec end-to-end.
- [ ] Extend `notion_mirror_publish` with `icon`, `full_width`, `link_map`.
- [ ] Add `src/wikilinks.ts` (pure converter, well-tested).
- [ ] Add `src/footer.ts` — pure `buildFooterBlocks` + side-effecting `refreshFooter`.
- [ ] Wire footer refresh into `publish` / `unpublish` / `move` per Change 4.
- [ ] Serialise footer refreshes per parent_id (per-parent lock) to avoid concurrent races.
- [ ] Tests per Acceptance Criteria 1.
- [ ] README + CHANGELOG updates.
