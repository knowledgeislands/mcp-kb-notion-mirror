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

- Smoke test (`bun run test:smoke`) — boot the built server and verify the wire-level tool surface matches in-process registration. mcp-gmail has the reference implementation (`scripts/smoke.ts` + CI step); this repo verifies the surface ad hoc but lacks the committed script.
- Live integration test gated behind a real token env var (`src/**/*.live.test.ts`), skipped by default, for occasional end-to-end verification against a throwaway Notion workspace.
