# Roadmap

Forward-looking plans only. Shipped features live in [README.md](./README.md); release history lives in the git log.

## Known gaps (deferred from v1)

These are _known_ limitations of the first iteration, not bugs:

1. **Images.** Many KB notes reference local PNGs (`<Note Name> - images/foo.png`). Notion needs these uploaded via `POST /v1/file_uploads`, then referenced as `image` blocks with `type: file_upload`. The first iteration **skips** images: `@tryfabric/martian` renders a markdown image as a paragraph containing the alt text + path, which is visually obvious as "this needs fixing". Inlining data URIs is not an option — Notion rejects them.
2. **Wikilinks.** Markdown `[[X]]` doesn't resolve to anything in Notion, so it passes through as literal text. A later pass can resolve targets that already have a `notion_mirror_url` and rewrite them as `mention` blocks.
3. **Stable URLs across re-publish.** `force: true` archives the old mirror page and creates a new one, so the URL changes. This matches the canonical-wins rule (the mirror is disposable). If stable URLs become a requirement, switch to edit-in-place via `PATCH /v1/blocks/{page_id}/children` + clearing the old children — harder, and not needed yet.

## Next Up

- **Image upload pipeline** — resolve `<Note> - images/` siblings, upload via `POST /v1/file_uploads`, swap the alt-text placeholder paragraphs for real `image` blocks.
- **Wikilink resolution** — second pass that rewrites `[[X]]` to a Notion `mention` when `X` has a `notion_mirror_url`.
- **`notion_mirror_note_diff`** — show the block-level diff a publish/republish would produce without writing, so callers can review before mutating.

## Future Advanced Capabilities

- **Edit-in-place re-publish** — stable mirror URLs across republishes (see gap 3).
- **Multi-mirror routing** — today there is one wiki target (`MCP_NOTION_MIRROR_WIKI_DATABASE_ID`); a future version could route notes to different mirrors by frontmatter or path.
- **Backlink sync** — write the mirror's inbound links back into the KB note for a fuller provenance trail.

## Tooling

- Live integration test gated behind a real token env var (`src/**/*.live.test.ts`), skipped by default, for occasional end-to-end verification against a throwaway Notion workspace — in particular to confirm the `notion_mirror_note_move` PATCH re-parents a database-rooted page to a page parent (see the open question carried from ENHANCEMENT-SPEC-01).

## Shipped

- **v0.2.1 — Publish-order correctness** (ENHANCEMENT-SPEC-02). `notion_mirror_unpublished_list` now (1) orders a folder index before its equal-depth sibling leaves so a naive top-to-bottom publish never hits `Publish parent first`, and (2) includes the unpublished ancestor indexes of _already-mirrored_ (flat-rooted) leaves, so orphaned pages can be published-then-moved. No tool-surface change.
- **v0.2.0 — Hierarchical publishing.** Pages are nested under their folder-index parent (parent auto-derived from KB path); `notion_mirror_unpublished_list` returns the publishable closure in tree order; new `notion_mirror_note_move` re-homes legacy flat-rooted pages. See README → Hierarchy.
- **v0.1.0** — initial publish/status/list/archive surface, smoke test, audit log.
