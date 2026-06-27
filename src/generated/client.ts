// @ts-nocheck
// Generated on 2026-06-27T20:37:57.185Z by @knowledgeislands/mcp-kb-notion-mirror@1.0.0
// Server: hnr-mcp-kb-notion-mirror
// Source: /Users/krisbrown/.mcporter/mcporter.json
// Transport: STDIO /Users/krisbrown/.local/share/mise/installs/node/lts/bin/node /Users/krisbrown/kis/knowledgeislands/mcp-kb-notion-mirror/dist/mcp-server/index.js

import { createRuntime, createServerProxy, wrapCallResult } from 'mcporter'
import type { HnrMcpKbNotionMirrorTools } from './types.d'

type RuntimeInstance = Awaited<ReturnType<typeof createRuntime>>
export type HnrMcpKbNotionMirrorClient = HnrMcpKbNotionMirrorTools & { close(): Promise<void> }

export interface CreateClientOptions {
  runtime?: RuntimeInstance
  configPath?: string
  rootDir?: string
}

export async function createHnrMcpKbNotionMirrorClient(options: CreateClientOptions = {}): Promise<HnrMcpKbNotionMirrorClient> {
  const runtime =
    options.runtime ??
    (await createRuntime({
      configPath: options.configPath,
      rootDir: options.rootDir
    }))
  const ownsRuntime = !options.runtime
  const proxy = createServerProxy(runtime, 'hnr-mcp-kb-notion-mirror')
  const client: HnrMcpKbNotionMirrorClient = {
    async kb_notion_mirror_note_get(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_get']>[0]) {
      const tool = proxy.kbNotionMirrorNoteGet as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_get']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_note_status(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_status']>[0]) {
      const tool = proxy.kbNotionMirrorNoteStatus as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_status']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_note_preflight(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_preflight']>[0]) {
      const tool = proxy.kbNotionMirrorNotePreflight as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_preflight']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_note_touch(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_touch']>[0]) {
      const tool = proxy.kbNotionMirrorNoteTouch as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_touch']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_note_update(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_update']>[0]) {
      const tool = proxy.kbNotionMirrorNoteUpdate as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_update']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_note_move(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_move']>[0]) {
      const tool = proxy.kbNotionMirrorNoteMove as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_move']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_note_delete(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_delete']>[0]) {
      const tool = proxy.kbNotionMirrorNoteDelete as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_note_delete']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_tree_status(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_status']>[0]) {
      const tool = proxy.kbNotionMirrorTreeStatus as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_status']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_tree_preflight(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_preflight']>[0]) {
      const tool = proxy.kbNotionMirrorTreePreflight as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_preflight']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_tree_touch(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_touch']>[0]) {
      const tool = proxy.kbNotionMirrorTreeTouch as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_touch']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_tree_update(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_update']>[0]) {
      const tool = proxy.kbNotionMirrorTreeUpdate as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_update']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_tree_delete(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_delete']>[0]) {
      const tool = proxy.kbNotionMirrorTreeDelete as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_delete']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_tree_prune(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_prune']>[0]) {
      const tool = proxy.kbNotionMirrorTreePrune as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_tree_prune']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async kb_notion_mirror_roots_list(params: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_roots_list']>[0]) {
      const tool = proxy.kbNotionMirrorRootsList as (
        args: Parameters<HnrMcpKbNotionMirrorTools['kb_notion_mirror_roots_list']>[0]
      ) => Promise<unknown>
      const raw = await tool(params)
      return wrapCallResult(raw).callResult
    },

    async close() {
      if (ownsRuntime) {
        await runtime.close('hnr-mcp-kb-notion-mirror').catch(() => {})
      }
    }
  }
  return client
}
