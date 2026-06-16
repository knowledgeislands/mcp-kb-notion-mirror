# CLAUDE.md

Guidance for Claude Code when working in this repo. The user-facing tool surface, install/config, and Claude Desktop setup live in
[README.md](./README.md); this file covers what Claude needs that isn't in README and isn't derivable from one grep.

Targets the MCP specification **2025-11-25** (the workspace MCP standard's tracked release). Tool-result, error-envelope, and metadata
behaviour conform to that revision.

## What this MCP does

Mirrors KB markdown notes into Notion and writes the resulting page URL back into each note's frontmatter. Three resources of tools, all
wire-prefixed `kb_notion_mirror_`:

- **`note`** (`kb_notion_mirror_note_*`) — act on one `kb_path` under a caller-supplied Notion `parent`. File-aware but layout-agnostic: no
  directory walking, no parent resolution.
- **`tree`** (`kb_notion_mirror_tree_*`) — walk a caller-supplied `subtree` folder under `cfg.kbRoot`, apply the folder-index hierarchy
  convention, and attach the subtree-root under a caller-supplied `parent`. Built on the note verbs.
- **`roots`** (`kb_notion_mirror_roots_list`) — pure discovery of folders declared as mirror roots (`kb_notion_mirror_root` frontmatter) →
  `[{ subtree, parent }]`. The client (or CLI) drives the `tree` verbs per root; the server never does a frontmatter-driven batch mutation.

There is **no fixed root folder and no fixed wiki database**. The `subtree`/`kb_path` and `parent` are supplied per call (tool args / CLI
flags); `roots` reads parents from `kb_notion_mirror_root` frontmatter. The markdown→blocks step is delegated to `@tryfabric/martian`.

### The verb model (the core idea)

Verbs: `get` · `status` · `preflight` · `touch` · `update` · `move` · `delete`, plus the tree-only `prune`. `note` has all seven; `tree` has
all but `get`/`move`, and adds `prune`; `roots` has only `list`.

**Mirroring is two-phase — there is no `create`.** `touch` creates a body-less scaffold (title + icon + banner + the page's place in the
child-pages hierarchy) so the page URL becomes known; `update` then pushes the body and resolves `[[wikilinks]]` into `@`mentions, and
**requires a prior touch** (it throws otherwise). This guarantees every link target exists before any body renders, so the order is always
touch-all → update-all. `tree_update` accepts an optional `link_map` so the CLI can resolve cross-root mentions with one map spanning every
root. Two verbs default to `dry_run: true` — `delete` (archiving breaks inbound `@`mentions) and the git-driven `tree_prune` (it archives
pages whose backing note was deleted) — so both preview by default and only mutate when `dry_run` is explicitly `false`.

## Bun vs Node

This project uses Bun (≥ 1.3) for install and dev scripts, but the compiled `dist/` runs under Node (≥ 22) — that's what Claude Desktop
launches.

- `bun run test` (NOT `bun test` — the latter invokes Bun's own runner instead of vitest).
- Bun auto-loads `.env.${NODE_ENV}` from the CWD; Node needs the explicit `process.loadEnvFile()` call inside `loadConfig()` in
  [src/config/index.ts](./src/config/index.ts). The try/catch swallows the `TypeError` Bun raises (no `process.loadEnvFile`), so the same
  code works under both.
- `NODE_ENV` is set to `development` only by `server:mcp:dev` and `server:mcp:inspect`. Claude Desktop doesn't set it, so `.env.*` is
  ignored in production — `MCP_KB_NOTION_MIRROR_TOKEN` must come from the Claude Desktop config `env` block.

Run `bun run` with no args for the full script list.

## Architecture Invariants

### Project layout & config injection (the workspace MCP shape)

- **[src/config/index.ts](./src/config/index.ts)** — `loadConfig(env?) → Config`. Reads env (optionally hydrated from `.env.${NODE_ENV}`)
  into a plain `Config` value. **There is no module-level config singleton — nothing reads env at import time, and `config/` is the only
  place env is read.** The mirror-walk knobs (`MCP_KB_NOTION_MIRROR_SKIP_*` / `…_ICON_BASE_URL`) parse here too, folded into
  `Config.mirror: MirrorSettings`; `loadMirrorSettings(env?)` is exported so the CLI's local-only verbs can read just that slice without
  requiring the token. `main/` takes the parsed slice as an argument — it never reads env itself. `notionApiBaseUrl` is validated as an
  `https:` URL (non-HTTPS / unparseable is rejected — SSRF / plaintext-downgrade discipline, since the Notion token rides as a Bearer
  header).
- **[src/mcp-server/index.ts](./src/mcp-server/index.ts)** — the stdio MCP wrapper. Calls `loadConfig()` once, wires the access gate, and
  threads the `Config` into `registerNoteTools` → `registerTreeTools` → `registerRootsTools`. Excluded from coverage.
- **[src/tools/](./src/tools/)** — MCP tool definitions only, one dir per resource (`note`, `tree`, `roots`). Thin: validate args (zod),
  confine paths, call a `main/`-or-`cli/` function, map result/throw to an MCP envelope via `jsonResult`/`errorResult`.
  `src/tools/**/index.ts` is excluded from coverage — never put logic there.
- **[src/main/](./src/main/)** — the implementation, mirroring the resources: `main/notes/` (the seven note verbs + banner, footer,
  wikilinks, markdown, frontmatter, title-property, and the `read.ts` reader split), `main/trees/` (walk/order/resolve in `discover.ts`, the
  tree verbs in `index.ts`, the git-driven `prune.ts`; `settings.ts` now just re-exports the `MirrorSettings` type — its env reader moved to
  `config/`), `main/roots/` (pruned discovery → `listRoots`), `main/notion-client/` (the HTTP layer). Every entry point takes `Config` (or
  its needed slice — e.g. the `MirrorSettings` walk slice) as its first argument.
- **[src/cli/](./src/cli/)** — the operator surface (renamed from `orchestrator` for the common `main`/`cli` shape). `cli.ts` is the
  `mcp-kb-notion-mirror-publish` bin — a `<resource> <verb>` dispatcher that does all human-readable printing; coverage-excluded. `index.ts`
  is the library barrel re-exporting `main/{notes,trees,roots}` + settings.
- **[src/utils/](./src/utils/)** — cross-MCP helpers taking the specific config primitive they need (`resolveKbNotePath(kbRoot, kbPath)`,
  `withAuditLog(auditConfig, …)`, `makeAccessGatedRegister(server, accessLevel, audit)`). `notion-args.ts` holds the shared
  `parentArg`/`notionId` zod schemas; it and `annotations.ts` are pure data and coverage-excluded.

The reader split in [src/main/notes/read.ts](./src/main/notes/read.ts) is deliberate: `readNoteFrontmatter` (cheap, used by
touch/get/move/delete/status/preflight and the walks) vs `readFullNote` (adds the stripped body — only `update` runs the expensive
markdown→blocks pipeline).

### Reading nothing to stdout

The MCP speaks JSON-RPC over stdout, so nothing reachable from a tool may write to stdout. `main/trees` and `main/roots` **return**
structured data and never log; the only `console.*` lives in `cli.ts` (not a tool) and in `main/notes/index.ts`'s footer-refresh path which
uses `console.error` (stderr). `main/trees/index.test.ts` asserts the tree layer makes no `console.log`/`console.error` calls. Keep it that
way.

### The folder-index convention (main/trees/discover.ts)

`resolveParent(n, subtree, rootParent, urlByKbPath)`:

- index note (`base === parentFolder`): if its folder `=== subtree` → `rootParent`; else look up the index of the **grandparent** folder in
  `urlByKbPath` → `page_id` parent (throws if missing/bad URL).
- leaf note: look up the index of its folder → `page_id` parent.

`publishOrder` is DFS preorder (index first, then leaves alphabetically, then sub-folders). The tree verbs walk this order;
`touchTree`/`updateTree`/`deleteTree` take an optional `kbPath` to restrict to one note's ancestor chain (so an unmirrored ancestor is
scaffolded first). `loadNote`/`isExcluded`/`isEligible` are exported from `discover.ts` so `main/roots` reuses them.

### Roots discovery & pruning (main/roots/index.ts)

`discoverRoots` walks directories and, on finding a folder index that declares `kb_notion_mirror_root`, records it and **does not descend**
— a root cannot nest a root. It also prunes branches that can't yield a mirrorable root (an excluded / skip-listed index, or an index-less
skip-prefixed folder). Because the model whitelists (only notes under a declared root are mirrored), pruning outside a root is purely a
search optimisation. The all-roots _publish_ flow is CLI-only (`cli.ts` `runRoots`), built on `listRoots` + per-tree verbs + one cross-root
link map — never a server tool.

### Naming convention

Tool names follow `<app>_<resource>_<action>` (snake*case) with `<app>` = the repo-derived `kb_notion_mirror` (strip `mcp-` from the package
name). This is the rule across the sibling MCPs — the tool prefix, frontmatter prefix
(`kb_notion_mirror*_`), and env prefix (`MCP*KB_NOTION_MIRROR*_`) all share the `kb_notion_mirror` stem. Plural resource for collection ops,
singular for single-item ops. Surface (14 tools):

- `note` (single-item): `kb_notion_mirror_note_{get,status,preflight,touch,update,move,delete}` —
  [src/tools/note/index.ts](./src/tools/note/index.ts).
- `tree` (single subtree): `kb_notion_mirror_tree_{status,preflight,touch,update,delete,prune}` —
  [src/tools/tree/index.ts](./src/tools/tree/index.ts).
- `roots` (collection): `kb_notion_mirror_roots_list` — [src/tools/roots/index.ts](./src/tools/roots/index.ts).

### Access-level gate — driven by annotations, not names

[src/utils/access-level.ts](./src/utils/access-level.ts) `makeAccessGatedRegister(server, accessLevel, audit)` derives each tool's level
from `config.annotations`: `readOnlyHint:true → read`; `destructiveHint:true → destructive`; both explicitly `false → write`; anything else
→ `destructive` (fail-safe). A tool registers when its derived level is ≤ `cfg.accessLevel` (**default `write`**). Presets in
[src/utils/annotations.ts](./src/utils/annotations.ts): `READ_ONLY_REMOTE` (get/status/preflight/roots_list), `WRITE_REMOTE_IDEMPOTENT`
(touch/update/move — all reach an idempotent end state), `DESTRUCTIVE_REMOTE` (delete and tree_prune; both default to dry-run).
`WRITE_REMOTE` (non-idempotent) is kept for completeness. Every tool is open-world (it calls Notion). New tools MUST set `annotations` to
one of those presets.

### `move`/`update` and the cross-parent-type silent failure

`PATCH /v1/pages` silently ignores a parent change crossing the page-id ↔ database-id boundary. `moveNote` and `updateNote` detect it by
GETting the parent before, PATCHing, and — only when the parent type changed — re-GETting and erroring if unchanged. Keep this guard.

### Frontmatter is edited by line surgery, NOT a YAML round-trip

[src/main/notes/frontmatter.ts](./src/main/notes/frontmatter.ts) regex-matches the leading block and edits per-line. A YAML library would
reorder keys and rewrite escaping, corrupting the KB's strict field-order rules. Exact-string round-trip tests guard this — keep them green.
The server writes back only `kb_notion_mirror_url` / `kb_notion_mirror_published_at` (`published_at` is set at `touch` — the name is kept
for back-compat with frontmatter already in the KB).

## Security Requirements

This server holds a Notion token, reads user-supplied paths, and writes back to KB notes. New tools and changes MUST preserve every
invariant:

1. **The token never leaves the process unredacted.** Read in [src/config/index.ts](./src/config/index.ts), attached as the Bearer header in
   [src/main/notion-client/index.ts](./src/main/notion-client/index.ts) only. `NotionApiError` carries status/code/body — never the token.
2. **Every `kb_path` and `subtree` runs through [src/utils/paths.ts](./src/utils/paths.ts) before any `fs.*` call.**
   `resolveKbNotePath(cfg.kbRoot, p)` — lexical (`..` rejected; confined under `kbRoot` when set) plus realpath of the deepest existing
   ancestor (catches symlink escapes). The note verbs resolve via `read.ts`; the tree tools confine BOTH `subtree` and `kb_path` before
   walking. Schemas also reject `..` at the zod layer.
3. **Notion ids are validated before substitution into an API path** via `normalizeId()`. `extractPageIdFromUrl()` pulls the id out of
   `kb_notion_mirror_url`; a malformed URL errors before any call.
4. **The destructive verb defaults to `dry_run: true`.** `note_delete` and `tree_delete` only mutate when `dry_run` is explicitly `false`.
   The `destructive` access level is opt-in.
5. **Frontmatter write-backs are atomic** via `atomicWriteFile()`.
6. **Zod schemas are `.strict()` with bounded sizes.** `kb_path` / `subtree` cap at 4096 chars; `parent` ids are regex-validated (32-hex or
   dashed UUID) via the shared `parentArg` in [src/utils/notion-args.ts](./src/utils/notion-args.ts).
7. **Errors return via `errorResult(...)`, not `throw`** at the tool boundary. `main`/`cli` functions throw; the handler catches and maps.
   The audit-log wrapper depends on the `isError` envelope.
8. **Nothing reachable from a tool writes to stdout.** See [the stdout invariant](#reading-nothing-to-stdout) above.

## Testing

- `bun run test:coverage` enforces 100% line/branch/function/statement coverage. Excluded: `src/mcp-server/index.ts`,
  `src/tools/**/index.ts`, `src/cli/cli.ts` (entry points / wiring), and the pure-data `src/utils/annotations.ts` +
  `src/utils/notion-args.ts`. Everything else — including `main/trees` and `main/roots` — stays fully covered. Tests are co-located.
- **Test fixtures use a synthetic Greek scheme** (`Alpha`/`Beta`/`Gamma`, roots `Alpha`/`Omega`) — never real KB or repo names. New tests
  must follow this.
- Real Notion API calls are out of tests — the client is exercised through `fetch` mocks (`vi.stubGlobal('fetch', …)`).
  `main/trees/index.test.ts` uses a small stateful fetch stub (records each created page's parent so the cross-parent-type guard doesn't
  false-fire).
- Config is injected, so tests build a `Config`/`MirrorSettings` literal and pass it. A couple of modules keep process-lifetime caches
  (title-property cache, audit-log append queue) — their tests use the exported reset hook.
- `bun run test:smoke` boots the built server over stdio and asserts the 14-tool wire surface. Keep `scripts/smoke.ts` `EXPECTED_TOOLS` in
  sync with the three registration sites.

## Tool registration call sites

Tools are registered in [src/tools/note/index.ts](./src/tools/note/index.ts), [src/tools/tree/index.ts](./src/tools/tree/index.ts), and
[src/tools/roots/index.ts](./src/tools/roots/index.ts). To survey the surface, `grep -r "registerTool" src/tools`. README's
[Tools](./README.md#tools) section tabulates all 14 with purposes and I/O shapes.
