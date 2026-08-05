import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import type { Next } from 'hono'

// Helper to create a minimal mock Hono context
function createCtx(ip: string) {
  return {
    req: {
      header: vi.fn((name: string) => {
        if (name === 'cf-connecting-ip') return ip
        if (name === 'x-forwarded-for') return undefined
        return undefined
      }),
    },
    json: vi.fn((body: unknown, status?: number) => {
      return new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  }
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow requests under the limit', async () => {
    const { rateLimit } = await import('./rate-limit')
    const ctx = createCtx('10.0.0.1') as any
    const next: Next = vi.fn()

    for (let i = 0; i < 29; i++) {
      const result = await rateLimit(ctx, next)
      expect(result).toBeUndefined()
    }
    expect(next).toHaveBeenCalledTimes(29)
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('should block requests over the limit', async () => {
    const { rateLimit } = await import('./rate-limit')
    const ctx = createCtx('10.0.0.2') as any
    const next: Next = vi.fn()

    for (let i = 0; i < 30; i++) {
      await rateLimit(ctx, next)
    }

    const blocked = await rateLimit(ctx, next)
    expect(blocked).toBeInstanceOf(Response)
    expect((blocked as Response).status).toBe(429)

    const body = await (blocked as Response).json()
    expect(body).toHaveProperty('error')

    expect(next).toHaveBeenCalledTimes(30)
  })

  it('should track different IPs independently', async () => {
    const { rateLimit } = await import('./rate-limit')
    const ctx1 = createCtx('10.0.0.3') as any
    const ctx2 = createCtx('10.0.0.4') as any
    const next: Next = vi.fn()

    for (let i = 0; i < 30; i++) {
      await rateLimit(ctx1, next)
    }

    const blocked = await rateLimit(ctx1, next)
    expect(blocked).toBeInstanceOf(Response)

    const allowed = await rateLimit(ctx2, next)
    expect(allowed).toBeUndefined()
  })

  it('should reset the limit after the window expires', async () => {
    const { rateLimit } = await import('./rate-limit')
    const ctx = createCtx('10.0.0.5') as any
    const next: Next = vi.fn()

    for (let i = 0; i < 30; i++) {
      await rateLimit(ctx, next)
    }

    const blocked = await rateLimit(ctx, next)
    expect(blocked).toBeInstanceOf(Response)

    vi.advanceTimersByTime(60_001)

    const allowed = await rateLimit(ctx, next)
    expect(allowed).toBeUndefined()
    // 30 original + 1 new
    expect(next).toHaveBeenCalledTimes(31)
  })

  it('should use "unknown" when no IP headers are present', async () => {
    const { rateLimit } = await import('./rate-limit')
    const ctx = {
      req: { header: vi.fn(() => undefined) },
      json: vi.fn((body: unknown, status?: number) => {
        return new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    } as any
    const next: Next = vi.fn()

    for (let i = 0; i < 30; i++) {
      await rateLimit(ctx, next)
    }

    const blocked = await rateLimit(ctx, next)
    expect(blocked).toBeInstanceOf(Response)
    expect((blocked as Response).status).toBe(429)
  })

  it('should use x-forwarded-for when cf-connecting-ip is missing', async () => {
    const { rateLimit } = await import('./rate-limit')
    const ctx = {
      req: {
        header: vi.fn((name: string) => {
          if (name === 'cf-connecting-ip') return undefined
          if (name === 'x-forwarded-for') return '10.0.0.6'
          return undefined
        }),
      },
      json: vi.fn((body: unknown, status?: number) => {
        return new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    } as any
    const next: Next = vi.fn()

    for (let i = 0; i < 30; i++) {
      await rateLimit(ctx, next)
    }

    const blocked = await rateLimit(ctx, next)
    expect(blocked).toBeInstanceOf(Response)
    expect((blocked as Response).status).toBe(429)
  })

  it('should prune expired clients when tracking many IPs', async () => {
    const { rateLimit } = await import('./rate-limit')
    const next: Next = vi.fn()

    // Add more than MAX_TRACKED_CLIENTS (10_000) distinct clients
    for (let i = 0; i < 10_001; i++) {
      const ctx = createCtx(`10.9.9.${i}`) as any
      await rateLimit(ctx, next)
    }

    // Advance past the window so all entries are fully expired
    vi.advanceTimersByTime(61_000)

    // Trigger another request — should prune and still work
    const fresh = createCtx('10.9.9.99999') as any
    const result = await rateLimit(fresh, next)
    expect(result).toBeUndefined()
  })

  it('should not prune clients with recent activity', async () => {
    const { rateLimit } = await import('./rate-limit')
    const next: Next = vi.fn()

    // Add many clients, then add a fresh one
    for (let i = 0; i < 10_001; i++) {
      const ctx = createCtx(`10.8.8.${i}`) as any
      await rateLimit(ctx, next)
    }

    // Fresh activity right before the sweep
    const recent = createCtx('10.8.8.99999') as any
    await rateLimit(recent, next)

    // Advance some time but not past the full window for the recent client
    vi.advanceTimersByTime(30_000)
    const result = await rateLimit(recent, next)
    expect(result).toBeUndefined()
  })
})
