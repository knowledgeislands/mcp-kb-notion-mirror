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
 * Canonical preset set across the sibling MCPs (each repo exports the subset
 * its tools need). Unmarked names are the defaults at each tier; suffixes flag
 * deviations (`_IDEMPOTENT` = retry-safe write; `_ONESHOT` = non-idempotent
 * destructive):
 *   READ_ONLY               — closed-world read
 *   READ_ONLY_REMOTE        — open-world read
 *   WRITE                   — closed-world non-destructive mutation (non-idempotent — create-new, rename)
 *   WRITE_REMOTE            — open-world non-destructive mutation (non-idempotent)
 *   WRITE_IDEMPOTENT        — closed-world non-destructive mutation, retry-safe (mkdir -p, set-status)
 *   WRITE_IDEMPOTENT_REMOTE — open-world retry-safe mutation
 *   DESTRUCTIVE             — closed-world destructive (idempotent end state)
 *   DESTRUCTIVE_REMOTE      — open-world destructive (idempotent end state)
 *   DESTRUCTIVE_ONESHOT     — closed-world destructive, NON-idempotent
 *                             (effect depends on current state — e.g. prune)
 *
 * This MCP's surface:
 *   - notion_mirror_note_status / notion_mirror_unpublished_list read only KB
 *     files on disk → READ_ONLY.
 *   - notion_mirror_note_publish creates a new Notion page each force run
 *     (non-idempotent) and writes back to the KB note → WRITE_REMOTE.
 *   - notion_mirror_note_archive archives a Notion page (idempotent end state)
 *     and clears two frontmatter fields → DESTRUCTIVE_REMOTE.
 */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

export const WRITE_REMOTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const

export const DESTRUCTIVE_REMOTE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const
