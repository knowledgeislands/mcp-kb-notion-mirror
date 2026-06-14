/**
 * Mirror walk settings — the small KB-specific knobs the tree/roots walks need
 * in addition to the per-call Config that the note verbs already take.
 *
 * These are layout-agnostic: there is NO fixed root folder and NO fixed wiki
 * parent. The subtree to walk and the Notion parent its root attaches under are
 * supplied per operation (tool args / CLI flags), not via env. Settings only
 * carry the exclusion + icon knobs that apply uniformly across every subtree.
 *
 * The settings are now parsed by `loadConfig` (config/index.ts) as the `mirror`
 * slice of `Config` — env is read ONLY there. This module just re-exports the
 * `MirrorSettings` shape so the walk modules keep their local import path; main/
 * receives the parsed slice as an argument and never reads env itself.
 */

export type { MirrorSettings } from '../../config/index.js'
