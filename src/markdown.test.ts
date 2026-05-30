import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reseedEnv = () => {
  process.env.MCP_NOTION_MIRROR_TOKEN = 'ntn_placeholder'
  process.env.MCP_NOTION_MIRROR_WIKI_DATABASE_ID = '00000000000000000000000000000000'
}

describe('markdown helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    reseedEnv()
    delete process.env.MCP_NOTION_MIRROR_BANNER_TEXT
  })

  afterEach(() => {
    delete process.env.MCP_NOTION_MIRROR_BANNER_TEXT
  })

  describe('stripFrontmatter', () => {
    it('drops the leading frontmatter block and following blank lines', async () => {
      const { stripFrontmatter } = await import('./markdown.js')
      expect(stripFrontmatter('---\na: 1\n---\n\n# Title\n')).toBe('# Title\n')
    })

    it('returns the text unchanged when there is no frontmatter', async () => {
      const { stripFrontmatter } = await import('./markdown.js')
      expect(stripFrontmatter('# Title\n\nbody')).toBe('# Title\n\nbody')
    })
  })

  describe('stripLeadingH1', () => {
    it('drops the first H1, skipping leading blank lines', async () => {
      const { stripLeadingH1 } = await import('./markdown.js')
      expect(stripLeadingH1('\n\n# Heading\n\nbody')).toBe('\n\n\nbody')
    })

    it('leaves H2 and bodies without an H1 untouched', async () => {
      const { stripLeadingH1 } = await import('./markdown.js')
      expect(stripLeadingH1('## Sub\n\nbody')).toBe('## Sub\n\nbody')
      expect(stripLeadingH1('just text')).toBe('just text')
    })

    it('handles empty input', async () => {
      const { stripLeadingH1 } = await import('./markdown.js')
      expect(stripLeadingH1('')).toBe('')
    })
  })

  describe('titleFromPath', () => {
    it('strips dir and .md extension (case-insensitive)', async () => {
      const { titleFromPath } = await import('./markdown.js')
      expect(titleFromPath('/kb/Pillars/Eng/My Note.md')).toBe('My Note')
      expect(titleFromPath('Other.MD')).toBe('Other')
    })
  })

  describe('bannerBlock', () => {
    it('builds the default callout with the date in the bold prefix', async () => {
      const { bannerBlock } = await import('./markdown.js')
      const b = bannerBlock('2026-05-30') as any
      expect(b.type).toBe('callout')
      expect(b.callout.icon).toEqual({ type: 'emoji', emoji: '📘' })
      expect(b.callout.rich_text[0].text.content).toBe('Mirrored from Knowledge Base on 2026-05-30')
      expect(b.callout.rich_text[0].annotations.bold).toBe(true)
      expect(b.callout.rich_text[1].text.content).toContain("canonical version lives in HNR's KB")
    })

    it('uses MCP_NOTION_MIRROR_BANNER_TEXT for the trailing sentence when set', async () => {
      process.env.MCP_NOTION_MIRROR_BANNER_TEXT = ' — see the internal wiki.'
      const { bannerBlock } = await import('./markdown.js')
      const b = bannerBlock('2026-05-30') as any
      expect(b.callout.rich_text[1].text.content).toBe(' — see the internal wiki.')
    })
  })

  describe('buildPageChildren', () => {
    it('prepends the banner, then the converted markdown blocks', async () => {
      const { buildPageChildren } = await import('./markdown.js')
      const blocks = buildPageChildren('## Heading\n\nA paragraph.', '2026-05-30') as any[]
      expect(blocks[0].type).toBe('callout')
      const types = blocks.map((b) => b.type)
      expect(types).toContain('heading_2')
      expect(types).toContain('paragraph')
    })
  })
})
