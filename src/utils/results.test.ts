import { describe, expect, it } from 'vitest'
import { errorResult, jsonResult } from './results.js'

describe('errorResult', () => {
  it('builds the MCP error response shape with an "Error <action>: <message>" text', () => {
    expect(errorResult('publishing note', new Error('boom'))).toEqual({ isError: true, content: [{ type: 'text', text: 'Error publishing note: boom' }] })
  })

  it('stringifies a non-Error error value', () => {
    expect(errorResult('reading note status', 'kaboom')).toEqual({ isError: true, content: [{ type: 'text', text: 'Error reading note status: kaboom' }] })
  })
})

describe('jsonResult', () => {
  it('serialises a payload to pretty JSON in a text block', () => {
    const r = jsonResult({ a: 1 })
    expect(r.content[0]?.type).toBe('text')
    expect(JSON.parse(r.content[0]?.text ?? '')).toEqual({ a: 1 })
  })
})
