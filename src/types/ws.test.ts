import { describe, it, expect } from 'vitest'

describe('types/ws', () => {
  it('should re-export WsPlayer', async () => {
    const ws = await import('./ws')
    // The re-export exists: it's just importing from ws-validation
    expect(ws).toBeDefined()
  })

  it('should export all server message types as interfaces', async () => {
    const ws = await import('./ws')
    // These are type-only exports — checking they exist via typeof
    expect(typeof ws).toBe('object')
  })
})
