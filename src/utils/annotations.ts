/**
 * MCP tool annotations shared across tool groups.
 *
 * Naming convention: unsuffixed presets are closed-world (the tool acts only on
 * local state); `_REMOTE` suffix marks open-world (calls external APIs).
 *
 * Underlying MCP hints:
 *   readOnlyHint    — tool does NOT modify state
 *   destructiveHint — tool deletes/destroys state
 *   idempotentHint  — same input → same end state
 *   openWorldHint   — interacts with services outside the local environment
 *
 * This MCP's surface (every tool calls the Notion API → all open-world):
 *   - kb_notion_mirror_*_get / _status / _preflight read → READ_ONLY_REMOTE.
 *   - kb_notion_mirror_*_touch / _update / _move reach an idempotent end state
 *     (touch skips an already-mirrored note; update replaces in place; move
 *     re-parents to a fixed target) → WRITE_REMOTE_IDEMPOTENT.
 *   - kb_notion_mirror_*_delete archives a Notion page (idempotent end state)
 *     and clears frontmatter → DESTRUCTIVE_REMOTE.
 *
 * The access-level gate keys off readOnlyHint/destructiveHint only:
 *   readOnlyHint:true → read · destructiveHint:true → destructive ·
 *   both false → write.
 */
export const READ_ONLY_REMOTE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const

export const WRITE_REMOTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const

export const WRITE_REMOTE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const

export const DESTRUCTIVE_REMOTE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const
