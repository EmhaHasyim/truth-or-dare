import { Hono } from 'hono'
import api from './api'
import { RoomDO } from './rooms/room-do'
import { rateLimit } from './api/rate-limit'
import type { Bindings } from './types'

export { RoomDO }

const app = new Hono<{ Bindings: Bindings }>()
app.route('/api', api)

app.get('/ws/:roomId', rateLimit, async (c) => {
  const upgrade = c.req.header('Upgrade')
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426)
  }
  const roomId = c.req.param('roomId')

  // Forward the raw request directly to the DO to preserve ALL WebSocket upgrade
  // headers (Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, etc.).
  // DO NOT create a new Request() — that can strip WebSocket-specific metadata
  // and cause the DO to not recognize the request as a WebSocket upgrade.
  // The DO parses roomId from the URL path as a fallback.
  const stub = c.env.ROOM_DO.getByName(roomId, { locationHint: 'wnam' })
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
}
