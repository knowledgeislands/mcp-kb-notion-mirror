import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    env: {
      // Bogus token + database id so config.ts boot validation passes when tests
      // instantiate modules that import config. The token is never used to make a
      // real call — the Notion client is exercised through `fetch` mocks.
      MCP_NOTION_MIRROR_TOKEN: 'ntn_placeholder',
      MCP_NOTION_MIRROR_WIKI_DATABASE_ID: '00000000000000000000000000000000'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Server entry points and tool registration aggregators are pure
        // wiring (every line is `server.registerTool(...)`); their behaviour
        // is exercised by `bun run server:mcp:inspect` and smoke tests.
        'src/mcp-server/index.ts',
        'src/tools/**/index.ts',
        // Pure data: annotation presets are referenced only from tool
        // registration sites (which are themselves excluded).
        'src/utils/annotations.ts'
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
})
