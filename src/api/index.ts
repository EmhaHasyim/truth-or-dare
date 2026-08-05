import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import * as rooms from './rooms'
import { createDb } from '../db'
import type { Bindings } from '../types'
import { rateLimit } from './rate-limit'

// Matches client-side validation in src/routes/index.tsx
const NAME_REGEX = /^[^<>{}\\]*$/

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(30).regex(NAME_REGEX, 'Karakter spesial tidak diizinkan'),
  hostName: z.string().trim().min(1).max(20).regex(NAME_REGEX, 'Karakter spesial tidak diizinkan'),
  password: z.string().min(8).max(72).optional(),
})

const joinRoomSchema = z.object({
  playerName: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(NAME_REGEX, 'Karakter spesial tidak diizinkan'),
  password: z.string().max(72).optional(),
})

const uuidParam = z.string().uuid()
// Room codes use chars: ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no I, O, 0, 1)
const roomCodeParam = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/)

const api = new Hono<{ Bindings: Bindings }>()

const routes = api
  .post('/rooms', rateLimit, zValidator('json', createRoomSchema), async (c) => {
    const db = createDb(c.env.DB)
    const body = c.req.valid('json')
    const room = await rooms.createRoom(db, body)
    return c.json(room, 201)
  })
  .get('/rooms', rateLimit, async (c) => {
    const db = createDb(c.env.DB)
    const active = await rooms.listActiveRooms(db)
    return c.json(active)
  })
  // Explicit /rooms/code (no code segment) so it returns 404 instead of being
  // swallowed by /rooms/:id and rejected with a 400 uuid validation error.
  .get('/rooms/code', rateLimit, (c) => c.json({ error: 'Room not found' } as const, 404))
  .get('/rooms/:id', rateLimit, zValidator('param', z.object({ id: uuidParam })), async (c) => {
    const db = createDb(c.env.DB)
    const { id } = c.req.valid('param')
    const room = await rooms.getRoomById(db, id)
    if (!room) return c.json({ error: 'Room not found' } as const, 404)
    return c.json(room)
  })
  .get(
    '/rooms/code/:code',
    rateLimit,
    zValidator('param', z.object({ code: roomCodeParam })),
    async (c) => {
      const db = createDb(c.env.DB)
      const { code } = c.req.valid('param')
      const room = await rooms.getRoomByCode(db, code)
      if (!room) return c.json({ error: 'Room not found' } as const, 404)
      return c.json(room)
    },
  )
  .post(
    '/rooms/:id/join',
    rateLimit,
    zValidator('param', z.object({ id: uuidParam })),
    zValidator('json', joinRoomSchema),
    async (c) => {
      const db = createDb(c.env.DB)
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const result = await rooms.joinRoom(db, { roomId: id, ...body })
      if ('error' in result) return c.json({ error: result.error } as const, 400)
      return c.json(result.room)
    },
  )
  .get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() } as const))

export type AppType = typeof routes

export default routes
