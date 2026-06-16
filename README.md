# mcp-kb-notion-mirror

Local stdio MCP server that **mirrors** Knowledge Base markdown notes into Notion and records the resulting Notion URL back into each note's
YAML frontmatter.

The KB is canonical; the Notion mirror is a derivative read surface for people who don't work in the KB. The server exposes **three
resources** of tools, all prefixed `kb_notion_mirror_` (the repo-derived app name):

- **`note`** (`kb_notion_mirror_note_*`) — act on one `kb_path` per call and (for mutations) a Notion `parent` you supply. File-aware but
  layout-agnostic: no directory walking, no parent resolution.
- **`tree`** (`kb_notion_mirror_tree_*`) — walk a caller-supplied `subtree` folder under the KB root, apply the folder-index hierarchy
  convention, and attach the subtree's root under a caller-supplied `parent`. Built on the note verbs.
- **`roots`** (`kb_notion_mirror_roots_list`) — pure discovery: list the folders declared as mirror roots (`kb_notion_mirror_root`
  frontmatter) and the parent each attaches under, so a client drives the `tree` verbs per root without rescanning the KB.

There is **no fixed root folder and no fixed wiki database**. Every mutation takes the `kb_path`/`subtree` and the `parent` it attaches
under **per call** — so you can mirror any note or folder under any Notion parent.

Conforms to the **MCP specification 2025-11-25**.

## The verb model

Each resource shares one verb set (the `note`/`tree` columns show where a verb exists):

| Verb        | note | tree | What it does                                                                                 |
| ----------- | :--: | :--: | -------------------------------------------------------------------------------------------- |
| `get`       |  ✅  |  —   | Fetch the **live** Notion page state. Pure read.                                             |
| `status`    |  ✅  |  ✅  | Is it mirrored? (frontmatter only, no Notion call). Tree aggregates + orders.                |
| `preflight` |  ✅  |  ✅  | Local readiness check (no Notion call). Tree adds the missing-folder-index check.            |
| `touch`     |  ✅  |  ✅  | Create a body-less scaffold so the page URL becomes known for linking.† Idempotent.          |
| `update`    |  ✅  |  ✅  | Push the body + resolve `[[wikilinks]]`. **Requires a prior `touch`.** URL preserved.        |
| `move`      |  ✅  |  —   | Re-parent the page. URL/content unchanged.                                                   |
| `delete`    |  ✅  |  ✅  | Archive the page + clear the mirror frontmatter. Destructive — `dry_run` defaults to `true`. |

† The scaffold is a title + icon + banner, with no body — just enough for the page (and its URL) to exist.

**Mirroring is two-phase by design.** There is no `create`: `touch` is how a page comes into existence (a scaffold with a stable URL), then
`update` fills the body and turns `[[wikilinks]]` into `@`mentions. Splitting them guarantees every link target exists before any body
renders — so the order is always **touch-all → update-all**.

## What a touch / update does

`touch`, given a note and a parent:

1. Resolves the page title (the note's filename) and, under a database parent, the database's title property.
2. Prepends a "Mirrored from Knowledge Base" banner callout dated today.
3. Creates the page (banner only — no body) under the `parent`.
4. Writes `kb_notion_mirror_url` + `kb_notion_mirror_published_at` back into the note's frontmatter (atomically, preserving field order and
   formatting).

`update`, on a touched note:

1. Strips the frontmatter and the leading `# Title` H1 (Notion takes the title from a page property).
2. Converts the markdown body to Notion blocks via [`@tryfabric/martian`](https://github.com/tryfabric/martian) — paragraphs, headings,
   nested lists, code fences, blockquotes, dividers, GFM tables, inline formatting, links.
3. Resolves `[[wikilinks]]` against the supplied `link_map` into `@`mentions.
4. Replaces the page body **in place** (URL kept), sparing native child pages.

## The folder-index hierarchy convention

The `tree` verbs encode one convention for turning a folder tree into a Notion page tree:

- A folder's **index note** is `<Folder>/<Folder>.md` (its basename equals the containing folder's basename). That note becomes the folder's
  Notion page.
- A **leaf note** nests under its folder's index page.
- A **sub-folder's index** nests under the **grandparent** folder's index page.
- The **subtree-root index** (the index of the `subtree` folder itself) attaches to the caller-supplied `parent`.

So for `subtree = "Alpha"` with parent = a wiki database:

```text
Alpha/Alpha.md            → page under the wiki database (the parent)
Alpha/Leaf.md             → page under Alpha
Alpha/Beta/Beta.md        → page under Alpha
Alpha/Beta/Gamma.md       → page under Beta
```

Notes excluded from mirroring: any with `mirror: exclude` or `kb_notion_mirror_exclude` in frontmatter, any whose filename starts with a
configured skip prefix (default `+`), and any kb-path in the configured skip list. When an exclude flag is set on a **folder index**, the
whole subtree under that folder is pruned (so excluding a folder never orphans its children).

## Roots: declared in the KB, driven by the client

Mark a folder index as a mirror root:

```yaml
kb_notion_mirror_root: 36f9f7187cc280f69272e60aa89bff24 # the Notion parent the root attaches under
```

The value is the Notion parent: a wiki **database** id by default, `db:<id>` explicitly, or `page:<id>` to nest the root under a Notion
page. `kb_notion_mirror_roots_list` discovers every such folder (pruning below a root — a root can't nest a root — and skipping excluded /
skip-prefixed branches) and returns `[{ subtree, indexKbPath, parent }]`.

This is **discovery only**. To mirror everything, a client calls `roots_list` then loops the `tree` verbs per root with the parent returned
— so the MCP never does a frontmatter-driven batch mutation, and every mutation still takes an explicit parent. The publish CLI (below)
ships this loop as a convenience, including the one-link-map-across-all-roots step so cross-root `[[wikilinks]]` resolve.

## Tools

Fourteen tools across the three resources. `note` (7):

- **`kb_notion_mirror_note_get(kb_path)`** — read. Live Notion page state, or `{ exists: false, reason: "not-mirrored" }`.
- **`kb_notion_mirror_note_status(kb_path)`** — read. `{ published, url?, published_at? }` from frontmatter; no Notion call.
- **`kb_notion_mirror_note_preflight(kb_path)`** — read. `{ ok, issues }`; no Notion call.
- **`kb_notion_mirror_note_touch(kb_path, parent, icon?)`** — write. Scaffold + write URL back. Idempotent →
  `{ skipped: true, existing_url }` when already mirrored, else `{ url, page_id, published_at }`.
- **`kb_notion_mirror_note_update(kb_path, parent, icon?, link_map?)`** — write. Body push + wikilink resolution;
  `{ url, page_id, updated_at }`. Errors if not touched first.
- **`kb_notion_mirror_note_move(kb_path, parent)`** — write. `{ moved: true, page_id, previous_parent, new_parent }`.
- **`kb_notion_mirror_note_delete(kb_path, dry_run?)`** — destructive. Archive + clear frontmatter; `dry_run` default `true`.

`tree` (6) — each takes `subtree` and (for mutations) `parent`; `touch`/`update`/`delete` accept an optional `kb_path` to act on just one
note's ancestor chain:

- **`kb_notion_mirror_tree_status(subtree)`** / **`_preflight(subtree)`** — read.
- **`kb_notion_mirror_tree_touch(subtree, parent, kb_path?)`** — write. Scaffold every note DFS so all URLs exist.
- **`kb_notion_mirror_tree_update(subtree, parent, kb_path?, link_map?)`** — write. Push bodies; pass `link_map` to resolve **cross-root**
  wikilinks.
- **`kb_notion_mirror_tree_delete(subtree, kb_path?, dry_run?)`** — destructive.
- **`kb_notion_mirror_tree_prune(subtree, dry_run?)`** — destructive. Git-driven: archive the mirror pages of notes **deleted** under the
  subtree (a `kb_notion_mirror_url` gone from every live note on disk; a moved note keeps its URL and is never pruned). Requires the KB root
  to be a git repo; `dry_run` defaults to `true`. Returns `{ eligible, outcomes }` where each outcome's `kbPath` is the deleted note's path.

Tree verbs return `{ eligible, outcomes: NoteOutcome[] }` where `NoteOutcome` is
`{ kbPath, action: "touch"|"update"|"delete"|"skip"|"plan"|"error", url?, error? }`. `tree_prune` reuses this shape: `plan` (dry-run
preview), `delete` (page archived), or `error`.

`roots` (1):

- **`kb_notion_mirror_roots_list()`** — read. `[{ subtree, indexKbPath, parent }]`.

> **Move/delete caveat.** Notion cannot move a page between a `page_id` parent and a `database_id` parent — `PATCH /v1/pages` silently
> ignores it. `move`/ `update` detect that and error; use `delete` + `touch` instead. Archiving cascade-archives descendant pages;
> `note delete` clears only the one note's frontmatter — use `tree delete` to tear down a whole subtree.

## Wikilinks (`link_map`)

KB notes use `[[target]]` / `[[target|display]]` wikilinks. `update` takes a `link_map` (target string → mirror URL); each resolved `[[…]]`
becomes a Notion page `@`mention and unresolved targets render as italic text. `tree_update` builds the map from the subtree automatically —
pass an explicit `link_map` (e.g. one spanning every root, built from `roots_list` + `tree_status`) to resolve cross-root mentions.

## Two-phase publishing

`@`mentions need every target's URL to exist first, and those URLs must stay stable — so a full publish is **touch-all then update-all**:

```text
touch  (URLs don't exist yet)
  for each note in tree order: tree_touch  → every note gets a stable kb_notion_mirror_url
update (URLs are stable)
  build link_map from every note's URL
  for each note: tree_update with link_map  → every [[X]] becomes an @mention
```

`update` replaces the body in place, so the URLs other notes mention keep resolving.

## Child-pages footer

Notion renders a parent's children inline as native `child_page` blocks. The footer is a single **"Child Pages"** `heading_2` placed
immediately above those native child links, to label the section. Maintenance is automatic (no separate tool): refreshed after a
`touch`/`update`/`delete`/`move` touches a page parent. A refresh removes any prior heading, then — if the page has child pages — inserts
one heading right before the first child-page block. Database parents need no heading.

> **Mirror-only / sentinel.** The heading is **never** written into the KB source. Its text is exactly `Child Pages` (a `heading_2`). Any
> future "read the mirror back into the KB" path must recognise this sentinel and strip it.

## Publish CLI

The `mcp-kb-notion-mirror-publish` bin mirrors the tool surface as `<resource> <verb>` subcommands:

```bash
mcp-kb-notion-mirror-publish note status    Alpha/Alpha.md
mcp-kb-notion-mirror-publish note touch      Alpha/Alpha.md --parent-db <wiki-db-id>
mcp-kb-notion-mirror-publish note update     Alpha/Alpha.md --parent-db <wiki-db-id>
mcp-kb-notion-mirror-publish note delete     Alpha/Alpha.md --dry-run

mcp-kb-notion-mirror-publish tree status     Alpha
mcp-kb-notion-mirror-publish tree preflight  Alpha
mcp-kb-notion-mirror-publish tree touch      Alpha --parent-page <page-id>
mcp-kb-notion-mirror-publish tree update     Alpha --parent-page <page-id> --note Alpha/Beta/Gamma.md

mcp-kb-notion-mirror-publish roots list                 # every declared root + its parent
mcp-kb-notion-mirror-publish roots publish              # touch-all then update-all across roots
mcp-kb-notion-mirror-publish roots publish --dry-run
```

`roots publish` is the only place the **cross-root multi-step** lives: it touches every declared root, then updates them all with one link
map spanning every root so cross-root `[[wikilinks]]` resolve. It auto-loads `.env.local` and `.env` from the working directory. Parents are
per-invocation flags (or, for `roots`, read from `kb_notion_mirror_root` frontmatter) — never from env.

## Access levels

Tools are gated by `MCP_KB_NOTION_MIRROR_ACCESS_LEVEL` (default `write`). Each level implies the lower ones:

| Level         | Tools registered                                           |
| ------------- | ---------------------------------------------------------- |
| `read`        | every `_get` / `_status` / `_preflight`, and `_roots_list` |
| `write`       | the above + every `_touch` / `_update`, and `_note_move`   |
| `destructive` | the above + every `_delete`                                |

Gating is driven by each tool's annotations (read-only / idempotent-write / destructive), not its name. This server's whole purpose is
mutating the mirror, so `write` is the practical baseline; archive tools additionally require `destructive`.

## Setup

### 1. Create the Notion integration

1. <https://www.notion.so/my-integrations> → **New integration** (internal). Give it **Read content**, **Insert content**, and **Update
   content** capabilities.
2. Copy the **Internal Integration Secret** (`ntn_…`). Treat it like a password.
3. Open every target page/database in Notion → **⋯** menu → **Connections** → add your integration. Without this connection the API returns
   `restricted_resource` / `403` even with a valid token.

### 2. Build

```bash
bun install
bun run build
```

### 3. Wire into Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (or the Claude Code equivalent) — see
[claude-config-sample.json](./claude-config-sample.json):

```json
{
  "mcpServers": {
    "mcp-kb-notion-mirror": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-kb-notion-mirror/dist/mcp-server/index.js"],
      "env": {
        "MCP_KB_NOTION_MIRROR_TOKEN": "ntn_YOUR_INTEGRATION_SECRET",
        "MCP_KB_NOTION_MIRROR_KB_ROOT": "/absolute/path/to/your/kb"
      }
    }
  }
}
```

Restart Claude.

## Environment variables

| Variable                                   | Required | Default                                           | Purpose                                                                                          |
| ------------------------------------------ | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `MCP_KB_NOTION_MIRROR_TOKEN`               | yes      | —                                                 | Notion internal-integration secret (`ntn_…`).                                                    |
| `MCP_KB_NOTION_MIRROR_KB_ROOT`             | no †     | unset                                             | Absolute KB root. `kb_path` / `subtree` resolve under it and are confined to it.                 |
| `MCP_KB_NOTION_MIRROR_ACCESS_LEVEL`        | no       | `write`                                           | `read` / `write` / `destructive`.                                                                |
| `MCP_KB_NOTION_MIRROR_BANNER_TEMPLATE`     | no       | KB default                                        | Banner copy; `{date}` → today's UTC date; `**bold**` honoured. Empty string disables the banner. |
| `MCP_KB_NOTION_MIRROR_API_BASE_URL`        | no       | `https://api.notion.com`                          | Notion API base URL.                                                                             |
| `MCP_KB_NOTION_MIRROR_SKIP_PREFIXES`       | no       | `+`                                               | Comma-separated filename prefixes excluded from tree walking.                                    |
| `MCP_KB_NOTION_MIRROR_SKIP_PATHS`          | no       | (none)                                            | Comma-separated kb-paths excluded from tree walking.                                             |
| `MCP_KB_NOTION_MIRROR_ICON_BASE_URL`       | no       | `https://unpkg.com/lucide-static@latest/icons`    | Base URL for Lucide-style external page icons.                                                   |
| `MCP_KB_NOTION_MIRROR_AUDIT_LOG`           | no       | `writes`                                          | Audit-log scope. `off` / `writes` / `all`.                                                       |
| `MCP_KB_NOTION_MIRROR_AUDIT_LOG_PATH`      | no       | `~/.local/state/mcp-kb-notion-mirror/audit.jsonl` | Path to the JSONL audit log.                                                                     |
| `MCP_KB_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES` | no       | `10485760` (10 MiB)                               | Size-based rotation threshold in bytes. `0` disables rotation.                                   |
| `MCP_KB_NOTION_MIRROR_AUDIT_LOG_KEEP`      | no       | `5`                                               | Number of rotated audit-log files to retain.                                                     |

† The `tree` and `roots` tools require `MCP_KB_NOTION_MIRROR_KB_ROOT`; the `note` tools work with absolute `kb_path`s when it is unset.

The `subtree` and `parent` are always supplied per call (tool args / CLI flags); `roots` reads parents from `kb_notion_mirror_root`
frontmatter. The Notion token is never written to logs, error messages, or tool output.

## Running locally

```bash
bun run server:mcp:dev      # bun --watch, runs the server from TS source
bun run server:mcp:inspect  # MCP Inspector against the TS source
```

Both set `NODE_ENV=development`, so a local `.env.development` is auto-loaded. Copy [`.env.example`](./.env.example) to `.env.development`
and fill in your token to get started.

## Frontmatter contract

Every mirrorable note has YAML frontmatter; this server touches **only** two fields and never reorders or reformats the rest:

```yaml
---
status: current — May 2026
purpose: <one-line>
notion_source_url: https://www.notion.so/<32hex>
notion_path: Product & Eng / Platform Architecture / …
kb_notion_mirror_url: https://www.notion.so/<slug>-<32hex> # written by this server (at touch)
kb_notion_mirror_published_at: 2026-05-30T01:13:00Z # written by this server, ISO-8601 UTC
---
```

New fields are inserted right after `notion_path` (falling back to `notion_source_url_secondary` / `notion_source_url`). A note with no
frontmatter is an error. `kb_notion_mirror_root` marks a folder index as a mirror root; `mirror: exclude` / `kb_notion_mirror_exclude` opts
a note (or, on an index, a whole subtree) out. Every other field is read-only to this server.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned work (image uploads, a publish diff tool, backlink sync).
