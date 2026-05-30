#!/usr/bin/env node

/**
 * mcp-notion-mirror
 *
 * Local stdio MCP server that mirrors local Knowledge Base markdown notes to a
 * Notion wiki and records the resulting Notion page URL back into each note's
 * YAML frontmatter. The KB is canonical; the mirror is a derivative read
 * surface for non-KB consumers.
 *
 * Configuration (environment variables):
 *   MCP_NOTION_MIRROR_TOKEN              Required. Notion internal-integration
 *                                        secret (ntn_…). Must have Insert +
 *                                        Update content and be Connected to the
 *                                        target wiki page.
 *   MCP_NOTION_MIRROR_WIKI_DATABASE_ID   Required. The wiki database new mirror
 *                                        pages are created in.
 *   MCP_NOTION_MIRROR_KB_ROOT            Optional. Absolute KB root containing
 *                                        Pillars/. When unset, kb_path args must
 *                                        be absolute.
 *   MCP_NOTION_MIRROR_ACCESS_LEVEL       Optional. read | write | destructive.
 *                                        Default: write (archive needs
 *                                        destructive).
 *   MCP_NOTION_MIRROR_BANNER_TEXT        Optional. Override the banner's
 *                                        trailing sentence.
 *   MCP_NOTION_MIRROR_AUDIT_LOG          Optional. off | writes | all. Default: writes.
 *   MCP_NOTION_MIRROR_AUDIT_LOG_PATH     Optional. Default
 *                                        ~/.local/state/mcp-notion-mirror/audit.jsonl.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ACCESS_LEVEL, AUDIT_LOG_MODE, AUDIT_LOG_PATH, KB_ROOT, NOTION_API_BASE_URL, WIKI_DATABASE_ID } from '../config.js'
import { registerNotesTools } from '../tools/notes/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

console.error(`mcp-notion-mirror starting...`)
console.error(`  MCP_NOTION_MIRROR_API_BASE_URL=${NOTION_API_BASE_URL}`)
console.error(`  MCP_NOTION_MIRROR_WIKI_DATABASE_ID=${WIKI_DATABASE_ID}`)
console.error(`  MCP_NOTION_MIRROR_KB_ROOT=${KB_ROOT ?? '(unset — kb_path must be absolute)'}`)
console.error(`  MCP_NOTION_MIRROR_ACCESS_LEVEL=${ACCESS_LEVEL}`)
console.error(`  MCP_NOTION_MIRROR_AUDIT_LOG=${AUDIT_LOG_MODE}${AUDIT_LOG_MODE === 'off' ? '' : ` (path: ${AUDIT_LOG_PATH})`}`)

const server = new McpServer({
  name: 'mcp-notion-mirror',
  version: '1.0.1'
})
server.registerTool = makeAccessGatedRegister(server)

registerNotesTools(server)

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`mcp-notion-mirror ready`)
}

main().catch((err) => {
  console.error('mcp-notion-mirror fatal:', err)
  process.exit(1)
})
