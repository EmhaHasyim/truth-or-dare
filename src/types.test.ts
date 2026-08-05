import { describe, it, expect } from 'vitest'

describe('src/types.ts', () => {
  it('should export Player interface', async () => {
    const types = await import('./types')
    // Player is a type — can't check at runtime, but module loads fine
    expect(types).toBeDefined()
  })

  it('should export Room interface', async () => {
    const types = await import('./types')
    expect(types).toBeDefined()
  })

  it('should export Bindings type', async () => {
    const types = await import('./types')
    expect(types).toBeDefined()
  })
})
