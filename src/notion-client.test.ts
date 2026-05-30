import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DB_ID = '36f9f7187cc280f69272e60aa89bff24'
const PAGE_HEX = '3709f7187cc2814e8652f99fd36857ff'
const PAGE_RESPONSE = { id: '3709f718-7cc2-814e-8652-f99fd36857ff', url: 'https://www.notion.so/Slug-3709f7187cc2814e8652f99fd36857ff', created_time: '2026-05-30T01:13:00.000Z' }

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('notion-client (mcp-notion-mirror)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    process.env.MCP_NOTION_MIRROR_TOKEN = 'ntn_secrettoken'
    process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID = DB_ID
    process.env.MCP_NOTION_MIRROR_API_BASE_URL = 'https://api.notion.test'
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { _clearTitlePropertyCache } = await import('./notion-client.js')
    _clearTitlePropertyCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.MCP_NOTION_MIRROR_API_BASE_URL
  })

  describe('getDatabaseTitleProperty', () => {
    it('sends Bearer + Notion-Version headers and returns the title property name', async () => {
      fetchMock.mockResolvedValueOnce(ok({ properties: { Tags: { id: 't', type: 'multi_select' }, Page: { id: 'p', type: 'title' } } }))
      const { getDatabaseTitleProperty } = await import('./notion-client.js')
      const name = await getDatabaseTitleProperty(DB_ID)
      expect(name).toBe('Page')
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe(`https://api.notion.test/v1/databases/${DB_ID}`)
      expect(init.headers).toMatchObject({ Authorization: 'Bearer ntn_secrettoken', 'Notion-Version': '2022-06-28', Accept: 'application/json', 'Content-Type': 'application/json' })
    })

    it('caches the lookup (second call issues no request)', async () => {
      fetchMock.mockResolvedValueOnce(ok({ properties: { Page: { id: 'p', type: 'title' } } }))
      const { getDatabaseTitleProperty } = await import('./notion-client.js')
      await getDatabaseTitleProperty(DB_ID)
      await getDatabaseTitleProperty(DB_ID)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('throws when the database has no title property', async () => {
      fetchMock.mockResolvedValueOnce(ok({ properties: { Tags: { id: 't', type: 'multi_select' } } }))
      const { getDatabaseTitleProperty } = await import('./notion-client.js')
      await expect(getDatabaseTitleProperty(DB_ID)).rejects.toThrow(/no title property/)
    })
  })

  describe('createMirrorPage', () => {
    it('creates a database-parented page with the named title property', async () => {
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE))
      const { createMirrorPage } = await import('./notion-client.js')
      const result = await createMirrorPage({ parent: { type: 'database_id', database_id: DB_ID }, titleProperty: 'Page', title: 'My Note', children: [{ a: 1 }, { b: 2 }] })
      expect(result).toEqual({ id: PAGE_RESPONSE.id, url: PAGE_RESPONSE.url, created_time: PAGE_RESPONSE.created_time })
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe('https://api.notion.test/v1/pages')
      const body = JSON.parse(init.body)
      expect(body.parent).toEqual({ type: 'database_id', database_id: DB_ID })
      expect(body.properties).toEqual({ Page: { title: [{ text: { content: 'My Note' } }] } })
      expect(body.children).toHaveLength(2)
    })

    it('creates a page-parented page with the reserved title property', async () => {
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE))
      const { createMirrorPage } = await import('./notion-client.js')
      await createMirrorPage({ parent: { type: 'page_id', page_id: PAGE_HEX }, title: 'Child', children: [{ a: 1 }] })
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body)
      expect(body.parent).toEqual({ type: 'page_id', page_id: PAGE_HEX })
      expect(body.properties).toEqual({ title: { title: [{ text: { content: 'Child' } }] } })
    })

    it('throws when a database parent is given without a title property name', async () => {
      const { createMirrorPage, NotionApiError } = await import('./notion-client.js')
      await expect(createMirrorPage({ parent: { type: 'database_id', database_id: DB_ID }, title: 'x', children: [] })).rejects.toThrow(NotionApiError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('appends children beyond the 100-block limit via PATCH /v1/blocks/{id}/children', async () => {
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE)) // create
      fetchMock.mockResolvedValueOnce(ok({})) // append batch
      const { createMirrorPage } = await import('./notion-client.js')
      const children = Array.from({ length: 150 }, (_, i) => ({ i }))
      await createMirrorPage({ parent: { type: 'database_id', database_id: DB_ID }, titleProperty: 'Page', title: 'Big', children })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [createInit, appendCall] = [JSON.parse(fetchMock.mock.calls[0]?.[1].body), fetchMock.mock.calls[1]]
      expect(createInit.children).toHaveLength(100)
      expect(appendCall?.[0]).toBe('https://api.notion.test/v1/blocks/3709f7187cc2814e8652f99fd36857ff/children')
      expect(appendCall?.[1].method).toBe('PATCH')
      expect(JSON.parse(appendCall?.[1].body).children).toHaveLength(50)
    })
  })

  describe('getPage / movePage', () => {
    it('getPage returns id/url and the raw parent object', async () => {
      fetchMock.mockResolvedValueOnce(ok({ id: PAGE_RESPONSE.id, url: PAGE_RESPONSE.url, parent: { type: 'database_id', database_id: DB_ID } }))
      const { getPage } = await import('./notion-client.js')
      const page = await getPage(PAGE_HEX)
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe(`https://api.notion.test/v1/pages/${PAGE_HEX}`)
      expect(init.method).toBe('GET')
      expect(page.parent).toEqual({ type: 'database_id', database_id: DB_ID })
    })

    it('getPage rejects a malformed page id before calling Notion', async () => {
      const { getPage, NotionApiError } = await import('./notion-client.js')
      await expect(getPage('not-hex')).rejects.toThrow(NotionApiError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('movePage PATCHes the page with the new parent', async () => {
      fetchMock.mockResolvedValueOnce(ok({}))
      const { movePage } = await import('./notion-client.js')
      await movePage(PAGE_HEX, { type: 'page_id', page_id: '0000000000000000000000000000abcd' })
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe(`https://api.notion.test/v1/pages/${PAGE_HEX}`)
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body)).toEqual({ parent: { type: 'page_id', page_id: '0000000000000000000000000000abcd' } })
    })
  })

  describe('archivePage', () => {
    it('PATCHes the page with archived:true', async () => {
      fetchMock.mockResolvedValueOnce(ok({}))
      const { archivePage } = await import('./notion-client.js')
      await archivePage('3709f7187cc2814e8652f99fd36857ff')
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe('https://api.notion.test/v1/pages/3709f7187cc2814e8652f99fd36857ff')
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body)).toEqual({ archived: true })
    })
  })

  describe('error translation', () => {
    it('throws NotionApiError with status + code + message, never leaking the token', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'unauthorized', message: 'API token is invalid.' }), { status: 401 }))
      const { archivePage, NotionApiError } = await import('./notion-client.js')
      const err = await archivePage('3709f7187cc2814e8652f99fd36857ff').catch((e) => e)
      expect(err).toBeInstanceOf(NotionApiError)
      expect(err.status).toBe(401)
      expect(err.code).toBe('unauthorized')
      expect(err.message).toContain('API token is invalid.')
      expect(err.message).not.toContain('ntn_secrettoken')
    })

    it('falls back to the raw text for a non-JSON error body', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
      const { archivePage } = await import('./notion-client.js')
      await expect(archivePage('3709f7187cc2814e8652f99fd36857ff')).rejects.toThrow(/HTTP 502: Bad Gateway/)
    })

    it('truncates very long error detail', async () => {
      fetchMock.mockResolvedValueOnce(new Response(`${'x'.repeat(600)}END`, { status: 500 }))
      const { archivePage } = await import('./notion-client.js')
      await expect(archivePage('3709f7187cc2814e8652f99fd36857ff')).rejects.toThrow(/HTTP 500:.*…/)
    })

    it('throws when a 2xx response body is not valid JSON', async () => {
      fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))
      const { getDatabaseTitleProperty } = await import('./notion-client.js')
      await expect(getDatabaseTitleProperty(DB_ID)).rejects.toThrow(/non-JSON body/)
    })
  })

  describe('pure helpers', () => {
    it('assertPageId accepts 32-hex and rejects everything else', async () => {
      const { assertPageId, NotionApiError } = await import('./notion-client.js')
      expect(assertPageId('3709f7187cc2814e8652f99fd36857ff')).toBe('3709f7187cc2814e8652f99fd36857ff')
      expect(() => assertPageId('nope')).toThrow(NotionApiError)
    })

    it('extractPageIdFromUrl pulls the 32-hex id out of a notion.so URL', async () => {
      const { extractPageIdFromUrl } = await import('./notion-client.js')
      expect(extractPageIdFromUrl('https://www.notion.so/Slug-3709f7187cc2814e8652f99fd36857ff')).toBe('3709f7187cc2814e8652f99fd36857ff')
      expect(extractPageIdFromUrl('https://www.notion.so/3709f7187cc2814e8652f99fd36857ff?pvs=4')).toBe('3709f7187cc2814e8652f99fd36857ff')
      expect(extractPageIdFromUrl('https://example.com/no-id-here')).toBeUndefined()
    })

    it('normalizePublishedAt trims sub-second precision', async () => {
      const { normalizePublishedAt } = await import('./notion-client.js')
      expect(normalizePublishedAt('2026-05-30T01:13:00.000Z')).toBe('2026-05-30T01:13:00Z')
      expect(normalizePublishedAt('2026-05-30T01:13:00Z')).toBe('2026-05-30T01:13:00Z')
    })
  })
})
