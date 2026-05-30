import { describe, expect, it } from 'vitest'
import { errMessage } from './errors.js'

describe('errMessage', () => {
  it('returns the message for an Error', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(errMessage('boom')).toBe('boom')
    expect(errMessage(42)).toBe('42')
  })
})
