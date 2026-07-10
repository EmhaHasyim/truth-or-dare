import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TURN_TIMEOUT_MS } from '../constants'
import type { ServerMessage } from '../types/ws'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: any
    env: any
    constructor(ctx: any, env: any) {
      this.ctx = ctx
      this.env = env
    }
  },
}))

// Mock drizzle-orm/d1 so RoomDO's Drizzle calls use our controlled mock DB
// instead of trying to call this.env.DB.prepare() (which would fail with an empty env mock).
vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{}]),
        onConflictDoNothing: vi.fn(),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          all: vi.fn(() => []),
          get: vi.fn(() => null),
        })),
        all: vi.fn(() => []),
        get: vi.fn(() => null),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({})),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({})),
    })),
  })),
}))

import { RoomDO } from './room-do'

// ── In-memory SQL storage ──
class MockSqlStorage {
  tables: Record<string, Map<string, any>> = {
    meta: new Map(),
    players: new Map(),
    game: new Map(),
    used_questions: new Map(),
  }

  exec<T = any>(sqlStr: string, ...params: any[]) {
    sqlStr = sqlStr.trim()
    const tableMap: Record<string, string> = {
      meta: 'meta', players: 'players', game: 'game', used_questions: 'used_questions',
    }
    const tbl = Object.keys(tableMap).find(t => sqlStr.toUpperCase().includes(t.toUpperCase()))
    const table = tbl ? this.tables[tbl] : null

    // CREATE TABLE
    if (sqlStr.toUpperCase().includes('CREATE TABLE')) {
      return { toArray: () => [] }
    }

    // INSERT OR REPLACE INTO
    if (sqlStr.startsWith('INSERT OR REPLACE')) {
      if (table && params.length >= 2 && table === this.tables.meta) {
        table.set(params[0], { value: params[1] })
      } else if (table && params.length >= 2 && table === this.tables.players) {
        table.set(params[0], { id: params[0], name: params[1], is_host: params[2] })
      } else if (table && params.length >= 6 && table === this.tables.game) {
        table.set(params[0], {
          id: params[0], room_id: params[1], status: params[2],
          player_order: params[3], current_player_index: params[4], round: params[5],
        })
      } else if (table && params.length >= 2 && table === this.tables.used_questions) {
        table.set(`${params[0]}_${params[1]}`, { player_id: params[0], question_id: params[1] })
      }
      return { toArray: () => [] }
    }

    // INSERT OR IGNORE
    if (sqlStr.startsWith('INSERT OR IGNORE')) {
      if (table && !table.has(params[0])) {
        table.set(params[0], { value: params[1] })
      }
      return { toArray: () => [] }
    }

    // Helper: extract LIKE pattern from SQL string or params
    function getLikePattern(): string | null {
      if (params.length > 0 && typeof params[0] === 'string') return params[0]
      const match = sqlStr.match(/LIKE\s+'([^']+)'/i)
      return match ? match[1] : null
    }

    // DELETE
    if (sqlStr.startsWith('DELETE')) {
      if (sqlStr.includes('WHERE key LIKE')) {
        const pattern = getLikePattern()
        if (pattern) {
          const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$')
          for (const k of [...this.tables.meta.keys()]) {
            if (regex.test(k)) this.tables.meta.delete(k)
          }
        }
      } else if (sqlStr.includes('WHERE key =')) {
        const key = params[0]
        if (key && table) table.delete(key)
      } else if (sqlStr.includes('WHERE id =')) {
        const id = params[0]
        if (id && table) table.delete(id)
      } else if (sqlStr.includes('FROM') && table) {
        table.clear()
      } else if (table) {
        table.clear()
      }
      return { toArray: () => [] }
    }

    // SELECT
    if (sqlStr.startsWith('SELECT')) {
      if (sqlStr.includes('WHERE key =')) {
        const key = params[0]
        const val = key ? this.tables.meta.get(key) : null
        return { toArray: () => val ? [val] : [] }
      }
      if (sqlStr.includes('WHERE key LIKE')) {
        const pattern = getLikePattern()
        if (!pattern) return { toArray: () => [] }
        const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$')
        const results = [...this.tables.meta.entries()]
          .filter(([k]) => regex.test(k)).map(([, v]) => v)
        return { toArray: () => results }
      }
      if (sqlStr.includes('WHERE player_id =')) {
        const pid = params[0]
        const results = [...this.tables.used_questions.values()].filter(r => r.player_id === pid)
        return { toArray: () => results }
      }
      // SELECT * FROM players
      if (sqlStr.includes('FROM players')) {
        return { toArray: () => [...this.tables.players.values()] }
      }
      // SELECT ... FROM game WHERE status = ?
      if (sqlStr.includes('FROM game') && sqlStr.includes('WHERE status =')) {
        const status = params[0]
        const results = [...this.tables.game.values()].filter(g => g.status === status)
        return { toArray: () => results }
      }
      // SELECT ... FROM game (all)
      if (sqlStr.includes('FROM game')) {
        return { toArray: () => [...this.tables.game.values()] }
      }
      // SELECT ... FROM used_questions
      if (sqlStr.includes('FROM used_questions')) {
        return { toArray: () => [...this.tables.used_questions.values()] }
      }
      return { toArray: () => [] }
    }

    // UPDATE game
    if (sqlStr.startsWith('UPDATE game')) {
      if (sqlStr.includes('SET status =')) {
        const status = params[0]
        for (const g of this.tables.game.values()) g.status = status
      } else if (sqlStr.includes('SET current_player_index')) {
        const idx = params[0], round = params[1]
        for (const g of this.tables.game.values()) {
          g.current_player_index = idx
          g.round = round
        }
      }
      return { toArray: () => [] }
    }

    return { toArray: () => [] }
  }
}

function createMockDOState(store: MockSqlStorage): DurableObjectState {
  return {
    storage: {
      sql: { exec: store.exec.bind(store) } as any,
      deleteAlarm: vi.fn().mockResolvedValue(undefined),
      setAlarm: vi.fn().mockResolvedValue(undefined),
      getAlarm: vi.fn().mockResolvedValue(null),
      sync: vi.fn().mockResolvedValue(undefined),
    },
    blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
    id: { toString: () => 'mock-do', name: 'mock-do', equals: vi.fn() },
    tags: [] as string[],
  } as unknown as DurableObjectState
}

function makeMockEnv() {
  return { DB: {} as unknown as D1Database, ROOM_DO: {} as any }
}

function makeWS(pid: string): WebSocket {
  const att: any = { playerId: pid, playerName: `P-${pid.slice(0, 8)}`, isHost: false }
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn((a: any) => Object.assign(att, a)),
    deserializeAttachment: vi.fn(() => ({ ...att })),
    readyState: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    url: '', protocol: '', extensions: '', binaryType: 'blob' as BinaryType,
    bufferedAmount: 0, onopen: null, onclose: null, onerror: null, onmessage: null,
  } as unknown as WebSocket
}

interface MockRoom {
  room: RoomDO
  store: MockSqlStorage
  ws: WebSocket[]
  wsMap: Map<string, WebSocket>
  msgs: ServerMessage[]
}

async function createRoom(players: { name: string; isHost?: boolean }[] = [{ name: 'host', isHost: true }]): Promise<MockRoom> {
  const store = new MockSqlStorage()
  store.tables.meta.set('room_id', { value: 'test-room-id' })
  store.tables.meta.set('room_host', { value: players[0]?.name ?? '' })
  const state = createMockDOState(store)
  const env = makeMockEnv()
  const room = new RoomDO(state, env)
  ;(room as any).roomId = 'test-room-id'

  const ws: WebSocket[] = []
  const wsMap = new Map<string, WebSocket>()
  const msgs: ServerMessage[] = []

  for (const p of players) {
    const pid = crypto.randomUUID()
    const w = makeWS(pid)
    const sess = { playerId: pid, playerName: p.name, isHost: p.isHost ?? false }
    ;(w as any).deserializeAttachment = vi.fn(() => ({ ...sess }))
    ;(w as any).send = vi.fn((msg: string) => {
      try { msgs.push(JSON.parse(msg)) } catch {}
    })
    room['sessions'].set(w, sess as any)
    room['playerSockets'].set(pid, w)
    store.tables.players.set(pid, { id: pid, name: p.name, is_host: p.isHost ? 1 : 0 })
    ws.push(w)
    wsMap.set(pid, w)
  }
  return { room, store, ws, wsMap, msgs }
}

describe('RoomDO', () => {
  let uuidCtr = 0

  beforeEach(() => {
    uuidCtr = 0
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      uuidCtr++
      return `00000000-0000-0000-0000-${String(uuidCtr).padStart(12, '0')}`
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should create storage tables on construction', () => {
      const store = new MockSqlStorage()
      new RoomDO(createMockDOState(store), makeMockEnv())
      // No error = success
    })

    it('should restore roomId from meta', () => {
      const store = new MockSqlStorage()
      store.tables.meta.set('room_id', { value: 'my-room' })
      const room = new RoomDO(createMockDOState(store), makeMockEnv())
      expect((room as any).roomId).toBe('my-room')
    })
  })

  describe('getPlayers', () => {
    it('should return empty when no players', async () => {
      const m = await createRoom([])
      expect(m.room['getPlayers']()).toEqual([])
    })

    it('should return stored players', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }, { name: 'Bob' }])
      const pl = m.room['getPlayers']()
      expect(pl).toHaveLength(2)
      expect(pl.map(p => p.name).sort()).toEqual(['Alice', 'Bob'])
    })
  })

  describe('start game', () => {
    it('should reject start by non-host', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }, { name: 'Bob' }])
      const bob = [...m.room['sessions'].values()].find(s => s.playerName === 'Bob')!
      await m.room['handleStartGame'](bob)
      expect(m.msgs.some(m => m.type === 'error')).toBe(true)
    })

    it('should reject start with 1 player', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }])
      const host = [...m.room['sessions'].values()][0]
      await m.room['handleStartGame'](host)
      expect(m.msgs.some(m => m.type === 'error')).toBe(true)
    })

    it('should start game with 2 players', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }, { name: 'Bob' }])
      const host = [...m.room['sessions'].values()].find(s => s.isHost)!
      await m.room['handleStartGame'](host)
      expect(m.msgs.some(m => m.type === 'game_started')).toBe(true)
    })
  })

  describe('game flow', () => {
    /** Helper: find the current player's session after handleStartGame */
    function getCurrentSess(m: MockRoom) {
      const gs = m.msgs.find(m => m.type === 'game_started') as any
      if (!gs) return null
      return [...m.room['sessions'].values()].find(s => s.playerId === gs.playerOrder[0]) || null
    }

    it('should assign truth question to current player', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find(s => s.isHost)!
      await m.room['handleStartGame'](host)
      const curr = getCurrentSess(m)!
      await m.room['handleSelectType'](curr, 'truth')
      const q = m.msgs.find(m => m.type === 'turn_question')
      expect(q).toBeDefined()
      expect((q as any).questionType).toBe('truth')
    })

    it('should complete turn and advance to next player', async () => {
      vi.useRealTimers()
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find(s => s.isHost)!
      await m.room['handleStartGame'](host)
      const curr = getCurrentSess(m)!
      await m.room['handleSelectType'](curr, 'truth')
      m.msgs.length = 0
      await m.room['handleTurnDone'](curr, 'completed')
      const afterTypes = m.msgs.map(m => m.type)
      expect(afterTypes.length).toBeGreaterThan(0)
      expect(afterTypes).toContain('turn_result')
    }, 10000)

    it('should end game and broadcast game_ended', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find(s => s.isHost)!
      await m.room['handleStartGame'](host)
      m.msgs.length = 0
      await m.room['handleEndGame'](host)
      expect(m.msgs.some(m => m.type === 'game_ended')).toBe(true)
    })

    it('should auto-skip turn after timeout', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find(s => s.isHost)!
      await m.room['handleStartGame'](host)
      const curr = getCurrentSess(m)!
      await m.room['handleSelectType'](curr, 'truth')
      m.msgs.length = 0
      await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS + 100)
      await vi.advanceTimersByTimeAsync(3000)
      expect(m.msgs.some(m => m.type === 'turn_result' && (m as any).status === 'skipped')).toBe(true)
    })
  })

  describe('webSocketMessage', () => {
    it('should route start_game', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      await m.room.webSocketMessage(m.ws[0], JSON.stringify({ type: 'start_game' }))
      expect(m.msgs.some(m => m.type === 'game_started')).toBe(true)
    })

    it('should error on invalid JSON', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }])
      await m.room.webSocketMessage(m.ws[0], '{bad}')
      expect(m.msgs.some(m => m.type === 'error')).toBe(true)
    })

    it('should error on unknown type', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }])
      await m.room.webSocketMessage(m.ws[0], JSON.stringify({ type: 'unknown' }))
      expect(m.msgs.some(m => m.type === 'error')).toBe(true)
    })
  })
})
