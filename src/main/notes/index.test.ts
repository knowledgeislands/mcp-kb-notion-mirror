/**
 * Tests for the note verbs — touch / update / delete / move / get / status /
 * preflight — against a real temp note + a mocked Notion `fetch`.
 *
 * Two-phase: touch creates a body-less scaffold (banner only); update pushes the
 * body and resolves wikilinks and REQUIRES a prior touch.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Config, DEFAULT_BANNER_TEMPLATE } from '../../config/index.js'
import { deleteNote, getNote, moveNote, preflightNote, statusNote, touchNote, updateNote } from './index.js'
import { _clearTitlePropertyCache } from './title-property.js'

const DB_ID = '36f9f7187cc280f69272e60aa89bff24'
const PAGE_HEX = '3709f7187cc2814e8652f99fd36857ff'
const OLD_PARENT = 'a'.repeat(32)
const MIRROR_URL = `https://www.notion.so/My-Note-${PAGE_HEX}`
const PAGE_RESPONSE = {
  id: '3709f718-7cc2-814e-8652-f99fd36857ff',
  url: MIRROR_URL,
  created_time: '2026-05-30T01:13:00.000Z',
  last_edited_time: '2026-05-30T02:00:00.000Z',
  archived: false,
  parent: { type: 'database_id', database_id: DB_ID },
  properties: { Page: { type: 'title', title: [{ plain_text: 'My Note' }] } }
}
const DB_RESPONSE = { properties: { Tags: { id: 't', type: 'multi_select' }, Page: { id: 'p', type: 'title' } } }

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const fail = (status: number) => new Response(JSON.stringify({ code: 'x', message: 'boom' }), { status })
const emptyChildren = () => ok({ results: [], has_more: false, next_cursor: null })

const FM = (extra = ''): string => `---\nstatus: current\nnotion_source_url: https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nnotion_path: A / B${extra}\n---\n# My Note\n\nBody paragraph.\n`

describe('note verbs', () => {
  let kbRoot: string
  let cfg: Config
  let fetchMock: ReturnType<typeof vi.fn>

  const writeNote = async (name: string, content: string): Promise<string> => {
    const abs = path.join(kbRoot, name)
    await fsp.writeFile(abs, content)
    return abs
  }

  // Routes the calls an `update` makes: GET page (before-parent snapshot), GET
  // database (title prop), PATCH page (updatePage), GET children (replaceBody +
  // footer), and PATCH/DELETE children. `pageParent` overrides the page's parent
  // in the GET/PATCH response — defaults to the database parent.
  const routeUpdate = (children: unknown[], pageParent?: Record<string, unknown>) => {
    const pageResp = pageParent ? { ...PAGE_RESPONSE, parent: pageParent } : PAGE_RESPONSE
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET'
      if (url.includes('/v1/databases/')) return ok(DB_RESPONSE)
      if (/\/v1\/pages\/[a-f0-9]+$/.test(url) && method === 'PATCH') return ok(pageResp)
      if (/\/v1\/pages\/[a-f0-9]+$/.test(url) && method === 'GET') return ok(pageResp)
      if (url.includes('/children') && method === 'GET') return ok({ results: children, has_more: false, next_cursor: null })
      return ok({ results: [{ id: 'x' }] })
    })
  }

  beforeEach(async () => {
    kbRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-kb-notion-mirror-notes-'))
    cfg = {
      notionToken: 'ntn_secrettoken',
      notionApiBaseUrl: 'https://api.notion.test',
      notionApiVersion: '2022-06-28',
      kbRoot,
      bannerTemplate: DEFAULT_BANNER_TEMPLATE,
      accessLevel: 'write',
      auditLogMode: 'off',
      auditLogPath: '',
      auditLogMaxBytes: 0,
      auditLogKeep: 0
    }
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    _clearTitlePropertyCache()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await fsp.rm(kbRoot, { recursive: true, force: true })
  })

  describe('touchNote', () => {
    it('scaffolds under a database parent: resolves the title prop, banner only (no body), writes back', async () => {
      const abs = await writeNote('My Note.md', FM())
      fetchMock.mockResolvedValueOnce(ok(DB_RESPONSE)) // GET database (title prop)
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE)) // POST page
      const result = await touchNote(cfg, abs, { type: 'database_id', database_id: DB_ID })
      expect(result).toEqual({ url: MIRROR_URL, page_id: PAGE_RESPONSE.id, published_at: '2026-05-30T01:13:00Z' })

      const postBody = JSON.parse(fetchMock.mock.calls[1]?.[1].body)
      expect(postBody.properties).toEqual({ Page: { title: [{ text: { content: 'My Note' } }] } })
      expect(postBody.children).toHaveLength(1)
      expect(postBody.children[0].type).toBe('callout') // banner only, no body
      const written = await fsp.readFile(abs, 'utf-8')
      expect(written).toContain(`kb_notion_mirror_url: ${MIRROR_URL}`)
      expect(written).toContain('kb_notion_mirror_published_at: 2026-05-30T01:13:00Z')
    })

    it('skips when already mirrored, making no Notion call', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      expect(await touchNote(cfg, abs, { type: 'database_id', database_id: DB_ID })).toEqual({ skipped: true, existing_url: MIRROR_URL })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('under a page parent uses the reserved title, makes no GET database call, and refreshes the footer', async () => {
      const abs = await writeNote('My Note.md', FM())
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE)) // POST
      fetchMock.mockResolvedValueOnce(ok({ results: [{ id: PAGE_HEX, type: 'child_page', child_page: { title: 'My Note' } }], has_more: false, next_cursor: null })) // footer GET
      fetchMock.mockResolvedValueOnce(ok({})) // footer PATCH append
      await touchNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body)
      expect(body.properties).toEqual({ title: { title: [{ text: { content: 'My Note' } }] } })
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/v1/databases/'))).toBe(false)
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`https://api.notion.test/v1/blocks/${PAGE_HEX}/children?page_size=100`)
    })

    it('passes a caller-supplied icon', async () => {
      const abs = await writeNote('My Note.md', FM())
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE)) // POST
      fetchMock.mockResolvedValueOnce(emptyChildren()) // footer
      await touchNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX }, { icon: { type: 'emoji', emoji: '📚' } })
      expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).icon).toEqual({ type: 'emoji', emoji: '📚' })
    })

    it('still succeeds when the parent footer refresh fails (failure is swallowed)', async () => {
      const abs = await writeNote('My Note.md', FM())
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE)) // POST
      fetchMock.mockResolvedValueOnce(fail(500)) // footer GET fails
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const result = await touchNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })
      expect((result as { url: string }).url).toBe(MIRROR_URL)
      expect(errSpy).toHaveBeenCalled()
    })

    it('scaffolds an empty placeholder when the banner is disabled', async () => {
      const abs = await writeNote('note.md', '---\nstatus: x\nnotion_path: A\n---\n')
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE)) // POST
      fetchMock.mockResolvedValueOnce(emptyChildren()) // footer
      await touchNote({ ...cfg, bannerTemplate: '' }, abs, { type: 'page_id', page_id: PAGE_HEX })
      expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).children).toEqual([])
    })

    it('throws when the note has no frontmatter', async () => {
      const abs = await writeNote('note.md', '# Just a heading\n\nbody\n')
      await expect(touchNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })).rejects.toThrow(/no YAML frontmatter/)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('updateNote', () => {
    const OLD_BODY = '9'.repeat(32)
    const CHILD = 'e'.repeat(32)

    it('updates the page in place: PATCHes the page, replaces the body, spares child pages, keeps the URL', async () => {
      const abs = await writeNote('My Note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}\nkb_notion_mirror_published_at: 2020-01-01T00:00:00Z`))
      routeUpdate([
        { id: OLD_BODY, type: 'paragraph' },
        { id: CHILD, type: 'child_page', child_page: { title: 'C' } }
      ])
      const result = await updateNote(cfg, abs, { type: 'database_id', database_id: DB_ID })
      expect(result).toMatchObject({ url: MIRROR_URL, page_id: PAGE_HEX, updated_at: '2026-05-30T02:00:00Z' })
      expect(fetchMock.mock.calls.some((c) => /\/v1\/pages\/[a-f0-9]+$/.test(String(c[0])) && c[1].method === 'PATCH')).toBe(true)
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false)
      const deleted = fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE').map((c) => String(c[0]))
      expect(deleted).toContain(`https://api.notion.test/v1/blocks/${OLD_BODY}`)
      expect(deleted.some((u) => u.includes(CHILD))).toBe(false)
      const written = await fsp.readFile(abs, 'utf-8')
      expect(written).toContain(`kb_notion_mirror_url: ${MIRROR_URL}`)
      expect(written).toContain('kb_notion_mirror_published_at: 2026-05-30T02:00:00Z')
      expect(written).not.toContain('2020-01-01')
    })

    it('under a page parent sends the icon and refreshes the parent footer', async () => {
      const abs = await writeNote('My Note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      routeUpdate([{ id: OLD_BODY, type: 'paragraph' }], { type: 'page_id', page_id: OLD_PARENT })
      await updateNote(cfg, abs, { type: 'page_id', page_id: OLD_PARENT }, { icon: { type: 'emoji', emoji: '📗' } })
      const pagePatch = fetchMock.mock.calls.find((c) => /\/v1\/pages\/[a-f0-9]+$/.test(String(c[0])) && c[1].method === 'PATCH')
      expect(JSON.parse(pagePatch?.[1].body).icon).toEqual({ type: 'emoji', emoji: '📗' })
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === `https://api.notion.test/v1/blocks/${OLD_PARENT}/children?page_size=100`)).toBe(true)
    })

    it('resolves wikilinks via link_map (mention) and italicises the unresolved ones', async () => {
      const linkedHex = 'c'.repeat(32)
      const abs = await writeNote('My Note.md', `---\nstatus: x\nnotion_path: A\nkb_notion_mirror_url: ${MIRROR_URL}\n---\nSee [[Other]] and [[Gone]].\n`)
      routeUpdate([{ id: OLD_BODY, type: 'paragraph' }], { type: 'page_id', page_id: PAGE_HEX })
      await updateNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX }, { linkMap: { Other: `https://www.notion.so/Other-${linkedHex}` } })
      const appendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes(`/v1/blocks/${PAGE_HEX}/children`) && c[1]?.method === 'PATCH')
      const appended = JSON.parse(appendCall?.[1].body).children as Array<Record<string, unknown>>
      const para = appended.find((b) => b.type === 'paragraph') as { paragraph: { rich_text: Array<Record<string, unknown>> } }
      const rich = para.paragraph.rich_text
      expect(rich.some((r) => r.type === 'mention' && (r.mention as { page: { id: string } }).page.id === linkedHex)).toBe(true)
      expect(rich.some((r) => (r as { annotations?: { italic?: boolean } }).annotations?.italic && (r as { text?: { content?: string } }).text?.content === 'Gone')).toBe(true)
    })

    it('detects the page-id ↔ database-id silent-failure case and throws', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      const pageParent = { type: 'page_id', page_id: 'a'.repeat(32) }
      fetchMock.mockResolvedValueOnce(ok(DB_RESPONSE)) // title-property lookup for the new db parent
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: pageParent })) // GET before (page parent)
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: pageParent })) // PATCH (silently ignored)
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: pageParent })) // GET after — unchanged
      await expect(updateNote(cfg, abs, { type: 'database_id', database_id: DB_ID })).rejects.toThrow(/silently ignored the parent change/)
    })

    it('accepts a cross-type re-parent that took effect and refreshes the old page parent footer', async () => {
      const abs = await writeNote('My Note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      const oldPageParent = { type: 'page_id' as const, page_id: OLD_PARENT }
      const newDbParent = { type: 'database_id' as const, database_id: DB_ID }
      fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
        const method = init?.method ?? 'GET'
        if (url.includes('/v1/databases/')) return ok(DB_RESPONSE)
        if (/\/v1\/pages\/[a-f0-9]+$/.test(url) && method === 'PATCH') return ok({ ...PAGE_RESPONSE, parent: newDbParent })
        if (/\/v1\/pages\/[a-f0-9]+$/.test(url) && method === 'GET') {
          const getCalls = fetchMock.mock.calls.filter((c) => /\/v1\/pages\/[a-f0-9]+$/.test(String(c[0])) && (c[1]?.method ?? 'GET') === 'GET').length
          return ok({ ...PAGE_RESPONSE, parent: getCalls <= 1 ? oldPageParent : newDbParent })
        }
        if (url.includes('/children') && method === 'GET') return ok({ results: [{ id: OLD_BODY, type: 'paragraph' }], has_more: false, next_cursor: null })
        return ok({ results: [{ id: 'x' }] })
      })
      const result = await updateNote(cfg, abs, newDbParent)
      expect(result).toMatchObject({ url: MIRROR_URL })
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === `https://api.notion.test/v1/blocks/${OLD_PARENT}/children?page_size=100`)).toBe(true)
    })

    it('throws when the note is not mirrored yet (touch first)', async () => {
      const abs = await writeNote('My Note.md', FM())
      await expect(updateNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })).rejects.toThrow(/not mirrored yet — call touch/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws when the note has no frontmatter', async () => {
      const abs = await writeNote('note.md', '# heading only\n')
      await expect(updateNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })).rejects.toThrow(/no YAML frontmatter/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('omits the banner from the body when it is disabled', async () => {
      const abs = await writeNote('My Note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      routeUpdate([{ id: OLD_BODY, type: 'paragraph' }], { type: 'page_id', page_id: PAGE_HEX })
      await updateNote({ ...cfg, bannerTemplate: '' }, abs, { type: 'page_id', page_id: PAGE_HEX })
      const appendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes(`/v1/blocks/${PAGE_HEX}/children`) && c[1]?.method === 'PATCH')
      const appended = JSON.parse(appendCall?.[1].body).children as Array<{ type: string }>
      expect(appended.every((b) => b.type !== 'callout')).toBe(true)
    })

    it('throws on a malformed mirror url', async () => {
      const abs = await writeNote('note.md', FM('\nkb_notion_mirror_url: https://www.notion.so/no-id'))
      await expect(updateNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })).rejects.toThrow(/Could not extract a 32-hex page id/)
    })
  })

  describe('deleteNote', () => {
    it('dry-run (default path) returns the plan, makes no Notion call, leaves the file unchanged', async () => {
      const content = FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`)
      const abs = await writeNote('note.md', content)
      const result = await deleteNote(cfg, abs, true)
      expect(result).toEqual({ dry_run: true, would_archive_url: MIRROR_URL, would_archive_page_id: PAGE_HEX, would_clear_fields: ['kb_notion_mirror_url', 'kb_notion_mirror_published_at'] })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(await fsp.readFile(abs, 'utf-8')).toBe(content)
    })

    it('archives the page and clears the mirror fields (database parent → no footer)', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}\nkb_notion_mirror_published_at: 2026-05-30T01:13:00Z`))
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: { type: 'database_id', database_id: DB_ID } })) // GET page
      fetchMock.mockResolvedValueOnce(ok({})) // archive
      const result = await deleteNote(cfg, abs, false)
      expect(result).toEqual({ archived: true, page_id: PAGE_HEX, url: MIRROR_URL })
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/children'))).toBe(false)
      const written = await fsp.readFile(abs, 'utf-8')
      expect(written).not.toContain('kb_notion_mirror_url')
      expect(written).toContain('notion_path: A / B')
    })

    it('refreshes the parent footer when the archived page had a page parent', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: { type: 'page_id', page_id: OLD_PARENT } })) // GET page
      fetchMock.mockResolvedValueOnce(ok({})) // archive
      fetchMock.mockResolvedValueOnce(emptyChildren()) // footer refresh GET
      await deleteNote(cfg, abs, false)
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === `https://api.notion.test/v1/blocks/${OLD_PARENT}/children?page_size=100`)).toBe(true)
    })

    it('returns not-mirrored when the note has no mirror url', async () => {
      const abs = await writeNote('note.md', FM())
      expect(await deleteNote(cfg, abs, false)).toEqual({ archived: false, reason: 'not-mirrored' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws on a malformed mirror url', async () => {
      const abs = await writeNote('note.md', FM('\nkb_notion_mirror_url: https://www.notion.so/no-id'))
      await expect(deleteNote(cfg, abs, false)).rejects.toThrow(/Could not extract a 32-hex page id/)
    })
  })

  describe('moveNote', () => {
    it('re-parents the page (same parent type), refreshes both footers, and does not touch the file', async () => {
      const content = FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`)
      const abs = await writeNote('note.md', content)
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: { type: 'page_id', page_id: OLD_PARENT } })) // GET before
      fetchMock.mockResolvedValueOnce(ok({})) // PATCH parent
      fetchMock.mockResolvedValueOnce(emptyChildren()) // footer (old parent)
      fetchMock.mockResolvedValueOnce(emptyChildren()) // footer (new parent)
      const result = await moveNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })
      expect(result).toEqual({ moved: true, page_id: PAGE_HEX, previous_parent: { type: 'page_id', page_id: OLD_PARENT }, new_parent: { type: 'page_id', page_id: PAGE_HEX } })
      const footerGets = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/children')).map((c) => String(c[0]))
      expect(footerGets.some((u) => u.includes(OLD_PARENT))).toBe(true)
      expect(footerGets.some((u) => u.includes(PAGE_HEX))).toBe(true)
      expect(await fsp.readFile(abs, 'utf-8')).toBe(content)
    })

    it('detects the page-id ↔ database-id silent-failure case and errors', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      const pageParent = { type: 'page_id', page_id: 'a'.repeat(32) }
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: pageParent })) // GET before
      fetchMock.mockResolvedValueOnce(ok({})) // PATCH (silently ignored)
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: pageParent })) // GET after — unchanged
      await expect(moveNote(cfg, abs, { type: 'database_id', database_id: DB_ID })).rejects.toThrow(/silently ignored the parent change/)
    })

    it('accepts a cross-type move that took effect (refreshes only the old page parent)', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: { type: 'page_id', page_id: OLD_PARENT } })) // GET before
      fetchMock.mockResolvedValueOnce(ok({})) // PATCH
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: { type: 'database_id', database_id: DB_ID } })) // GET after — changed
      fetchMock.mockResolvedValueOnce(emptyChildren()) // footer (old page parent)
      const result = await moveNote(cfg, abs, { type: 'database_id', database_id: DB_ID })
      expect((result as { moved: boolean }).moved).toBe(true)
      const footerGets = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/children')).map((c) => String(c[0]))
      expect(footerGets).toEqual([`https://api.notion.test/v1/blocks/${OLD_PARENT}/children?page_size=100`])
    })

    it('moving from a database parent to a page parent refreshes only the new parent', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`))
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: { type: 'database_id', database_id: DB_ID } })) // GET before
      fetchMock.mockResolvedValueOnce(ok({})) // PATCH
      fetchMock.mockResolvedValueOnce(ok({ ...PAGE_RESPONSE, parent: { type: 'page_id', page_id: PAGE_HEX } })) // GET after — changed
      fetchMock.mockResolvedValueOnce(emptyChildren()) // footer (new page parent)
      const result = await moveNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })
      expect((result as { moved: boolean }).moved).toBe(true)
      const footerGets = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/children')).map((c) => String(c[0]))
      expect(footerGets).toEqual([`https://api.notion.test/v1/blocks/${PAGE_HEX}/children?page_size=100`])
    })

    it('throws when the note is not mirrored', async () => {
      const abs = await writeNote('note.md', FM())
      await expect(moveNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })).rejects.toThrow(/not mirrored — cannot move/)
    })

    it('throws on a malformed mirror url', async () => {
      const abs = await writeNote('note.md', FM('\nkb_notion_mirror_url: https://www.notion.so/no-id'))
      await expect(moveNote(cfg, abs, { type: 'page_id', page_id: PAGE_HEX })).rejects.toThrow(/Could not extract a 32-hex page id/)
    })
  })

  describe('getNote', () => {
    it('returns the live Notion page state without mutating the file', async () => {
      const content = FM(`\nkb_notion_mirror_url: ${MIRROR_URL}`)
      const abs = await writeNote('note.md', content)
      fetchMock.mockResolvedValueOnce(ok(PAGE_RESPONSE))
      expect(await getNote(cfg, abs)).toEqual({
        id: PAGE_RESPONSE.id,
        parent: { type: 'database_id', database_id: DB_ID },
        title: 'My Note',
        created_time: PAGE_RESPONSE.created_time,
        last_edited_time: PAGE_RESPONSE.last_edited_time,
        archived: false,
        url: MIRROR_URL
      })
      expect(await fsp.readFile(abs, 'utf-8')).toBe(content)
    })

    it('returns exists:false when the note has no mirror url', async () => {
      const abs = await writeNote('note.md', FM())
      expect(await getNote(cfg, abs)).toEqual({ exists: false, reason: 'not-mirrored' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws on a malformed mirror url', async () => {
      const abs = await writeNote('note.md', FM('\nkb_notion_mirror_url: https://www.notion.so/no-id'))
      await expect(getNote(cfg, abs)).rejects.toThrow(/Could not extract a 32-hex page id/)
    })
  })

  describe('statusNote', () => {
    it('reports a mirrored note with its url and published_at', async () => {
      const abs = await writeNote('note.md', FM(`\nkb_notion_mirror_url: ${MIRROR_URL}\nkb_notion_mirror_published_at: 2026-05-30T01:13:00Z`))
      expect(await statusNote(cfg, abs)).toEqual({ published: true, url: MIRROR_URL, published_at: '2026-05-30T01:13:00Z' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports an unmirrored note', async () => {
      const abs = await writeNote('note.md', FM())
      expect(await statusNote(cfg, abs)).toEqual({ published: false })
    })
  })

  describe('preflightNote', () => {
    it('passes a note with frontmatter', async () => {
      const abs = await writeNote('note.md', FM())
      expect(await preflightNote(cfg, abs)).toEqual({ ok: true, issues: [] })
    })

    it('flags a note with no frontmatter', async () => {
      const abs = await writeNote('note.md', '# heading only\n')
      expect(await preflightNote(cfg, abs)).toEqual({ ok: false, issues: ['Note has no YAML frontmatter; cannot be mirrored.'] })
    })
  })
})
