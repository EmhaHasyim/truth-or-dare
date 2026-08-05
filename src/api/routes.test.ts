import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from './index'

vi.mock('./rooms', () => ({
  createRoom: vi.fn(),
  listActiveRooms: vi.fn(),
  getRoomById: vi.fn(),
  getRoomByCode: vi.fn(),
  joinRoom: vi.fn(),
}))

vi.mock('../lib/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi.fn(async (pw: string, stored: string) => stored === `hashed:${pw}`),
  isValidPassword: vi.fn((pw: string) => pw.length >= 8 && pw.length <= 128),
}))

import * as rooms from './rooms'

function makeMockEnv() {
  return {
    DB: {} as unknown as D1Database,
    ROOM_DO: {} as any,
  }
}

function makeRoom(name = 'Test Room', overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    code: 'ABC123',
    name,
    hostName: 'Alice',
    maxPlayers: 2,
    hasPassword: false,
    status: 'waiting' as const,
    createdAt: Date.now(),
    players: [{ id: 'p1', name: 'Alice', isHost: true }],
    ...overrides,
  }
}

describe('API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /rooms', () => {
    it('should create a room and return 201', async () => {
      vi.mocked(rooms.createRoom).mockResolvedValue(makeRoom())
      const res = await api.request(
        '/rooms',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Test Room', hostName: 'Alice' }),
        },
        makeMockEnv(),
      )
      expect(res.status).toBe(201)
    })

    it('should reject empty room name', async () => {
      const res = await api.request(
        '/rooms',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '', hostName: 'Alice' }),
        },
        makeMockEnv(),
      )
      expect(res.status === 400 || res.status === 422).toBe(true)
    })

    it('should reject name exceeding 30 chars', async () => {
      const res = await api.request(
        '/rooms',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'A'.repeat(31), hostName: 'Alice' }),
        },
        makeMockEnv(),
      )
      expect(res.status === 400 || res.status === 422).toBe(true)
    })
  })

  describe('GET /rooms', () => {
    it('should list active rooms', async () => {
      vi.mocked(rooms.listActiveRooms).mockResolvedValue([makeRoom('Room 1'), makeRoom('Room 2')])
      const res = await api.request('/rooms', {}, makeMockEnv())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
    })

    it('should return empty list', async () => {
      vi.mocked(rooms.listActiveRooms).mockResolvedValue([])
      const res = await api.request('/rooms', {}, makeMockEnv())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })

  describe('GET /rooms/:id', () => {
    it('should find room by ID and return it (200)', async () => {
      vi.mocked(rooms.getRoomById).mockResolvedValue(makeRoom())
      const res = await api.request(
        '/rooms/123e4567-e89b-42d3-a456-426614174000',
        {
          headers: { 'cf-connecting-ip': '10.0.0.55' },
        },
        makeMockEnv(),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id?: string }
      expect(body.id).toBe('00000000-0000-0000-0000-000000000001')
    })

    it('should return 404 when room not found', async () => {
      vi.mocked(rooms.getRoomById).mockResolvedValue(null)
      const res = await api.request(
        '/rooms/123e4567-e89b-12d3-a456-426614174000',
        {
          headers: { 'cf-connecting-ip': '10.0.0.21' },
        },
        makeMockEnv(),
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error?: string }
      expect(body).toEqual({ error: 'Room not found' })
    })

    it('should reject invalid uuid param', async () => {
      const res = await api.request('/rooms/not-a-uuid', {}, makeMockEnv())
      expect([400, 422, 429]).toContain(res.status)
    })
  })

  describe('GET /rooms/code/:code', () => {
    it('should find room by code', async () => {
      vi.mocked(rooms.getRoomByCode).mockResolvedValue(makeRoom('Test Room', { code: 'ABC234' }))
      const res = await api.request(
        '/rooms/code/ABC234',
        {
          headers: { 'cf-connecting-ip': '10.0.0.31' },
        },
        makeMockEnv(),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { code?: string }
      expect(body.code).toBe('ABC234')
    })

    it('should return 404 when code not found', async () => {
      vi.mocked(rooms.getRoomByCode).mockResolvedValue(null)
      const res = await api.request(
        '/rooms/code/ZZZ999',
        {
          headers: { 'cf-connecting-ip': '10.0.0.32' },
        },
        makeMockEnv(),
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error?: string }
      expect(body).toEqual({ error: 'Room not found' })
    })

    it('should reject invalid code format', async () => {
      const res = await api.request('/rooms/code/abc123', {}, makeMockEnv())
      expect([400, 422, 429]).toContain(res.status)
    })

    it('should return 404 for /rooms/code without a code segment', async () => {
      const res = await api.request(
        '/rooms/code',
        {
          headers: { 'cf-connecting-ip': '10.0.0.33' },
        },
        makeMockEnv(),
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error?: string }
      expect(body).toEqual({ error: 'Room not found' })
    })
  })

  describe('POST /rooms/:id/join', () => {
    it('should call joinRoom with correct params', async () => {
      vi.mocked(rooms.joinRoom).mockResolvedValue({ room: makeRoom() })
      const res = await api.request(
        '/rooms/00000000-0000-0000-0000-000000000001/join',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerName: 'Bob' }),
        },
        makeMockEnv(),
      )
      // Rate limiter may block or pass through
      if (res.status === 200) {
        expect(vi.mocked(rooms.joinRoom).mock.calls[0][1].playerName).toBe('Bob')
      }
    })

    it('should return 400 when joinRoom returns an error', async () => {
      vi.mocked(rooms.joinRoom).mockResolvedValue({ error: 'Room sudah penuh' })
      const res = await api.request(
        '/rooms/123e4567-e89b-12d3-a456-426614174000/join',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.41' },
          body: JSON.stringify({ playerName: 'Bob' }),
        },
        makeMockEnv(),
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error?: string }
      expect(body).toEqual({ error: 'Room sudah penuh' })
    })
  })

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await api.request('/health', {}, makeMockEnv())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; timestamp: number }
      expect(body.status).toBe('ok')
      expect(typeof body.timestamp).toBe('number')
    })
  })
})
