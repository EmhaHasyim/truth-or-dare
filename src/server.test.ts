import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from './server'

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

function makeMockEnv() {
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => null),
          run: vi.fn(() => ({ success: true })),
          all: vi.fn(() => ({ results: [] })),
        })),
      })),
    } as unknown as D1Database,
    ROOM_DO: {
      idFromName: vi.fn(() => ({ toString: () => 'mock-do-id' })),
      getByName: vi.fn(() => ({
        fetch: mockStubFetch,
        id: { toString: () => 'mock-do-id' },
        name: 'mock-room-do',
        getWebSockets: vi.fn().mockReturnValue([]),
      })),
      get: vi.fn(() => ({
        fetch: mockStubFetch,
        id: { toString: () => 'mock-do-id' },
        name: 'mock-room-do',
      })),
    } as unknown as DurableObjectNamespace,
  }
}

describe('server fetch handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should route /api/health to 200 OK', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/health'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('should handle POST /api/rooms (routed to handler, not 404)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test Room', hostName: 'Alice' }),
      }),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).not.toBe(404)
  })

  it('should handle GET /api/rooms (routed to handler, not 404)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/rooms'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).not.toBe(404)
  })

  it('should reject non-WebSocket /ws requests with 426', async () => {
    const res = await app.fetch(
      new Request('http://localhost/ws/room123'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(426)
  })

  it('should call DO stub.fetch for WebSocket /ws requests', async () => {
    const wsReq = new Request('http://localhost/ws/room123?name=Alice', {
      headers: { Upgrade: 'websocket' },
    })
    await app.fetch(
      wsReq,
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    // Verify the DO stub's fetch() was called (WebSocket forwarding)
    expect(mockStubFetch).toHaveBeenCalled()
  })

  it('should return 404 for unknown routes', async () => {
    const res = await app.fetch(
      new Request('http://localhost/unknown'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(404)
  })

  it('should handle /api/rooms/:id route', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/rooms/00000000-0000-0000-0000-000000000001'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).not.toBe(404)
  })

  it('should handle /api/rooms/code/:code route', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/rooms/code/ABC123'),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).not.toBe(404)
  })

  it('should handle POST /api/rooms/:id/join', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/rooms/00000000-0000-0000-0000-000000000001/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: 'Bob' }),
      }),
      makeMockEnv() as any,
      {} as ExecutionContext,
    )
    expect(res.status).not.toBe(404)
  })
})
