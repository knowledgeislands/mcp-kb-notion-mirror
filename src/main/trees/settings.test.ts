import { describe, expect, it } from 'vitest'
import { loadMirrorSettings } from './settings.js'

describe('loadMirrorSettings', () => {
  it('uses defaults when nothing is set (no required env var)', () => {
    const s = loadMirrorSettings({})
    expect(s.skipPrefixes).toEqual(['+'])
    expect([...s.skipKbPaths]).toEqual([])
    expect(s.iconBaseUrl).toBe('https://unpkg.com/lucide-static@latest/icons')
  })

  it('honours overrides via env', () => {
    const s = loadMirrorSettings({
      MCP_KB_NOTION_MIRROR_SKIP_PREFIXES: '_,~',
      MCP_KB_NOTION_MIRROR_SKIP_PATHS: 'Knowledge/Inbox.md,Knowledge/Drafts.md',
      MCP_KB_NOTION_MIRROR_ICON_BASE_URL: 'https://cdn.example.com/icons/'
    })
    expect(s.skipPrefixes).toEqual(['_', '~'])
    expect([...s.skipKbPaths]).toEqual(['Knowledge/Inbox.md', 'Knowledge/Drafts.md'])
    expect(s.iconBaseUrl).toBe('https://cdn.example.com/icons') // trailing slashes stripped
  })

  it('falls back to defaults on blank env values', () => {
    const s = loadMirrorSettings({ MCP_KB_NOTION_MIRROR_SKIP_PREFIXES: '   ', MCP_KB_NOTION_MIRROR_SKIP_PATHS: '' })
    expect(s.skipPrefixes).toEqual(['+'])
    expect([...s.skipKbPaths]).toEqual([])
  })

  it('reads from process.env by default', () => {
    const prev = process.env.MCP_KB_NOTION_MIRROR_SKIP_PREFIXES
    process.env.MCP_KB_NOTION_MIRROR_SKIP_PREFIXES = '@'
    try {
      expect(loadMirrorSettings().skipPrefixes).toEqual(['@'])
    } finally {
      if (prev === undefined) delete process.env.MCP_KB_NOTION_MIRROR_SKIP_PREFIXES
      else process.env.MCP_KB_NOTION_MIRROR_SKIP_PREFIXES = prev
    }
  })
})
