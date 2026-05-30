import { describe, expect, it } from 'vitest'
import { ancestorIndexChain, deriveParent } from './parent-resolver.js'

const PILLARS = '/kb/Pillars'

describe('deriveParent', () => {
  it('rule 1: the pillars root index parents at the database', () => {
    expect(deriveParent('/kb/Pillars/Pillars.md', PILLARS)).toEqual({ type: 'database-root' })
  })

  it('rule 2: a top-level folder index parents at the pillars root index', () => {
    expect(deriveParent('/kb/Pillars/Engineering/Engineering.md', PILLARS)).toEqual({ type: 'page', parentKbPath: '/kb/Pillars/Pillars.md' })
  })

  it('rule 2: a nested folder index parents at its grandparent index', () => {
    expect(deriveParent('/kb/Pillars/Engineering/Bioweave/Bioweave.md', PILLARS)).toEqual({ type: 'page', parentKbPath: '/kb/Pillars/Engineering/Engineering.md' })
  })

  it('rule 2: a deeply nested folder index parents at its grandparent index', () => {
    expect(deriveParent('/kb/Pillars/Engineering/Layers/Backend/Backend Components/Backend Components.md', PILLARS)).toEqual({
      type: 'page',
      parentKbPath: '/kb/Pillars/Engineering/Layers/Backend/Backend.md'
    })
  })

  it('rule 3: a leaf note parents at its containing folder index', () => {
    expect(deriveParent('/kb/Pillars/Engineering/Bioweave/Multi-Instance and Multi-Tenant.md', PILLARS)).toEqual({
      type: 'page',
      parentKbPath: '/kb/Pillars/Engineering/Bioweave/Bioweave.md'
    })
  })

  it('rule 3: a leaf directly under Pillars parents at the pillars root index', () => {
    expect(deriveParent('/kb/Pillars/Loose Note.md', PILLARS)).toEqual({ type: 'page', parentKbPath: '/kb/Pillars/Pillars.md' })
  })
})

describe('ancestorIndexChain', () => {
  it('returns the full chain child→ancestor up to (not including) the database root', () => {
    expect(ancestorIndexChain('/kb/Pillars/Engineering/Bioweave/Multi-Instance and Multi-Tenant.md', PILLARS)).toEqual([
      '/kb/Pillars/Engineering/Bioweave/Bioweave.md',
      '/kb/Pillars/Engineering/Engineering.md',
      '/kb/Pillars/Pillars.md'
    ])
  })

  it('returns just the pillars root index for a top-level folder index', () => {
    expect(ancestorIndexChain('/kb/Pillars/Engineering/Engineering.md', PILLARS)).toEqual(['/kb/Pillars/Pillars.md'])
  })

  it('returns an empty chain for the pillars root index itself', () => {
    expect(ancestorIndexChain('/kb/Pillars/Pillars.md', PILLARS)).toEqual([])
  })
})
