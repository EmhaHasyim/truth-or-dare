import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoom, getRoomById, getRoomByCode, listActiveRooms, joinRoom } from './rooms'
import { MAX_PLAYERS } from '../constants'
import type { DbInstance } from '../db'

// In-memory store for mock DB
const store = {
  rooms: new Map<string, any>(),
  players: new Map<string, any>(),
}

// Mock eq to return { col, val } — used by the mock where() handler
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: any, val: any) => ({ col, val })),
  inArray: vi.fn((col: any, vals: any[]) => ({ col, vals })),
  sql: vi.fn(),
}))

// Mock drizzle/d1 to return our custom DB instance
vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => createMockDb()),
}))

vi.mock('../db', () => ({
  createDb: vi.fn(() => createMockDb()),
  schema: {
    rooms: { id: 'rooms.id', code: 'rooms.code' },
    players: {
      id: 'players.id',
      roomId: 'players.roomId',
      name: 'players.name',
      isHost: 'players.isHost',
    },
    questions: {},
    games: {},
    turns: {},
  },
}))

vi.mock('../lib/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi.fn(async (pw: string, stored: string) => stored === `hashed:${pw}`),
  isValidPassword: vi.fn((pw: string) => pw.length >= 8 && pw.length <= 128),
}))

function createMockDb(): DbInstance {
  // Build a set of chainable query builders
  const makeInsert = () => ({
    values: vi.fn((values: any) => {
      const id = values.id
      const record = { ...values }
      if (values.hostName !== undefined) {
        // It's a room
        record.createdAt = record.createdAt || new Date()
        store.rooms.set(id, record)
      } else {
        // It's a player
        store.players.set(id, record)
      }
      return {
        returning: vi.fn(() => [record]),
        onConflictDoNothing: vi.fn(() => {}),
      }
    }),
  })

  const makeSelectResult = (condition: any) => {
    // Handle both eq() → { col, val } and inArray() → { col, vals }
    const col = condition?.col ?? ''
    const colStr = String(col)

    // For eq() results, use condition.val; for inArray() results, use condition.vals
    const lookupVal: any = condition?.val ?? condition?.vals ?? ''

    const qb: any = {
      all: vi.fn(() => {
        if (colStr.includes('roomId')) {
          // Support both single roomId (eq) and array of roomIds (inArray)
          const roomIds = Array.isArray(lookupVal) ? lookupVal : [lookupVal]
          return Array.from(store.players.values()).filter((p) => roomIds.includes(p.roomId))
        }
        if (colStr.includes('status')) {
          return Array.from(store.rooms.values())
        }
        return Array.from(store.rooms.values())
      }),
      get: vi.fn(() => {
        // Look up by room ID
        if (colStr.includes('.id') || colStr === 'id') {
          return store.rooms.get(lookupVal) || null
        }
        // Look up by code
        if (colStr.includes('.code') || colStr === 'code') {
          for (const room of store.rooms.values()) {
            if (room.code === lookupVal) return room
          }
          return null
        }
        // Look up by player ID
        return store.players.get(lookupVal) || null
      }),
    }
    return qb
  }

  const db: any = {
    insert: vi.fn(() => makeInsert()),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: any) => makeSelectResult(condition)),
        innerJoin: vi.fn(() => ({
          where: vi.fn((condition: any) => makeSelectResult(condition)),
        })),
        all: vi.fn(() => Array.from(store.rooms.values())),
        get: vi.fn(() => null),
        limit: vi.fn(() => ({
          get: vi.fn(() => null),
          all: vi.fn(() => []),
        })),
      })),
      where: vi.fn((condition: any) => makeSelectResult(condition)),
      limit: vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({})),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({})),
      })),
    })),
    run: vi.fn(),
  }
  return db as unknown as DbInstance
}

let uuidCtr = 0

beforeEach(() => {
  store.rooms.clear()
  store.players.clear()
  uuidCtr = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    uuidCtr++
    return `00000000-0000-0000-0000-${String(uuidCtr).padStart(12, '0')}`
  })
})

describe('createRoom', () => {
  it('should create a room with the given parameters', async () => {
    const db = createMockDb()
    const room = await createRoom(db, {
      name: 'Test Game',
      hostName: 'Alice',
    })

    expect(room).toBeDefined()
    expect(room.name).toBe('Test Game')
    expect(room.hostName).toBe('Alice')
    expect(room.maxPlayers).toBe(MAX_PLAYERS)
    expect(room.hasPassword).toBe(false)
    expect(room.status).toBe('waiting')
    expect(room.code).toHaveLength(6)
    expect(room.players).toHaveLength(1)
    expect(room.players[0].name).toBe('Alice')
    expect(room.players[0].isHost).toBe(true)
  })

  it('should create a password-protected room', async () => {
    const db = createMockDb()
    const room = await createRoom(db, {
      name: 'Secret Game',
      hostName: 'Bob',
      password: 'secret123',
    })

    expect(room.hasPassword).toBe(true)
  })

  it('should generate different codes for different rooms', async () => {
    const db = createMockDb()
    const room1 = await createRoom(db, { name: 'Game 1', hostName: 'Alice' })
    const room2 = await createRoom(db, { name: 'Game 2', hostName: 'Bob' })

    expect(room1.code).toHaveLength(6)
    expect(room2.code).toHaveLength(6)
    expect(room1.code).not.toBe(room2.code)
  })
})

describe('getRoomById', () => {
  it('should return null for non-existent room', async () => {
    const db = createMockDb()
    const room = await getRoomById(db, 'nonexistent-id')
    expect(room).toBeNull()
  })

  it('should return a created room with its players', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Test', hostName: 'Alice' })
    const found = await getRoomById(db, created.id)

    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('Test')
    expect(found!.players).toHaveLength(1)
  })
})

describe('getRoomByCode', () => {
  it('should return null for non-existent code', async () => {
    const db = createMockDb()
    const room = await getRoomByCode(db, 'XXXXXX')
    expect(room).toBeNull()
  })

  it('should find a room by its code', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Code Test', hostName: 'Alice' })
    const found = await getRoomByCode(db, created.code)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
  })
})

describe('joinRoom', () => {
  it('should allow a player to join an open room', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Test', hostName: 'Alice' })
    const result = await joinRoom(db, {
      roomId: created.id,
      playerName: 'Bob',
    })

    expect('error' in result).toBe(false)
    if ('room' in result) {
      expect(result.room.players).toHaveLength(2)
      expect(result.room.players[1].name).toBe('Bob')
    }
  })

  it('should reject joining a non-existent room', async () => {
    const db = createMockDb()
    const result = await joinRoom(db, {
      roomId: '00000000-0000-0000-0000-000000000000',
      playerName: 'Bob',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('not found')
    }
  })

  it('should reject joining a full room', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Test', hostName: 'Alice' })
    // Room has maxPlayers=2, so first join should work
    await joinRoom(db, { roomId: created.id, playerName: 'Bob' })
    // Second join should be rejected
    const result = await joinRoom(db, {
      roomId: created.id,
      playerName: 'Charlie',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('full')
    }
  })

  it('should reject joining a room that is not waiting', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Test', hostName: 'Alice' })
    // Manually set room status to 'playing'
    created.status = 'playing'
    ;(created as any).passwordHash = null
    store.rooms.set(created.id, { ...created, status: 'playing' })

    const result = await joinRoom(db, {
      roomId: created.id,
      playerName: 'Bob',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('not accepting')
    }
  })

  it('should reject duplicate name in the same room', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Test', hostName: 'Alice' })
    const result = await joinRoom(db, {
      roomId: created.id,
      playerName: 'Alice',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('already taken')
    }
  })

  it('should reject incorrect password', async () => {
    const db = createMockDb()
    const created = await createRoom(db, {
      name: 'Secret',
      hostName: 'Alice',
      password: 'correct-pw',
    })

    const result = await joinRoom(db, {
      roomId: created.id,
      playerName: 'Bob',
      password: 'wrong-pw',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('password')
    }
  })

  it('should join with correct password', async () => {
    const db = createMockDb()
    const created = await createRoom(db, {
      name: 'Secret',
      hostName: 'Alice',
      password: 'correct-pw',
    })

    const result = await joinRoom(db, {
      roomId: created.id,
      playerName: 'Bob',
      password: 'correct-pw',
    })

    expect('error' in result).toBe(false)
    if ('room' in result) {
      expect(result.room.players).toHaveLength(2)
    }
  })
})

describe('listActiveRooms', () => {
  it('should return empty list when no rooms exist', async () => {
    const db = createMockDb()
    const rooms = await listActiveRooms(db)
    expect(rooms).toEqual([])
  })

  it('should return created rooms', async () => {
    const db = createMockDb()
    await createRoom(db, { name: 'Game 1', hostName: 'Alice' })
    await createRoom(db, { name: 'Game 2', hostName: 'Bob' })

    const rooms = await listActiveRooms(db)
    expect(rooms.length).toBe(2)
  })

  it('should return a room with an empty players list when it has no players', async () => {
    const db = createMockDb()
    // Insert a room row directly, with no player rows at all
    db.insert({
      id: 'r-orphan',
      code: 'ZZZ123',
      name: 'Empty Room',
      hostName: 'Nobody',
      maxPlayers: 2,
      passwordHash: null,
      status: 'waiting',
      createdAt: new Date(),
    } as any).values({
      id: 'r-orphan',
      code: 'ZZZ123',
      name: 'Empty Room',
      hostName: 'Nobody',
      maxPlayers: 2,
      passwordHash: null,
      status: 'waiting',
      createdAt: new Date(),
    })

    const rooms = await listActiveRooms(db)
    const empty = rooms.find((r) => r.id === 'r-orphan')
    expect(empty).toBeDefined()
    expect(empty!.players).toEqual([])
  })
})

describe('createRoom unique violation handling', () => {
  it('should retry when code collides with a unique constraint', async () => {
    const db = createMockDb()
    // Make the first insert throw a unique violation, second succeeds
    let insertCount = 0
    const origInsert = db.insert as any
    db.insert = vi.fn(() => {
      insertCount++
      if (insertCount === 1) {
        throw new Error('UNIQUE constraint failed: rooms.code')
      }
      return origInsert()
    }) as any

    const room = await createRoom(db, { name: 'Test', hostName: 'Alice' })
    expect(room).toBeDefined()
    expect(room.name).toBe('Test')
    expect(insertCount).toBeGreaterThan(1)
  })

  it('should rethrow non-unique errors', async () => {
    const db = createMockDb()
    db.insert = vi.fn(() => {
      throw new Error('Database exploded')
    }) as any

    await expect(createRoom(db, { name: 'Test', hostName: 'Alice' })).rejects.toThrow(
      'Database exploded',
    )
  })

  it('should clean up orphaned room when player insert fails', async () => {
    const db = createMockDb()
    const origInsert = db.insert as any
    const deleteSpy = db.delete as any

    // First insert (room) succeeds, second insert (player) throws
    let insertCount = 0
    db.insert = vi.fn(() => {
      insertCount++
      if (insertCount === 1) return origInsert()
      throw new Error('Player insert failed')
    }) as any

    await expect(createRoom(db, { name: 'Test', hostName: 'Alice' })).rejects.toThrow(
      'Player insert failed',
    )
    expect(deleteSpy).toHaveBeenCalled()
  })
})

describe('joinRoom unique violation handling', () => {
  it('should return name taken error on unique violation during join', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Test', hostName: 'Alice' })

    // Make player insert throw a unique constraint violation
    db.insert = vi.fn(() => {
      throw new Error('UNIQUE constraint failed: players.room_id, players.name')
    }) as any

    const result = await joinRoom(db, {
      roomId: created.id,
      playerName: 'Bob',
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('already taken')
    }
  })

  it('should rethrow non-unique errors during join', async () => {
    const db = createMockDb()
    const created = await createRoom(db, { name: 'Test', hostName: 'Alice' })

    db.insert = vi.fn(() => {
      throw new Error('Database exploded')
    }) as any

    await expect(joinRoom(db, { roomId: created.id, playerName: 'Bob' })).rejects.toThrow(
      'Database exploded',
    )
  })
})
