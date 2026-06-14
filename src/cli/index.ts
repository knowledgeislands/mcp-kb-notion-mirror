/**
 * Public library surface, mirroring the resource modules under src/main:
 *   - note verbs  (main/notes)   — get/status/preflight/touch/update/move/delete
 *   - tree verbs  (main/trees)   — statusTree/preflightTree/touchTree/updateTree/deleteTree
 *   - roots       (main/roots)   — listRoots/discoverRoots
 * plus the walk settings and the discover/order/resolve primitives.
 *
 * The CLI in `./cli.ts` is consumed as the `mcp-kb-notion-mirror-publish` bin,
 * not via this module.
 */

export type { MirrorSettings } from '../config/index.js'
export { loadMirrorSettings } from '../config/index.js'
export * from '../main/notes/index.js'
export * from '../main/roots/index.js'
export type { Note } from '../main/trees/discover.js'
export { buildLinkMap, discover, iconFor, indexKbPathFor, publishOrder, resolveParent } from '../main/trees/discover.js'
export * from '../main/trees/index.js'
