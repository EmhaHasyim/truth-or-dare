import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock drizzle-orm so eq() and inArray() return { col, val } / { col, vals } shapes
// that resolve() in our drizzle-orm/d1 mock can understand.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: any, val: any) => ({ col, val })),
  inArray: vi.fn((col: any, vals: any[]) => ({ col, vals })),
  sql: vi.fn(),
}))

// ── Shared in-memory store ──
const store = {
  rooms: new Map<string, any>(),
  players: new Map<string, any>(),
}

// Helper: resolve a select query given a condition from eq() or inArray().
// inArray() is only used for getPlayersByRoomIds — filter by roomId.
// eq() is used for id, code, status lookups — match by column name.
function resolve(condition: any, table: 'rooms' | 'players') {
  const col = condition?.col
  const val = condition?.val
  const vals = condition?.vals as string[] | undefined
  const tableData = table === 'rooms' ? store.rooms : store.players
  const data = [...tableData.values()]

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
    return tableData.get(val) ? [tableData.get(val)] : []
  }
  if (colName === 'code') {
    return data.filter((r: any) => r.code === val)
  }
  // If column name doesn't match any known pattern, return all data
  // as a fallback (handles cases where col?.name returns unexpected value)
  return data
}

// ── Build a mock query builder that reads/writes the shared store ──
function makeDb(): any {
  return {
    insert: vi.fn((_: any) => ({
      values: vi.fn((values: any) => ({
        returning: vi.fn(() => {
          const id = values.id
          if (values.hostName !== undefined) {
            const room = { ...values, createdAt: values.createdAt ?? new Date() }
            store.rooms.set(id, room)
            return [room]
          }
          const player = { ...values }
          store.players.set(id, player)
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
        innerJoin: vi.fn(() => ({
          where: vi.fn((cond: any) => ({
            all: vi.fn(() => resolve(cond, 'players')),
          })),
        })),
        all: vi.fn(() => [...store.rooms.values()]),
        get: vi.fn(() => null),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({})) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({})) })) })),
    run: vi.fn(),
  }
}

// Mock drizzle-orm/d1 so drizzle() returns the same shape as makeDb().
// This ensures api/rooms.ts can call db.select(), db.insert(), etc.
vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => makeDb()),
}))

import { createRoom, getRoomById, getRoomByCode, joinRoom, listActiveRooms } from '../api/rooms'
import { MAX_PLAYERS } from '../constants'

beforeEach(() => {
  store.rooms.clear()
  store.players.clear()
})

describe('integration: room lifecycle', () => {
  it('create → find by code → join → list', async () => {
    // All functions accept a DbInstance (the result of drizzle()).
    // Since drizzle() is mocked to return makeDb(), we pass the same shape.
    const db = makeDb()
    const room = await createRoom(db, { name: 'Party', hostName: 'Alice' })
    expect(room.name).toBe('Party')
    expect(room.code).toHaveLength(6)
    expect(room.players).toHaveLength(1)

    const byCode = await getRoomByCode(db, room.code)
    expect(byCode).not.toBeNull()
    expect(byCode!.id).toBe(room.id)

    const joinRes = await joinRoom(db, { roomId: room.id, playerName: 'Bob' })
    expect('error' in joinRes).toBe(false)

    const active = await listActiveRooms(db)
    expect(active.some((r) => r.id === room.id)).toBe(true)
  })

  it('password protected room', async () => {
    const db = makeDb()
    const room = await createRoom(db, { name: 'Secret', hostName: 'Alice', password: 'pw' })
    expect(room.hasPassword).toBe(true)

    const wrong = await joinRoom(db, { roomId: room.id, playerName: 'Bob', password: 'bad' })
    expect('error' in wrong).toBe(true)
    if ('error' in wrong) expect(wrong.error).toContain('password')

    const ok = await joinRoom(db, { roomId: room.id, playerName: 'Bob', password: 'pw' })
    expect('error' in ok).toBe(false)
  })

  it('debug: join then check capacity', async () => {
    const db = makeDb()
    const room = await createRoom(db, { name: 'T', hostName: 'A' })
    expect(store.players.size).toBe(1)

    // Join first extra player (P2) — should succeed
    const join1 = await joinRoom(db, { roomId: room.id, playerName: 'P2' })
    expect('error' in join1).toBe(false)
    expect(store.players.size).toBe(2)

    // Verify players in store have correct roomId
    for (const [, p] of store.players) {
      expect(p.roomId).toBe(room.id)
    }

    // Room has maxPlayers=2, so the next join should fail
    const join2 = await joinRoom(db, { roomId: room.id, playerName: 'Extra' })
    expect('error' in join2).toBe(true)
  })

  it('room capacity enforcement', async () => {
    const db = makeDb()
    const room = await createRoom(db, { name: 'T', hostName: 'A' })

    for (let i = 2; i <= MAX_PLAYERS; i++) {
      const r = await joinRoom(db, { roomId: room.id, playerName: `P${i}` })
      expect('error' in r, `join P${i} should succeed`).toBe(false)
    }

    const full = await joinRoom(db, { roomId: room.id, playerName: 'Extra' })
    expect('error' in full).toBe(true)
  })

  it('duplicate name rejection', async () => {
    const db = makeDb()
    const room = await createRoom(db, { name: 'T', hostName: 'Alice' })
    const dup = await joinRoom(db, { roomId: room.id, playerName: 'Alice' })
    expect('error' in dup).toBe(true)
    if ('error' in dup) expect(dup.error).toContain('already taken')
  })

  it('non-existent room operations', async () => {
    const db = makeDb()
    const fake = '00000000-0000-0000-0000-000000000000'
    expect(await getRoomById(db, fake)).toBeNull()
    expect(await getRoomByCode(db, 'XXXXXX')).toBeNull()

    const joinRes = await joinRoom(db, { roomId: fake, playerName: 'Bob' })
    expect('error' in joinRes).toBe(true)
  })
})
