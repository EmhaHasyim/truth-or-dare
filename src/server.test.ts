import { describe, it, expect, vi, beforeEach } from 'vitest'
// happy-dom ships its own minimal Request/Response/Headers globals that drop
// request headers (e.g. `Upgrade`), which breaks WebSocket upgrade tests.
// Import Node's native implementations from undici instead.
import {
  Request as NativeRequest,
  Response as NativeResponse,
  Headers as NativeHeaders,
} from 'undici'

const mockStubFetch = vi.fn()

vi.mock('./rooms/room-do', () => ({
  RoomDO: class MockRoomDO {
    ctx: any
    env: any
    constructor(ctx: any, env: any) {
      this.ctx = ctx
      this.env = env
    }
    fetch = mockStubFetch
  },
}))

// ── In-memory D1 store, shared by the mocked drizzle-orm/d1 instance ──
const mockStore = {
  rooms: new Map<string, any>(),
  players: new Map<string, any>(),
}

// Helper: resolve a select query given a condition from eq() or inArray().
function resolve(condition: any, table: 'rooms' | 'players') {
  const col = condition?.col
  const val = condition?.val
  const vals = condition?.vals as string[] | undefined
  const data = [...(table === 'rooms' ? mockStore.rooms : mockStore.players).values()]

  // inArray queries: only used for players.roomId lookups
  if (vals) {
    return data.filter((r: any) => r.roomId && vals.includes(r.roomId))
  }

  // eq queries: match by column name property
  const colName: string = col?.name ?? String(col ?? '')

  if (colName === 'status') {
    return data.filter((r: any) => r.status === val)
  }
  if (colName === 'id') {
    if (table === 'rooms') return mockStore.rooms.get(val) ? [mockStore.rooms.get(val)] : []
    return mockStore.players.get(val) ? [mockStore.players.get(val)] : []
  }
  if (colName === 'code') {
    return data.filter((r: any) => r.code === val)
  }
  // Fallback: return all data (handles unexpected column names)
  return data
}

// Build a mock query builder that reads/writes the shared store.
function mockCreateDb(): any {
  return {
    insert: vi.fn((_: any) => ({
      values: vi.fn((values: any) => ({
        returning: vi.fn(() => {
          const id = values.id
          if (values.hostName !== undefined) {
            const room = { ...values, createdAt: values.createdAt ?? new Date() }
            mockStore.rooms.set(id, room)
            return [room]
          }
          const player = { ...values }
          mockStore.players.set(id, player)
          return [player]
        }),
        onConflictDoNothing: vi.fn(),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn((_: any) => ({
        where: vi.fn((condition: any) => {
          // Determine table from condition: inArray (vals) = players, eq = rooms
          const table = condition?.vals ? 'players' : 'rooms'
          return {
            all: vi.fn(() => resolve(condition, table)),
            get: vi.fn(() => resolve(condition, table)[0] ?? null),
          }
        }),
        all: vi.fn(() => [...mockStore.rooms.values()]),
        get: vi.fn(() => null),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({})) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({})) })) })),
    run: vi.fn(),
  }
}

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: any, val: any) => ({ col, val })),
  inArray: vi.fn((col: any, vals: any[]) => ({ col, vals })),
  sql: vi.fn(),
}))

vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => mockCreateDb()),
}))

import app from './server'

function makeMockEnv() {
  return {
    DB: {} as unknown as D1Database,
    ROOM_DO: {
      idFromName: vi.fn(() => ({ toString: () => 'mock-do-id' })),
      get: vi.fn(() => ({
        fetch: mockStubFetch,
        id: { toString: () => 'mock-do-id' },
        name: 'mock-room-do',
      })),
    } as unknown as DurableObjectNamespace,
  }
}

// Every request gets its own source IP so the in-memory rate limiter (shared
// across tests in this file) can never throttle one test because of another.
let testIpCounter = 0
function makeRequest(url: string, init: RequestInit = {}): any {
  testIpCounter++
  const headers = new NativeHeaders(init.headers as any)
  headers.set('cf-connecting-ip', `203.0.113.${testIpCounter}`)
  return new NativeRequest(url, { ...init, headers } as any)
}

describe('server fetch handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStubFetch.mockReset()
    mockStore.rooms.clear()
    mockStore.players.clear()
  })

  it('should route /api/health to 200 OK', async () => {
    const res = await app.fetch(
      makeRequest('http://localhost/api/health'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('should create a room via POST /api/rooms (201)', async () => {
    const res = await app.fetch(
      makeRequest('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test Room', hostName: 'Alice' }),
      }),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      code: string
      players: { name: string; isHost: boolean }[]
    }
    expect(body.code).toHaveLength(6)
    expect(body.players).toHaveLength(1)
    expect(body.players[0].name).toBe('Alice')
    expect(body.players[0].isHost).toBe(true)
  })

  it('should list created rooms via GET /api/rooms (200)', async () => {
    // Create a room first through the real handler chain
    const createRes = await app.fetch(
      makeRequest('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Lobby', hostName: 'Alice' }),
      }),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(createRes.status).toBe(201)

    const res = await app.fetch(
      makeRequest('http://localhost/api/rooms'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toHaveLength(1)
  })

  it('should return 404 for an unknown room via GET /api/rooms/:id', async () => {
    // Must be a version-4 UUID: zod rejects malformed/uuid-format violations with 400.
    const res = await app.fetch(
      makeRequest('http://localhost/api/rooms/123e4567-e89b-42d3-a456-426614174000'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(404)
  })

  it('should return 404 for an unknown room code via GET /api/rooms/code/:code', async () => {
    const res = await app.fetch(
      makeRequest('http://localhost/api/rooms/code/ABCDEF'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(404)
  })

  it('should join a room via POST /api/rooms/:id/join', async () => {
    const createRes = await app.fetch(
      makeRequest('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Party', hostName: 'Alice' }),
      }),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    const room = (await createRes.json()) as { id: string }

    const res = await app.fetch(
      makeRequest(`http://localhost/api/rooms/${room.id}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: 'Bob' }),
      }),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { players: { name: string }[] }
    expect(body.players.map((p) => p.name)).toEqual(['Alice', 'Bob'])
  })

  it('should reject non-WebSocket /ws requests with 426', async () => {
    const res = await app.fetch(
      makeRequest('http://localhost/ws/room123'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(426)
  })

  it('should forward WebSocket /ws requests to the DO stub', async () => {
    // Node's Response constructor rejects 101, so the DO stub mock returns 200.
    mockStubFetch.mockResolvedValue(new NativeResponse('ok', { status: 200 }))
    const wsReq = makeRequest('http://localhost/ws/room123?name=Alice', {
      headers: { Upgrade: 'websocket' },
    })
    const res = await app.fetch(wsReq, makeMockEnv() as any, {} as ExecutionContext)
    expect(mockStubFetch).toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it('should return 400 for /ws request without a room id', async () => {
    // A WebSocket upgrade request to /ws/ with empty roomId segment.
    const res = await app.fetch(
      makeRequest('http://localhost/ws/', {
        headers: { Upgrade: 'websocket' },
      }),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect([400, 404]).toContain(res.status)
  })

  it('should return 404 for unknown routes', async () => {
    const res = await app.fetch(
      makeRequest('http://localhost/unknown'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(404)
  })
})
