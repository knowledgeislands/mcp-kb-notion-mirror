/**
 * KB path validation. Every `kb_path` (and the `root` argument of the
 * unpublished-list tool) runs through here before any `fs.*` call.
 *
 * Two-layer guard, matching the sibling MCPs:
 *   1. Lexical — reject `..` segments and (when KB_ROOT is set) confine the
 *      normalized path under `<KB_ROOT>/Pillars/`.
 *   2. Realpath — resolve the deepest existing ancestor with `fs.realpathSync`
 *      and re-check confinement, catching symlink escapes that survive the
 *      lexical check.
 *
 * When KB_ROOT is unset, relative paths are rejected (the MCP can't anchor
 * them) and absolute paths are accepted after the `..` check — there is no
 * Pillars confinement because there is no root to confine against.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { KB_ROOT } from '../config.js'

export class KbPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KbPathError'
  }
}

const PILLARS = 'Pillars'

const hasParentSegment = (p: string): boolean => p.split(/[\\/]/).includes('..')

/** realpath the deepest existing ancestor of `p`, re-joining the missing tail. */
const realpathDeepestExisting = (p: string): string => {
  let prefix = p
  const tail: string[] = []
  while (true) {
    try {
      return path.join(fs.realpathSync(prefix), ...tail.reverse())
    } catch {
      const parent = path.dirname(prefix)
      /* v8 ignore next — path.dirname stabilises at '/' which always realpaths, so the root is never missing */
      if (parent === prefix) return p
      tail.push(path.basename(prefix))
      prefix = parent
    }
  }
}

const assertWithin = (root: string, candidate: string): void => {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new KbPathError(`Path escapes the allowed KB root: ${candidate} is not under ${root}`)
  }
}

/**
 * Resolve and validate a single KB note path. Returns the realpath of the note
 * (the note itself need not exist yet, but its directory chain is realpath-ed).
 */
export const resolveKbNotePath = (kbPath: string): string => {
  if (kbPath.trim() === '') throw new KbPathError('kb_path must not be empty')
  if (hasParentSegment(kbPath)) throw new KbPathError(`kb_path must not contain ".." segments: ${kbPath}`)

  let resolved: string
  if (path.isAbsolute(kbPath)) {
    resolved = path.normalize(kbPath)
  } else {
    if (KB_ROOT === undefined) {
      throw new KbPathError('kb_path is relative but MCP_NOTION_MIRROR_KB_ROOT is not set. Pass an absolute path or set the KB root.')
    }
    resolved = path.resolve(KB_ROOT, kbPath)
  }

  if (KB_ROOT !== undefined) {
    const pillarsRoot = path.join(KB_ROOT, PILLARS)
    assertWithin(pillarsRoot, resolved)
    const real = realpathDeepestExisting(resolved)
    assertWithin(realpathDeepestExisting(pillarsRoot), real)
    return real
  }
  return realpathDeepestExisting(resolved)
}

/**
 * Resolve and validate the KB root for a tree walk. `root` defaults to KB_ROOT.
 * Returns `<root>/Pillars` (realpath-ed) — the directory the walker descends.
 */
export const resolvePillarsRoot = (root?: string): string => {
  const base = root ?? KB_ROOT
  if (base === undefined || base.trim() === '') {
    throw new KbPathError('No KB root given and MCP_NOTION_MIRROR_KB_ROOT is not set. Pass an absolute `root` or set the KB root.')
  }
  if (hasParentSegment(base)) throw new KbPathError(`root must not contain ".." segments: ${base}`)
  if (!path.isAbsolute(base)) throw new KbPathError(`root must be an absolute path: ${base}`)
  const resolved = path.normalize(base)
  if (KB_ROOT !== undefined) assertWithin(KB_ROOT, resolved)
  return realpathDeepestExisting(path.join(resolved, PILLARS))
}
