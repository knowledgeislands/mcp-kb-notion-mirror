import { describe, expect, it } from 'vitest'
import { bodyToBlocks, stripFrontmatter, stripLeadingH1, titleFromPath } from './markdown.js'

describe('markdown helpers', () => {
  describe('stripFrontmatter', () => {
    it('drops the leading frontmatter block and following blank lines', () => {
      expect(stripFrontmatter('---\na: 1\n---\n\n# Title\n')).toBe('# Title\n')
    })

    it('returns the text unchanged when there is no frontmatter', () => {
      expect(stripFrontmatter('# Title\n\nbody')).toBe('# Title\n\nbody')
    })
  })

  describe('stripLeadingH1', () => {
    it('drops the first H1, skipping leading blank lines', () => {
      expect(stripLeadingH1('\n\n# Heading\n\nbody')).toBe('\n\n\nbody')
    })

    it('leaves H2 and bodies without an H1 untouched', () => {
      expect(stripLeadingH1('## Sub\n\nbody')).toBe('## Sub\n\nbody')
      expect(stripLeadingH1('just text')).toBe('just text')
    })

    it('handles empty input', () => {
      expect(stripLeadingH1('')).toBe('')
    })
  })

  describe('titleFromPath', () => {
    it('strips dir and .md extension (case-insensitive)', () => {
      expect(titleFromPath('/kb/Eng/My Note.md')).toBe('My Note')
      expect(titleFromPath('Other.MD')).toBe('Other')
    })
  })

  describe('bodyToBlocks', () => {
    it('converts markdown to Notion blocks', () => {
      const blocks = bodyToBlocks('## Heading\n\nA paragraph.') as Array<{ type: string }>
      const types = blocks.map((b) => b.type)
      expect(types).toContain('heading_2')
      expect(types).toContain('paragraph')
    })

    it('returns an empty array for empty input', () => {
      expect(bodyToBlocks('')).toEqual([])
    })

    const contentOf = (block: { [k: string]: { rich_text?: Array<{ text?: { content?: string } }> } }, type: string): string =>
      (block[type]?.rich_text ?? []).map((r) => r.text?.content ?? '').join('')

    it('folds a hard-wrapped paragraph back into one line', () => {
      const blocks = bodyToBlocks('This paragraph was hard wrapped\nacross three\nsource lines.') as Array<{ type: string; [k: string]: unknown }>
      const para = blocks.find((b) => b.type === 'paragraph') as never
      expect(contentOf(para, 'paragraph')).toBe('This paragraph was hard wrapped across three source lines.')
    })

    it('folds wrapped list items but keeps item boundaries', () => {
      const blocks = bodyToBlocks('- first item that\n  wraps a line\n- second item') as Array<{ type: string; [k: string]: unknown }>
      const items = blocks.filter((b) => b.type === 'bulleted_list_item') as never[]
      expect(contentOf(items[0], 'bulleted_list_item')).toBe('first item that wraps a line')
      expect(contentOf(items[1], 'bulleted_list_item')).toBe('second item')
    })

    it('preserves newlines inside code blocks', () => {
      const blocks = bodyToBlocks('```\nline one\nline two\n```') as Array<{ type: string; [k: string]: unknown }>
      const code = blocks.find((b) => b.type === 'code') as never
      expect(contentOf(code, 'code')).toBe('line one\nline two')
    })

    it('walks table-row cells, folding soft breaks within each cell', () => {
      type Cell = Array<{ text?: { content?: string } }>
      type TableRow = { type: string; table_row?: { cells?: Cell[] } }
      const table = bodyToBlocks('| Col A | Col B |\n| --- | --- |\n| one | two |\n').find((b): b is { type: string; table: { children: TableRow[] } } => (b as { type?: string }).type === 'table')
      const cellText = (rows: TableRow[] | undefined): string[][] => (rows ?? []).map((r) => (r.table_row?.cells ?? []).map((cell) => cell.map((run) => run.text?.content ?? '').join('')))
      // The `cells` branch of collapseSoftBreaks ran on every row (header + body),
      // leaving cell content intact.
      expect(cellText(table?.table.children)).toEqual([
        ['Col A', 'Col B'],
        ['one', 'two']
      ])
    })
  })
})
