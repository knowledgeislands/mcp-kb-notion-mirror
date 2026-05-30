# mcp-notion-mirror

Local stdio MCP server that **mirrors** Knowledge Base markdown notes to a Notion wiki and records the resulting Notion page URL back into each note's YAML frontmatter.

The KB is canonical; the Notion mirror is a derivative read surface for people who don't work in the KB. Re-publishing a note archives the old mirror page and creates a fresh one — the mirror is disposable, the KB note is the source of truth.

## What it does

Given a KB note under `<KB_ROOT>/Pillars/` whose frontmatter records where it was drained from (`notion_source_url`), this MCP:

1. Strips the frontmatter and the leading `# Title` H1 (Notion takes the title from a page property).
2. Converts the markdown body to Notion blocks via [`@tryfabric/martian`](https://github.com/tryfabric/martian) — paragraphs, headings, nested lists, code fences, blockquotes, dividers, GFM tables, inline formatting, links.
3. Prepends a "Mirrored from Knowledge Base" banner callout dated with the publish day.
4. Creates the page in the configured wiki database.
5. Writes `notion_mirror_url` + `notion_mirror_published_at` back into the note's frontmatter (atomically, preserving field order and formatting).

Bulk runs are **not** a single tool — list the unpublished notes, then call publish per note from the calling agent, pacing as you go. This keeps the MCP atomic.

## Tools

### `notion_mirror_note_status(kb_path)` — read

Report a note's mirror state from its frontmatter (no Notion call). Returns `{ kb_path, notion_source_url, notion_mirror_url, notion_mirror_published_at, status, next_run, next_run_with_force }` where `status` is `published` | `unpublished`, `next_run` is what `publish` would do with no force (`publish` | `skip`), and `next_run_with_force` is what it would do with `force:true` (`publish` | `republish`).

### `notion_mirror_unpublished_list(root?)` — read

List notes under `<root>/Pillars/` that have `notion_source_url` but no `notion_mirror_url` — drained from Notion but not yet mirrored back. `root` defaults to `MCP_NOTION_MIRROR_KB_ROOT`. Returns `{ root, count, notes: [path, ...], details: [{ path, source_url }, ...] }`.

### `notion_mirror_note_publish(kb_path, force?)` — write

Mirror one note and write the URL back into its frontmatter.

- `kb_path` (string) — the KB markdown note.
- `force` (boolean, default `false`) — re-publish even if already mirrored. Archives the old mirror page first, then creates a new one (the URL changes).

On publish returns `{ url, page_id, published_at }`. When already mirrored and `force` is false, returns `{ skipped: true, existing_url }` and leaves the note untouched.

### `notion_mirror_note_archive(kb_path, dry_run?)` — destructive

Archive the Notion page referenced by `notion_mirror_url` and clear the two mirror frontmatter fields.

- `kb_path` (string) — the KB markdown note.
- `dry_run` (boolean, default `true`) — when true, report what _would_ happen without calling Notion or editing the note.

Dry run returns `{ dry_run: true, would_archive_page_id, would_archive_url, would_clear_fields }`. A real run returns `{ archived: true, page_id, url }`. A note with no `notion_mirror_url` returns `{ archived: false, reason }`.

## Access levels

Tools are gated by `MCP_NOTION_MIRROR_ACCESS_LEVEL` (default `write`). Each level implies the lower ones:

| Level         | Tools registered                                              |
| ------------- | ------------------------------------------------------------- |
| `read`        | `notion_mirror_note_status`, `notion_mirror_unpublished_list` |
| `write`       | the above + `notion_mirror_note_publish`                      |
| `destructive` | the above + `notion_mirror_note_archive`                      |

Archive stays hidden until you explicitly opt in with `MCP_NOTION_MIRROR_ACCESS_LEVEL=destructive`.

## Setup

### 1. Create the Notion integration

1. <https://www.notion.so/my-integrations> → **New integration** (internal). Give it **Read content**, **Insert content**, and **Update content** capabilities.
2. Copy the **Internal Integration Secret** (`ntn_…`). Treat it like a password.
3. Open the target wiki page in Notion → **⋯** menu → **Connections** → add your integration. Without this connection the API returns `restricted_resource` / `403` even with a valid token.
4. The wiki **database id** is the 32-hex string in the database URL.

### 2. Build

```bash
bun install
bun run build
```

### 3. Wire into Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (or the Claude Code equivalent) — see [claude-config-sample.json](./claude-config-sample.json):

```json
{
  "mcpServers": {
    "mcp-notion-mirror": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-notion-mirror/dist/mcp-server/index.js"],
      "env": {
        "MCP_NOTION_MIRROR_TOKEN": "ntn_YOUR_INTEGRATION_SECRET",
        "MCP_NOTION_MIRROR_WIKI_DATABASE_ID": "36f9f7187cc280f69272e60aa89bff24",
        "MCP_NOTION_MIRROR_KB_ROOT": "/absolute/path/to/your/kb"
      }
    }
  }
}
```

Restart Claude.

## Environment variables

| Variable                                | Required | Default                                        | Purpose                                                                                                   |
| --------------------------------------- | -------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `MCP_NOTION_MIRROR_TOKEN`               | yes      | —                                              | Notion internal-integration secret (`ntn_…`). Needs Insert + Update content and a Connection to the wiki. |
| `MCP_NOTION_MIRROR_WIKI_DATABASE_ID`    | yes      | —                                              | Wiki database (data source) id new mirror pages are created in.                                           |
| `MCP_NOTION_MIRROR_KB_ROOT`             | no       | unset                                          | Absolute KB root containing `Pillars/`. When unset, `kb_path` args must be absolute.                      |
| `MCP_NOTION_MIRROR_ACCESS_LEVEL`        | no       | `write`                                        | `read` / `write` / `destructive`. `destructive` enables the archive tool.                                 |
| `MCP_NOTION_MIRROR_BANNER_TEXT`         | no       | KB default sentence                            | Override the banner's trailing sentence (the bold dated prefix is always kept).                           |
| `MCP_NOTION_MIRROR_API_BASE_URL`        | no       | `https://api.notion.com`                       | Notion API base URL.                                                                                      |
| `MCP_NOTION_MIRROR_AUDIT_LOG`           | no       | `writes`                                       | Audit-log scope. `off` / `writes` (non-read tool calls) / `all` (every invocation).                       |
| `MCP_NOTION_MIRROR_AUDIT_LOG_PATH`      | no       | `~/.local/state/mcp-notion-mirror/audit.jsonl` | Path to the JSONL audit log.                                                                              |
| `MCP_NOTION_MIRROR_AUDIT_LOG_MAX_BYTES` | no       | `10485760` (10 MiB)                            | Size-based rotation threshold in bytes. `0` disables rotation.                                            |
| `MCP_NOTION_MIRROR_AUDIT_LOG_KEEP`      | no       | `5`                                            | Number of rotated audit-log files to retain.                                                              |

The Notion token is never written to logs, error messages, or tool output.

## Running locally

```bash
bun run server:mcp:dev      # bun --watch, runs the server from TS source
bun run server:mcp:inspect  # MCP Inspector against the TS source
```

Both set `NODE_ENV=development`, so a local `.env.development` is auto-loaded.

## Frontmatter contract

Every publishable note has YAML frontmatter; this MCP only touches two fields and never reorders or reformats the rest:

```yaml
---
status: current — May 2026
purpose: <one-line>
notion_source_url: https://www.notion.so/<32hex>
notion_path: Product & Eng (Old) / Platform Architecture / …
notion_mirror_url: https://www.notion.so/<slug>-<32hex> # written by this MCP
notion_mirror_published_at: 2026-05-30T01:13:00Z # written by this MCP, ISO-8601 UTC
notion_last_seen_at: 2026-04-08T00:00:00Z
captured_at: 2026-05-29T00:00:00Z
notion_action: keep
---
```

New fields are inserted right after `notion_path` (falling back to `notion_source_url_secondary` / `notion_source_url`). A note with no frontmatter is an error — the MCP never invents one.

## Known gaps

See [ROADMAP.md](./ROADMAP.md): local images render as their alt-text path (not uploaded), `[[wikilinks]]` pass through as literal text, and re-publishing changes the mirror URL.
