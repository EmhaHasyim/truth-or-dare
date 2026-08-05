import { Hono } from 'hono'
import api from './api'
import { RoomDO } from './rooms/room-do'
import { rateLimit } from './api/rate-limit'
import { cleanupStaleRooms } from './api/cleanup'
import type { Bindings } from './types'

export { RoomDO }

/**
 * CSP for API/WebSocket responses. The SPA HTML is served from the static
 * assets and gets the same policy via public/_headers (including the
 * 'sha256-...' that allows the inline theme-restore script in index.html).
 */
const CSP =
  "default-src 'self'; script-src 'self' 'sha256-SdTEFq1Doi0f4E1hFtoonVAibbbrTftk4IfnB5Medww='; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss: ws:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"

const app = new Hono<{ Bindings: Bindings }>()

// Security headers for API/WebSocket responses (skipped for 101 upgrades, whose
// headers are owned by the WebSocket handshake).
app.use('*', async (c, next) => {
  await next()
  if (c.res.status === 101) return
  c.header('Content-Security-Policy', CSP)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})

app.route('/api', api)

app.get('/ws/:roomId', rateLimit, async (c) => {
  const upgrade = c.req.header('Upgrade')
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426)
  }
  const roomId = c.req.param('roomId') ?? ''
  if (!roomId) {
    return c.text('Missing room id', 400)
  }

  // Forward the raw request directly to the DO to preserve ALL WebSocket upgrade
  // headers (Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, etc.).
  // DO NOT create a new Request() — that can strip WebSocket-specific metadata
  // and cause the DO to not recognize the request as a WebSocket upgrade.
  // The DO parses roomId from the URL path as a fallback.
  const id = c.env.ROOM_DO.idFromName(roomId)
  // 'apac' places new Durable Objects in Asia-Pacific — much closer to this
  // app's Indonesian audience than the previous 'wnam' (US East).
  const stub = c.env.ROOM_DO.get(id, { locationHint: 'apac' })
  return stub.fetch(c.req.raw)
})

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // API and WebSocket routes — handled by Hono
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
      return app.fetch(request, env, ctx)
    }

    // All other routes: let Cloudflare's asset system handle them.
    // With not_found_handling: "single-page-application" in wrangler config,
    // missing routes serve index.html automatically for client-side routing.
    return new Response('Not found', { status: 404 })
  },
  // Hourly cron — removes zombie/finished rooms and orphaned rows from D1.
  // See src/api/cleanup.ts. Trigger declared in wrangler.jsonc.
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const deleted = await cleanupStaleRooms(env.DB)
      if (deleted > 0) {
        console.log(`[cleanup] removed ${deleted} stale room(s)`)
      }
    } catch (error) {
      console.error('[cleanup] failed to remove stale rooms:', error)
    }
  },
}
