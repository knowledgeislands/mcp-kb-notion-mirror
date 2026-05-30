# Security Policy

## Reporting a Vulnerability

If you find a security issue in `@knowledgeislands/mcp-notion-mirror`, **please do not file a public GitHub issue.** Instead, email the maintainer directly:

- **<kris@kris.me.uk>** — subject: `mcp-notion-mirror security`

Include:

- A description of the issue and the impact (e.g. "token leaks into stdout/audit log", "kb_path bypasses the Pillars confinement", "page id injection into an API path").
- Steps to reproduce, ideally with a minimal proof-of-concept that does not require a real Notion workspace.
- The version of the package (`npm ls @knowledgeislands/mcp-notion-mirror`) and Node version.

You should expect an acknowledgement within 72 hours. We aim to triage, investigate, and ship a fix within 14 days for high-severity issues.

## Scope

`mcp-notion-mirror` is a stdio MCP server that holds a Notion internal-integration secret in `MCP_NOTION_MIRROR_TOKEN`, walks a user-supplied KB filesystem tree, creates pages in a Notion wiki, and writes back to local KB notes. It runs locally with the privileges of the user who launched it. The security boundary is the token (full read/insert/update access to every page the integration is connected to) and the local filesystem under `MCP_NOTION_MIRROR_KB_ROOT`.

The invariants below are enforced in code and covered by tests.

1. **The token never leaves the process unredacted.** It is read in `src/config.ts` and attached only as the `Authorization: Bearer …` header in `src/notion-client.ts`. It is never included in error messages, the audit-log payload (which records tool args only), or tool output. `NotionApiError` carries the response status/code/body, none of which contains the secret.
2. **`kb_path` / `root` inputs are path-traversal-guarded.** `src/utils/paths.ts` rejects `..` segments lexically, confines resolved paths under `<MCP_NOTION_MIRROR_KB_ROOT>/Pillars/`, and re-checks the `fs.realpath` of the deepest existing ancestor to catch symlink escapes. The zod schemas in `src/tools/notes/index.ts` additionally reject `..` before the runtime guard runs. When `KB_ROOT` is unset, relative paths are rejected and absolute paths are accepted only after the `..` check.
3. **Page UUIDs from frontmatter are regex-validated (`^[a-f0-9]{32}$`) before being substituted into an API path.** `assertPageId()` in `src/notion-client.ts` rejects anything else, so a malformed `notion_mirror_url` cannot smuggle a path segment into a Notion request.
4. **Destructive tools require `dry_run: true` by default.** `notion_mirror_note_archive` defaults to a dry run: it neither calls Notion nor edits the note unless `dry_run` is explicitly `false`. The `destructive` access level is opt-in via `MCP_NOTION_MIRROR_ACCESS_LEVEL`.
5. **Frontmatter write-backs are atomic.** `src/utils/atomic-write.ts` writes a temp file then renames over the target, so a crash mid-write cannot leave a KB note half-rewritten.
6. **Zod schemas are `.strict()` with bounded sizes.** `kb_path` / `root` cap at 4096 chars; titles are bounded by Notion's own limits via `@tryfabric/martian`'s truncation.

Out of scope:

- Issues only reproducible against a forked or modified version.
- Vulnerabilities in the Notion API itself (report those to Notion).
- Issues requiring local OS-level access already higher-privileged than the user running the MCP (e.g. an attacker who can already read process env).
- Storing the token in a Claude Desktop config file at the user's choice — this is the documented setup pattern; harden the file ACLs locally if your threat model warrants it.

## Supported Versions

Only the latest published `0.x` release receives security fixes during the pre-1.0 window. Once `1.0` lands, the same policy as the sibling MCPs applies.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |
