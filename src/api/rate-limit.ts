import type { Context, Next } from 'hono'
import type { Bindings } from '../types'

interface RateLimitEntry {
  timestamps: number[]
}

const windowMs = 60_000 // 1 minute window
const maxRequests = 30 // max 30 requests per window per client

// Simple in-memory rate limiter. Per-isolate, so it's approximate
// across multiple Workers instances, but sufficient for abuse prevention.
const clients = new Map<string, RateLimitEntry>()

// Cleanup happens lazily on each request. The Map is reclaimed on isolate eviction.
export async function rateLimit(c: Context<{ Bindings: Bindings }>, next: Next): Promise<Response | void> {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
  const now = Date.now()

  let entry = clients.get(ip)
  if (!entry) {
    entry = { timestamps: [] }
    clients.set(ip, entry)
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs)

  if (entry.timestamps.length >= maxRequests) {
    return c.json({ error: 'Too many requests. Please try again later.' } as const, 429)
  }

  entry.timestamps.push(now)
  await next()
}
