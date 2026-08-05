import type { Context, Next } from 'hono'
import type { Bindings } from '../types'

const windowMs = 60_000 // 1 minute window
const maxRequests = 30 // max 30 requests per window per client
/** Target size after an eviction sweep. */
const MAX_TRACKED_CLIENTS = 10_000
/**
 * Hard memory bound — when the map reaches this size, a sweep evicts the
 * least-recently-active clients down to MAX_TRACKED_CLIENTS. Sweeps are rare
 * (only after the map grows past 2× the target), so steady-state requests stay O(1).
 */
const HARD_CAP = MAX_TRACKED_CLIENTS * 2

/**
 * In-memory rate limiter keyed by client IP.
 *
 * Per-isolate, so limits are approximate across multiple Worker instances.
 * This is intentional: D1-based rate limiting would add 10+ms latency per
 * request and count against D1 read quota. For a party game with moderate
 * traffic, per-isolate limits are sufficient for abuse prevention.
 *
 * Memory is bounded: once `MAX_TRACKED_CLIENTS` is exceeded, the least
 * recently active clients are evicted so the Map can never grow unbounded
 * under a flood of distinct IPs.
 */
const clients = new Map<string, number[]>()

function lastActivity(entry: number[]): number {
  return entry.length > 0 ? entry[entry.length - 1] : 0
}

export async function rateLimit(
  c: Context<{ Bindings: Bindings }>,
  next: Next,
): Promise<Response | void> {
  // cf-connecting-ip is set by Cloudflare and is authoritative. The
  // x-forwarded-for fallback only matters for local dev; take the leftmost hop
  // (the original client) so a spoofed chain can't be used to bypass limits.
  const forwarded = c.req.header('x-forwarded-for')
  const ip =
    c.req.header('cf-connecting-ip') || (forwarded ? forwarded.split(',')[0].trim() : 'unknown')
  const now = Date.now()
  const cutoff = now - windowMs

  // Bounded memory: only when the map passes HARD_CAP, evict the least
  // recently active clients back down to the target. Evicting live entries
  // only slightly relaxes the limit during an attack — the alternative
  // (unbounded growth) is worse.
  if (clients.size >= HARD_CAP) {
    const entries = [...clients.entries()].sort((a, b) => lastActivity(a[1]) - lastActivity(b[1]))
    const evictCount = clients.size - MAX_TRACKED_CLIENTS
    for (let i = 0; i < evictCount && i < entries.length; i++) {
      clients.delete(entries[i][0])
    }
  }

  let entry = clients.get(ip)
  if (!entry) {
    entry = [now]
    clients.set(ip, entry)
    await next()
    return
  }

  // Remove expired timestamps (filter in-place)
  let writeIdx = 0
  for (let readIdx = 0; readIdx < entry.length; readIdx++) {
    if (entry[readIdx] >= cutoff) {
      entry[writeIdx++] = entry[readIdx]
    }
  }
  entry.length = writeIdx

  if (entry.length >= maxRequests) {
    return c.json({ error: 'Too many requests. Please try again later.' } as const, 429)
  }

  entry.push(now)
  await next()
}
