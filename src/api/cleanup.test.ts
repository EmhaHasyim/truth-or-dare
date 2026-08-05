import { describe, it, expect, vi } from 'vitest'
import { cleanupStaleRooms } from './cleanup'

function makeFakeDb(staleIds: string[] = []) {
  // `prepared` records every db.prepare() call; `bound` only those with params.
  const prepared: string[] = []
  const bound: { sql: string; params: unknown[] }[] = []
  const stmt = {
    all: vi.fn(async () => ({ results: staleIds.map((id) => ({ id })), success: true })),
    run: vi.fn(async () => ({ success: true })),
  }
  const db = {
    prepare: vi.fn((sql: string) => {
      prepared.push(sql)
      return {
        bind: vi.fn((...params: unknown[]) => {
          bound.push({ sql, params })
          return stmt
        }),
      }
    }),
    batch: vi.fn(async () => []),
  }
  return { db: db as unknown as D1Database, prepared, bound }
}

describe('cleanupStaleRooms', () => {
  it('should return 0 and skip deletes when no stale rooms exist', async () => {
    const { db } = makeFakeDb([])
    const deleted = await cleanupStaleRooms(db)
    expect(deleted).toBe(0)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('should delete stale rooms and their dependent rows in dependency order', async () => {
    const { db, bound } = makeFakeDb(['room-1', 'room-2'])
    const deleted = await cleanupStaleRooms(db, Date.now())
    expect(deleted).toBe(2)
    expect(db.batch).toHaveBeenCalledTimes(1)

    const batchStatements = (db.batch as any).mock.calls[0][0] as unknown[]
    expect(batchStatements.length).toBe(7)

    // The first statement is the SELECT that discovers stale rooms.
    const sqls = bound.map((c) => c.sql)
    const select = bound[0]
    expect(select.sql).toContain('SELECT id FROM rooms')
    expect(select.params).toHaveLength(2)

    // Each targeted delete references its dependency first (turns → games → players → rooms).
    const turnsIdx = sqls.findIndex((s) => s.includes('DELETE FROM turns'))
    const gamesIdx = sqls.findIndex((s) => s.includes('DELETE FROM games'))
    const playersIdx = sqls.findIndex((s) => s.includes('DELETE FROM players'))
    const roomsIdx = sqls.findIndex((s) => s.includes('DELETE FROM rooms'))
    expect(turnsIdx).toBeGreaterThan(-1)
    expect(gamesIdx).toBeGreaterThan(turnsIdx)
    expect(playersIdx).toBeGreaterThan(gamesIdx)
    expect(roomsIdx).toBeGreaterThan(playersIdx)
  })

  it('should include an orphan sweep for rows whose room no longer exists', async () => {
    const { db, prepared } = makeFakeDb(['room-1'])
    await cleanupStaleRooms(db, Date.now())
    expect(prepared.some((s) => s.includes('DELETE FROM players WHERE room_id NOT IN'))).toBe(true)
    expect(prepared.some((s) => s.includes('DELETE FROM games WHERE room_id NOT IN'))).toBe(true)
    expect(prepared.some((s) => s.includes('DELETE FROM turns WHERE game_id NOT IN'))).toBe(true)
  })
})
