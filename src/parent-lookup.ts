/**
 * On-disk resolution of a KB note's Notion parent: applies the pure rule from
 * `parent-resolver.ts`, then reads the parent index note's frontmatter to find
 * its `notion_mirror_url` and extract the page id. Returns a discriminated
 * result the publish / move / status tools map to a Notion parent object, an
 * `errorResult`, or a status field — keeping the fs concern out of the pure
 * resolver and out of the tool aggregator.
 */
import * as fs from 'node:fs/promises'
import { parseFrontmatter } from './frontmatter.js'
import { extractPageIdFromUrl } from './notion-client.js'
import { deriveParent } from './parent-resolver.js'

export type ParentTarget =
  | { kind: 'database-root' }
  | { kind: 'page'; parentKbPath: string; pageId: string; mirrorUrl: string }
  | { kind: 'missing-index'; parentKbPath: string }
  | { kind: 'parent-unpublished'; parentKbPath: string }
  | { kind: 'malformed-parent-url'; parentKbPath: string; mirrorUrl: string }

export const resolveParentTarget = async (noteAbsPath: string, pillarsRootAbsPath: string): Promise<ParentTarget> => {
  const parent = deriveParent(noteAbsPath, pillarsRootAbsPath)
  if (parent.type === 'database-root') return { kind: 'database-root' }

  const parentKbPath = parent.parentKbPath
  let raw: string
  try {
    raw = await fs.readFile(parentKbPath, 'utf-8')
  } catch {
    return { kind: 'missing-index', parentKbPath }
  }

  const mirrorUrl = parseFrontmatter(raw).fields.notion_mirror_url
  if (!mirrorUrl) return { kind: 'parent-unpublished', parentKbPath }

  const pageId = extractPageIdFromUrl(mirrorUrl)
  if (!pageId) return { kind: 'malformed-parent-url', parentKbPath, mirrorUrl }

  return { kind: 'page', parentKbPath, pageId, mirrorUrl }
}
