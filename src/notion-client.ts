/**
 * Minimal HTTP client for the Notion API. Every Notion call in this MCP goes
 * through here — no tool builds a raw `fetch`. This module owns the Bearer
 * header, the `Notion-Version` header, the JSON content type, and the
 * API-error → typed-error translation.
 *
 * Security: the token is read from config and attached as the Bearer header
 * only. It is NEVER interpolated into an error message, log line, or tool
 * output — NotionApiError carries the response status/code/body, none of which
 * contains the secret.
 */
import { NOTION_API_BASE_URL, NOTION_API_VERSION, NOTION_TOKEN } from './config.js'

/** Notion's hard cap on `children` per page-create / block-append request. */
const MAX_CHILDREN_PER_REQUEST = 100

export class NotionApiError extends Error {
  status: number
  code: string | undefined
  body: string
  constructor(status: number, body: string, code: string | undefined, message: string) {
    super(message)
    this.name = 'NotionApiError'
    this.status = status
    this.body = body
    this.code = code
  }
}

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': NOTION_API_VERSION,
  Accept: 'application/json',
  'Content-Type': 'application/json'
})

const request = async <T>(method: 'GET' | 'POST' | 'PATCH', apiPath: string, body?: unknown): Promise<T> => {
  const resp = await fetch(`${NOTION_API_BASE_URL}${apiPath}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await resp.text()
  if (!resp.ok) {
    let code: string | undefined
    let detail = text
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string }
      code = parsed.code
      if (parsed.message) detail = parsed.message
    } catch {
      // non-JSON error body — fall back to the raw text
    }
    const snippet = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail
    throw new NotionApiError(resp.status, text, code, `Notion ${method} ${apiPath} → HTTP ${resp.status}${code ? ` (${code})` : ''}: ${snippet}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new NotionApiError(resp.status, text, undefined, `Notion ${method} ${apiPath} returned a non-JSON body (HTTP ${resp.status})`)
  }
}

const PAGE_ID_RE = /^[a-f0-9]{32}$/

/** Validate a 32-hex page id before it is substituted into an API path. */
export const assertPageId = (pageId: string): string => {
  if (!PAGE_ID_RE.test(pageId)) {
    throw new NotionApiError(0, '', 'invalid_page_id', `Refusing to call Notion with a malformed page id: "${pageId}" (expected 32 hex chars)`)
  }
  return pageId
}

/** Pull the 32-hex page id out of a notion.so URL (handles slug + query suffixes). */
export const extractPageIdFromUrl = (url: string): string | undefined => {
  const m = url.match(/([a-f0-9]{32})(?:$|\?|#)/)
  return m ? m[1] : undefined
}

/** Notion's `created_time` is RFC-3339 with millis (`…00.000Z`); the KB wants `…00Z`. */
export const normalizePublishedAt = (createdTime: string): string => createdTime.replace(/\.\d{3}Z$/, 'Z')

interface NotionDatabase {
  properties: Record<string, { id: string; type: string }>
}

const titlePropertyCache = new Map<string, string>()

/**
 * Discover (and cache) the name of the title-typed property on a database.
 * The HNR wiki names it "Page", but that varies per wiki, so we read the
 * schema rather than hard-coding it.
 */
export const getDatabaseTitleProperty = async (databaseId: string): Promise<string> => {
  const cached = titlePropertyCache.get(databaseId)
  if (cached !== undefined) return cached
  const db = await request<NotionDatabase>('GET', `/v1/databases/${assertPageId(databaseId)}`)
  const entry = Object.entries(db.properties).find(([, prop]) => prop.type === 'title')
  if (!entry) {
    throw new NotionApiError(0, '', 'no_title_property', `Database ${databaseId} has no title property — cannot set a page title.`)
  }
  titlePropertyCache.set(databaseId, entry[0])
  return entry[0]
}

/** Test-only: clear the title-property cache between cases. */
export const _clearTitlePropertyCache = (): void => titlePropertyCache.clear()

interface NotionPage {
  id: string
  url: string
  created_time: string
}

export interface CreatedPage {
  id: string
  url: string
  created_time: string
}

/**
 * Create a mirror page in the wiki database. Notion caps `children` at 100 per
 * request, so the first 100 blocks go in the create call and any remainder is
 * appended in 100-block batches via PATCH /v1/blocks/{id}/children.
 */
export const createMirrorPage = async (params: { databaseId: string; titleProperty: string; title: string; children: unknown[] }): Promise<CreatedPage> => {
  const { databaseId, titleProperty, title, children } = params
  const head = children.slice(0, MAX_CHILDREN_PER_REQUEST)
  const page = await request<NotionPage>('POST', '/v1/pages', {
    parent: { type: 'database_id', database_id: assertPageId(databaseId) },
    properties: { [titleProperty]: { title: [{ text: { content: title } }] } },
    children: head
  })
  for (let i = MAX_CHILDREN_PER_REQUEST; i < children.length; i += MAX_CHILDREN_PER_REQUEST) {
    await request('PATCH', `/v1/blocks/${assertPageId(page.id.replace(/-/g, ''))}/children`, {
      children: children.slice(i, i + MAX_CHILDREN_PER_REQUEST)
    })
  }
  return { id: page.id, url: page.url, created_time: page.created_time }
}

/** Archive (soft-delete) a page. Idempotent — archiving an archived page is a no-op success. */
export const archivePage = async (pageId: string): Promise<void> => {
  await request('PATCH', `/v1/pages/${assertPageId(pageId)}`, { archived: true })
}
