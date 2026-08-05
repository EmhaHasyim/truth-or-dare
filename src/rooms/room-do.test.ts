import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TURN_TIMEOUT_MS, DISCONNECT_GRACE_MS, EMPTY_ROOM_TIMEOUT, MAX_ROUNDS } from '../constants'
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
// mockD1 holds per-table data + a one-shot failure injection used by error-path tests.
const mockD1 = vi.hoisted(() => ({
  players: [] as any[],
  rooms: [] as any[],
  questions: [] as any[],
  games: [] as any[],
  turns: [] as any[],
  fail: null as null | { op: 'insert' | 'update' | 'delete' | 'select'; error?: Error },
}))

vi.mock('drizzle-orm/d1', () => {
  const tableOf = (t: any): string => {
    if (!t) return 'players'
    if ('playerOrder' in t) return 'games'
    if ('hostName' in t) return 'rooms'
    if ('text' in t) return 'questions'
    if ('isHost' in t) return 'players'
    if ('gameId' in t) return 'turns'
    return 'players'
  }
  const maybeFail = (op: 'insert' | 'update' | 'delete' | 'select') => {
    if (mockD1.fail?.op === op) {
      const err = mockD1.fail.error ?? new Error(`mock drizzle ${op} failure`)
      mockD1.fail = null // one-shot
      throw err
    }
  }
  const tableData = (key: string): any[] => (mockD1 as any)[key] ?? []
  return {
    drizzle: vi.fn(() => ({
      insert: vi.fn(() => ({
        values: vi.fn(() => {
          maybeFail('insert')
          return {
            returning: vi.fn(() => [{}]),
            onConflictDoNothing: vi.fn(() => undefined),
          }
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn((t: any) => {
          const key = tableOf(t)
          return {
            where: vi.fn(() => ({
              all: vi.fn(() => {
                maybeFail('select')
                return [...tableData(key)]
              }),
              get: vi.fn(() => {
                maybeFail('select')
                return tableData(key)[0] ?? null
              }),
            })),
            all: vi.fn(() => {
              maybeFail('select')
              return [...tableData(key)]
            }),
            get: vi.fn(() => {
              maybeFail('select')
              return tableData(key)[0] ?? null
            }),
          }
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => {
            maybeFail('update')
            return undefined
          }),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => {
          maybeFail('delete')
          return undefined
        }),
      })),
    })),
  }
})

import { RoomDO } from './room-do'
import * as schema from '../db/schema'

// ── In-memory SQL storage ──
class MockSqlStorage {
  tables: Record<string, Map<string, any>> = {
    meta: new Map(),
    players: new Map(),
    game: new Map(),
    used_questions: new Map(),
    question_cache: new Map(),
  }

  exec(sqlStr: string, ...params: any[]) {
    sqlStr = sqlStr.trim()
    const tableMap: Record<string, string> = {
      meta: 'meta',
      players: 'players',
      game: 'game',
      used_questions: 'used_questions',
      question_cache: 'question_cache',
    }
    const tbl = Object.keys(tableMap).find((t) => sqlStr.toUpperCase().includes(t.toUpperCase()))
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
          id: params[0],
          room_id: params[1],
          status: params[2],
          player_order: params[3],
          current_player_index: params[4],
          round: params[5],
        })
      } else if (table && params.length >= 2 && table === this.tables.used_questions) {
        table.set(`${params[0]}_${params[1]}`, { player_id: params[0], question_id: params[1] })
      }
      return { toArray: () => [] }
    }

    // INSERT OR IGNORE
    if (sqlStr.startsWith('INSERT OR IGNORE')) {
      if (sqlStr.includes('question_cache')) {
        const q = table ?? this.tables.question_cache
        if (q && !q.has(params[0])) {
          q.set(params[0], { id: params[0], type: params[1], text: params[2] })
        }
      } else if (table && !table.has(params[0])) {
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
        return { toArray: () => (val ? [val] : []) }
      }
      if (sqlStr.includes('WHERE key LIKE')) {
        const pattern = getLikePattern()
        if (!pattern) return { toArray: () => [] }
        const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$')
        const results = [...this.tables.meta.entries()]
          .filter(([k]) => regex.test(k))
          .map(([, v]) => v)
        return { toArray: () => results }
      }
      if (sqlStr.includes('WHERE player_id =')) {
        const pid = params[0]
        const results = [...this.tables.used_questions.values()].filter((r) => r.player_id === pid)
        return { toArray: () => results }
      }
      // SELECT COUNT(*) AS c FROM question_cache
      if (sqlStr.includes('FROM question_cache') && sqlStr.includes('COUNT')) {
        return { toArray: () => [{ c: this.tables.question_cache.size }] }
      }
      // SELECT id, text FROM question_cache WHERE type = ?
      if (sqlStr.includes('FROM question_cache') && sqlStr.includes('WHERE type')) {
        const type = params[0]
        const rows = [...this.tables.question_cache.values()].filter((q) => q.type === type)
        return { toArray: () => rows }
      }
      // SELECT * FROM players
      if (sqlStr.includes('FROM players')) {
        return { toArray: () => [...this.tables.players.values()] }
      }
      // SELECT ... FROM game WHERE status = ?
      if (sqlStr.includes('FROM game') && sqlStr.includes('WHERE status =')) {
        const status = params[0]
        const results = [...this.tables.game.values()].filter((g) => g.status === status)
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
        const idx = params[0],
          round = params[1]
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
  return {
    // prepare() is used by onPlayerConnected to bump rooms.last_active_at.
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ run: vi.fn(async () => ({ success: true })) })),
      })),
    } as unknown as D1Database,
    ROOM_DO: {} as any,
  }
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
    url: '',
    protocol: '',
    extensions: '',
    binaryType: 'blob' as BinaryType,
    bufferedAmount: 0,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  } as unknown as WebSocket
}

interface MockRoom {
  room: RoomDO
  store: MockSqlStorage
  ws: WebSocket[]
  wsMap: Map<string, WebSocket>
  msgs: ServerMessage[]
}

async function createRoom(
  players: { name: string; isHost?: boolean }[] = [{ name: 'host', isHost: true }],
): Promise<MockRoom> {
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
      try {
        msgs.push(JSON.parse(msg))
      } catch {}
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
    mockD1.players = []
    mockD1.rooms = []
    mockD1.questions = []
    mockD1.games = []
    mockD1.turns = []
    mockD1.fail = null
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      uuidCtr++
      return `00000000-0000-0000-0000-${String(uuidCtr).padStart(12, '0')}`
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
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

  describe('findDisconnectedPlayer', () => {
    it('should return null when no reconnect marker exists', async () => {
      const m = await createRoom()
      expect(m.room['findDisconnectedPlayer']('nobody')).toBeNull()
    })

    it('should return the stored name and host flag from a marker', async () => {
      const m = await createRoom()
      m.store.tables.meta.set('disconnected_player_p1', {
        value: JSON.stringify({ name: 'Alice', isHost: true }),
      })
      expect(m.room['findDisconnectedPlayer']('p1')).toEqual({ name: 'Alice', isHost: true })
    })

    it('should return null for malformed marker JSON', async () => {
      const m = await createRoom()
      m.store.tables.meta.set('disconnected_player_p1', { value: '{bad json' })
      expect(m.room['findDisconnectedPlayer']('p1')).toBeNull()
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
      expect(pl.map((p) => p.name).sort()).toEqual(['Alice', 'Bob'])
    })
  })

  describe('start game', () => {
    it('should reject start by non-host', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }, { name: 'Bob' }])
      const bob = [...m.room['sessions'].values()].find((s) => s.playerName === 'Bob')!
      await m.room['handleStartGame'](bob)
      expect(m.msgs.some((m) => m.type === 'error')).toBe(true)
    })

    it('should reject start with 1 player', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }])
      const host = [...m.room['sessions'].values()][0]
      await m.room['handleStartGame'](host)
      expect(m.msgs.some((m) => m.type === 'error')).toBe(true)
    })

    it('should start game with 2 players', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }, { name: 'Bob' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      expect(m.msgs.some((m) => m.type === 'game_started')).toBe(true)
    })
  })

  describe('game flow', () => {
    /** Helper: find the current player's session after handleStartGame */
    function getCurrentSess(m: MockRoom) {
      const gs = m.msgs.find((m) => m.type === 'game_started') as any
      if (!gs) return null
      return [...m.room['sessions'].values()].find((s) => s.playerId === gs.playerOrder[0]) || null
    }

    it('should assign truth question to current player', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const curr = getCurrentSess(m)!
      await m.room['handleSelectType'](curr, 'truth')
      const q = m.msgs.find((m) => m.type === 'turn_question')
      expect(q).toBeDefined()
      expect((q as any).questionType).toBe('truth')
    })

    it('should complete turn and advance to next player', async () => {
      vi.useRealTimers()
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const curr = getCurrentSess(m)!
      await m.room['handleSelectType'](curr, 'truth')
      m.msgs.length = 0
      await m.room['handleTurnDone'](curr, 'completed')
      const afterTypes = m.msgs.map((m) => m.type)
      expect(afterTypes.length).toBeGreaterThan(0)
      expect(afterTypes).toContain('turn_result')
    }, 10000)

    it('should end game and broadcast game_ended', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      m.msgs.length = 0
      await m.room['handleEndGame'](host)
      expect(m.msgs.some((m) => m.type === 'game_ended')).toBe(true)
    })

    it('should auto-skip turn after timeout (alarm-driven)', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const curr = getCurrentSess(m)!
      await m.room['handleSelectType'](curr, 'truth')
      m.msgs.length = 0
      // Simulate the durable turn alarm firing after the timeout elapsed.
      m.store.tables.meta.set('turn_started_at', {
        value: String(Date.now() - TURN_TIMEOUT_MS - 100),
      })
      const p = m.room['alarm']()
      await vi.advanceTimersByTimeAsync(3000)
      await p
      expect(m.msgs.some((m) => m.type === 'turn_result' && (m as any).status === 'skipped')).toBe(
        true,
      )
    })
  })

  describe('alarm', () => {
    it('should re-schedule alarm if room still has players', async () => {
      const m = await createRoom()
      const setAlarmSpy = m.room['ctx'].storage.setAlarm

      await m.room['alarm']()
      // Should not set alarm because room has players
      expect(setAlarmSpy).not.toHaveBeenCalled()
    })

    it('should re-schedule alarm if empty timeout has not elapsed', async () => {
      const m = await createRoom([])
      m.room['sessions'].clear()
      m.room['playerSockets'].clear()
      m.store.tables.meta.set('room_empty_since', { value: String(Date.now()) })
      const setAlarmSpy = m.room['ctx'].storage.setAlarm

      await m.room['alarm']()
      expect(setAlarmSpy).toHaveBeenCalled()
    })

    it('should auto-skip an expired turn and re-arm for the next player', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      m.store.tables.meta.set('turn_started_at', {
        value: String(Date.now() - TURN_TIMEOUT_MS - 1_000),
      })
      m.msgs.length = 0

      const p = m.room['alarm']()
      await vi.advanceTimersByTimeAsync(3000)
      await p

      expect(m.msgs.some((m) => m.type === 'turn_result' && (m as any).status === 'skipped')).toBe(
        true,
      )
      // The next player's turn should schedule a fresh alarm.
      expect(m.room['ctx'].storage.setAlarm).toHaveBeenCalled()
    })

    it('should not skip a turn whose timeout has not elapsed', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      m.msgs.length = 0

      await m.room['alarm']()

      expect(m.msgs.some((m) => m.type === 'turn_result')).toBe(false)
    })
  })

  describe('webSocketClose', () => {
    it('should handle close without attachment (DO eviction)', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      ;(ws as any).deserializeAttachment = vi.fn(() => null)

      await m.room['webSocketClose'](ws)
      // Should not throw, and should arm the empty-room cleanup instead of
      // deleting the D1 room row (so players can still reconnect).
      expect(m.store.tables.meta.has('room_empty_since')).toBe(true)
    })

    it('should skip cleanup if reconnection is in progress', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = 'reconnecting-id'
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))
      m.room['connectingIds'].add(pid)

      await m.room['webSocketClose'](ws)
      // Should not delete player from storage
      expect(m.store.tables.players.has(pid)).toBe(false)
    })

    it('should mark player as disconnected and save reconnect marker', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }])
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Alice',
        isHost: true,
      }))

      await m.room['webSocketClose'](ws)

      // Should have saved disconnected player marker
      const marker = m.store.tables.meta.get(`disconnected_player_${pid}`)
      expect(marker).toBeDefined()
      expect(JSON.parse(marker.value)).toEqual({ name: 'Alice', isHost: true })
    })

    it('should broadcast player_left in lobby phase', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }, { name: 'Bob' }])
      const ws = m.ws[1] // Bob's socket
      const pid = [...m.room['playerSockets'].keys()][1]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Bob',
        isHost: false,
      }))

      m.msgs.length = 0
      await m.room['webSocketClose'](ws)

      expect(m.msgs.some((m) => m.type === 'player_left')).toBe(true)
    })

    it('should transfer host role when the host leaves the lobby', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }, { name: 'Bob' }])
      const hostWs = m.ws[0]
      const hostPid = [...m.room['playerSockets'].keys()][0]
      const bobPid = [...m.room['playerSockets'].keys()][1]
      ;(hostWs as any).deserializeAttachment = vi.fn(() => ({
        playerId: hostPid,
        playerName: 'Alice',
        isHost: true,
      }))

      await m.room['webSocketClose'](hostWs)

      // Bob becomes host in DO storage, in the cached host meta, and in memory.
      expect(m.store.tables.players.get(bobPid)?.is_host).toBe(1)
      expect(m.store.tables.meta.get('room_host')?.value).toBe('Bob')
      const bobSess = [...m.room['sessions'].values()].find((s) => s.playerId === bobPid)!
      expect(bobSess.isHost).toBe(true)
    })

    it('should not broadcast player_left during active game', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const ws = m.ws[1] // Bob's socket
      const pid = [...m.room['playerSockets'].keys()][1]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'B',
        isHost: false,
      }))

      m.msgs.length = 0
      await m.room['webSocketClose'](ws)

      expect(m.msgs.some((m) => m.type === 'player_left')).toBe(false)
    })

    it('should set disconnect grace alarm when all players disconnect during game', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      // Disconnect all players
      for (let i = 0; i < m.ws.length; i++) {
        const ws = m.ws[i]
        const pid = [...m.room['playerSockets'].keys()][i]
        ;(ws as any).deserializeAttachment = vi.fn(() => ({
          playerId: pid,
          playerName: i === 0 ? 'A' : 'B',
          isHost: i === 0,
        }))
      }

      // Close first player (still has connections)
      const ws0 = m.ws[0]
      const pid0 = [...m.room['playerSockets'].keys()][0]
      ;(ws0 as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid0,
        playerName: 'A',
        isHost: true,
      }))
      await m.room['webSocketClose'](ws0)

      // Now close all remaining
      m.room['sessions'].clear()
      m.room['playerSockets'].clear()
      const ws1 = m.ws[1]
      const pid1 =
        [...m.room['playerSockets'].keys()].length > 0
          ? [...m.room['playerSockets'].keys()][0]
          : 'b-id'
      ;(ws1 as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid1,
        playerName: 'B',
        isHost: false,
      }))
      m.room['playerSockets'].set(pid1, ws1)
      m.room['sessions'].set(ws1, { playerId: pid1, playerName: 'B', isHost: false })

      await m.room['webSocketClose'](ws1)

      expect(m.room['ctx'].storage.setAlarm).toHaveBeenCalled()
    })

    it('should set empty room alarm when last player leaves in lobby', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))

      // Clear sessions first
      m.room['sessions'].clear()
      m.room['sessions'].set(ws, { playerId: pid, playerName: 'Host', isHost: true })

      await m.room['webSocketClose'](ws)

      // Should have set empty_since marker
      expect(m.store.tables.meta.has('room_empty_since')).toBe(true)
    })

    it('should keep the D1 room row when the last player leaves the lobby', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))
      m.room['sessions'].clear()
      m.room['sessions'].set(ws, { playerId: pid, playerName: 'Host', isHost: true })

      await m.room['webSocketClose'](ws)

      // The room row must survive so the host can reopen the room link and
      // reconnect (only the player row is removed). The empty marker still
      // arms the alarm that removes the room after EMPTY_ROOM_TIMEOUT.
      const db = m.room['getDb']()
      const deleteCalls = (db.delete as any).mock.calls
      expect(deleteCalls.some((c: any[]) => c[0] === schema.rooms)).toBe(false)
      expect(deleteCalls.some((c: any[]) => c[0] === schema.players)).toBe(true)
      expect(m.store.tables.meta.has('room_empty_since')).toBe(true)
    })

    it('should skip cleanup if new socket already took over', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))

      // New socket already took over
      const newSocket = makeWS(pid)
      m.room['playerSockets'].set(pid, newSocket)

      await m.room['webSocketClose'](ws)
      // Should not touch playerSockets
      expect(m.room['playerSockets'].get(pid)).toBe(newSocket)
    })
  })

  describe('webSocketError', () => {
    it('should clean up session on error', async () => {
      const m = await createRoom()
      const ws = m.ws[0]

      await m.room['webSocketError'](ws, new Error('connection failed'))

      expect(m.room['sessions'].has(ws)).toBe(false)
    })

    it('should skip cleanup when a reconnection is in progress', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))
      m.room['connectingIds'].add(pid)

      await m.room['webSocketError'](ws, new Error('boom'))

      // Player maps must stay untouched for the in-flight reconnect.
      expect(m.room['playerSockets'].has(pid)).toBe(true)
    })

    it('should skip cleanup when a newer socket already took over', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))
      const newSocket = makeWS(pid)
      m.room['playerSockets'].set(pid, newSocket)

      await m.room['webSocketError'](ws, new Error('boom'))

      expect(m.room['playerSockets'].get(pid)).toBe(newSocket)
    })
  })

  describe('verifyIsHost', () => {
    it('should return false when roomId is empty', async () => {
      const m = await createRoom()
      m.room['roomId'] = ''
      const result = await m.room['verifyIsHost']('Alice')
      expect(result).toBe(false)
    })

    it('should return false when name is empty', async () => {
      const m = await createRoom()
      const result = await m.room['verifyIsHost']('')
      expect(result).toBe(false)
    })

    it('should use cached host name from meta', async () => {
      const m = await createRoom()
      m.store.tables.meta.set('room_host', { value: 'Alice' })
      const result = await m.room['verifyIsHost']('Alice')
      expect(result).toBe(true)
    })

    it('should return false for non-host name', async () => {
      const m = await createRoom()
      m.store.tables.meta.set('room_host', { value: 'Alice' })
      const result = await m.room['verifyIsHost']('Bob')
      expect(result).toBe(false)
    })
  })

  describe('handleStaleEmptyRoom', () => {
    it('should clean up if room has been empty long enough', async () => {
      const m = await createRoom([])
      m.store.tables.meta.set('room_empty_since', { value: String(Date.now() - 1_000_000_000) })

      await m.room['handleStaleEmptyRoom']()

      expect(m.room['roomId']).toBe('')
    })

    it('should re-schedule alarm if empty timeout not elapsed', async () => {
      const m = await createRoom([])
      m.store.tables.meta.set('room_empty_since', { value: String(Date.now()) })

      await m.room['handleStaleEmptyRoom']()

      expect(m.room['ctx'].storage.setAlarm).toHaveBeenCalled()
    })

    it('should do nothing if game is active', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      m.store.tables.meta.set('room_empty_since', { value: String(Date.now()) })

      await m.room['handleStaleEmptyRoom']()

      expect(m.room['roomId']).toBe('test-room-id')
    })
  })

  describe('getFallbackQuestion', () => {
    it('should return a fallback question', () => {
      const q = RoomDO['FALLBACK_QUESTIONS'][0]
      expect(q.type).toBe('truth')
      expect(q.text).toBeTruthy()
    })
  })

  describe('sendSafe', () => {
    it('should do nothing when ws is undefined', () => {
      // Should not throw
      const room = new RoomDO(createMockDOState(new MockSqlStorage()), makeMockEnv())
      expect(() => room['sendSafe'](undefined, { type: 'error', message: 'x' })).not.toThrow()
    })

    it('should clean up player maps when send throws and attachment exists', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }])
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).send = vi.fn(() => {
        throw new Error('boom')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      m.room['sendSafe'](ws, {
        type: 'player_joined',
        playerId: pid,
        playerName: 'Alice',
        isHost: true,
        players: [],
      })

      expect(errSpy).toHaveBeenCalled()
      expect(m.room['playerSockets'].has(pid)).toBe(false)
      expect(m.room['sessions'].has(ws)).toBe(false)
      errSpy.mockRestore()
    })
  })

  describe('handleTurnDone edge cases', () => {
    it('should end game when max rounds reached', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!

      // Set up a game state that's at max rounds using the mock storage directly
      // The game state is stored in the mock's game table
      const playerId = [...m.room['playerSockets'].keys()][0]
      m.store.tables.game.set('game-1', {
        id: 'game-1',
        status: 'playing',
        player_order: JSON.stringify([playerId]),
        current_player_index: 0,
        round: 999,
      })
      ;(m.room as any).currentChoices.set(playerId, { type: 'truth', questionId: 'q1' })

      m.msgs.length = 0
      await m.room['handleTurnDone'](host, 'completed')

      expect(m.msgs.some((m) => m.type === 'game_ended')).toBe(true)
    })
  })

  describe('handleTurnDone choice edge cases', () => {
    it('should record a turn with null questionId when choice lacks one', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[gs.currentPlayerIndex]
      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!

      // Simulate a stored choice that has no questionId (defensive path)
      m.room['currentChoices'].set(pid, { type: 'truth' } as any)
      m.msgs.length = 0

      const p = m.room['handleTurnDone'](sess, 'completed')
      await vi.advanceTimersByTimeAsync(3500)
      await p

      expect(m.msgs.some((x) => x.type === 'turn_result')).toBe(true)
    })

    it('should broadcast empty nextPlayerName when next player is gone', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[gs.currentPlayerIndex]
      const nextPid = gs.playerOrder.find((p: string) => p !== pid)!
      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!

      // Next player is no longer in DO storage — fallback name must be ''
      m.store.tables.players.delete(nextPid)
      m.room['playersDirty'] = true
      m.room['cachedPlayers'] = []
      m.msgs.length = 0

      await m.room['handleTurnDone'](sess, 'completed')

      const tr = m.msgs.find((x) => x.type === 'turn_result') as any
      expect(tr).toBeDefined()
      expect(tr.nextPlayerName).toBe('')
    })
  })

  describe('handleSelectType edge cases', () => {
    it('should skip if no game state', async () => {
      const m = await createRoom()
      const host = [...m.room['sessions'].values()][0]

      await m.room['handleSelectType'](host, 'truth')
      // Should not throw
    })

    it('should prevent duplicate choice selection', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const curr = [...m.room['sessions'].values()].find((s) => s.playerName === 'A')!

      // Call select twice
      await m.room['handleSelectType'](curr, 'truth')
      m.msgs.length = 0
      await m.room['handleSelectType'](curr, 'truth')
      // Should not assign another question
      expect(m.msgs.some((m) => m.type === 'turn_question')).toBe(false)
    })
  })

  describe('handleEndGame edge cases', () => {
    it('should reject end by non-host', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const bob = [...m.room['sessions'].values()].find((s) => s.playerName === 'B')!
      m.msgs.length = 0
      await m.room['handleEndGame'](bob)
      expect(m.msgs.some((m) => m.type === 'error')).toBe(true)
    })

    it('should do nothing if no active game', async () => {
      const m = await createRoom()
      const host = [...m.room['sessions'].values()][0]

      await m.room['handleEndGame'](host)
      // Should not throw
    })
  })

  describe('initializeStorage', () => {
    it('should create storage tables on construction', () => {
      const store = new MockSqlStorage()
      new RoomDO(createMockDOState(store), makeMockEnv())
      // No error = success
    })

    it('should arm the turn timeout on restart when a game is active but no marker survived', async () => {
      const store = new MockSqlStorage()
      store.tables.meta.set('room_id', { value: 'room-1' })
      store.tables.game.set('g1', {
        id: 'g1',
        status: 'playing',
        player_order: JSON.stringify(['p1', 'p2']),
        current_player_index: 0,
        round: 1,
      })
      const state = createMockDOState(store)
      new RoomDO(state, makeMockEnv())
      const init = (state as any).blockConcurrencyWhile.mock.results[0].value as Promise<void>
      await init

      expect(store.tables.meta.has('turn_started_at')).toBe(true)
      expect(state.storage.setAlarm).toHaveBeenCalled()
    })

    it('should not reset an existing turn timeout marker on restart', async () => {
      const store = new MockSqlStorage()
      store.tables.meta.set('room_id', { value: 'room-1' })
      store.tables.meta.set('turn_started_at', { value: '12345' })
      store.tables.game.set('g1', {
        id: 'g1',
        status: 'playing',
        player_order: JSON.stringify(['p1', 'p2']),
        current_player_index: 0,
        round: 1,
      })
      const state = createMockDOState(store)
      new RoomDO(state, makeMockEnv())
      const init = (state as any).blockConcurrencyWhile.mock.results[0].value as Promise<void>
      await init

      expect(store.tables.meta.get('turn_started_at')?.value).toBe('12345')
    })

    it('should not arm a turn timeout when no game is active', async () => {
      const store = new MockSqlStorage()
      store.tables.meta.set('room_id', { value: 'room-1' })
      const state = createMockDOState(store)
      new RoomDO(state, makeMockEnv())
      const init = (state as any).blockConcurrencyWhile.mock.results[0].value as Promise<void>
      await init

      expect(store.tables.meta.has('turn_started_at')).toBe(false)
    })
  })

  describe('turn timeout alarms', () => {
    it('should schedule an alarm when a turn starts', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const curr = [...m.room['sessions'].values()].find(
        (s) => s.playerId === gs.playerOrder[gs.currentPlayerIndex],
      )!

      await m.room['handleSelectType'](curr, 'truth')

      expect(m.store.tables.meta.has('turn_started_at')).toBe(true)
      expect(m.room['ctx'].storage.setAlarm).toHaveBeenCalled()
    })

    it('should clear the turn alarm when the turn completes', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[gs.currentPlayerIndex]
      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      await m.room['handleSelectType'](sess, 'truth')

      const p = m.room['handleTurnDone'](sess, 'completed')
      await vi.advanceTimersByTimeAsync(3500)
      await p

      // After advancing to the next player a fresh alarm is scheduled.
      expect(m.store.tables.meta.has('turn_started_at')).toBe(true)
      expect(m.room['ctx'].storage.setAlarm).toHaveBeenCalled()
    })
  })

  describe('fetch', () => {
    it('should reject with 400 for invalid player name', async () => {
      const m = await createRoom()
      const res = await m.room.fetch(
        new Request('http://localhost/ws/room-123?name=toooooolongname123456&playerId=abc') as any,
      )
      expect(res.status).toBe(400)
    })

    it('should reject with 403 when no playerId provided', async () => {
      const m = await createRoom()
      const res = await m.room.fetch(new Request('http://localhost/ws/room-123?name=Alice') as any)
      expect(res.status).toBe(403)
    })

    it('should reject with 403 when player is not registered', async () => {
      const m = await createRoom()
      const res = await m.room.fetch(
        new Request('http://localhost/ws/room-123?name=Alice&playerId=unknown-player') as any,
      )
      expect(res.status).toBe(403)
    })

    it('should reject with 403 when player name does not match', async () => {
      const m = await createRoom()
      const pid = [...m.room['playerSockets'].keys()][0]
      const res = await m.room.fetch(
        new Request(`http://localhost/ws/room-123?name=WrongName&playerId=${pid}`) as any,
      )
      expect(res.status).toBe(403)
    })
  })

  describe('ensureQuestionCache', () => {
    it('should load questions from D1 into cache', async () => {
      const m = await createRoom()
      m.room['questionCacheLoaded'] = false

      // The drizzle mock returns empty questions, so cache stays empty but marked loaded
      await m.room['ensureQuestionCache']()
      expect(m.room['questionCacheLoaded']).toBe(true)
    })

    it('should skip loading if already loaded', async () => {
      const m = await createRoom()
      m.room['questionCacheLoaded'] = true
      await m.room['ensureQuestionCache']()
      expect(m.room['questionCacheLoaded']).toBe(true)
    })
  })

  describe('pickQuestion', () => {
    it('should return null when no questions available', async () => {
      const m = await createRoom()
      const result = await m.room['pickQuestion']('truth', 'p1')
      expect(result).toBeNull()
    })
  })

  describe('getActiveGameState', () => {
    it('should return null when no active game', async () => {
      const m = await createRoom()
      const state = await m.room['getActiveGameState']()
      expect(state).toBeNull()
    })
  })

  describe('handleStartGame edge cases', () => {
    it('should do nothing if game already started', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      m.msgs.length = 0
      // Second call should be a no-op
      await m.room['handleStartGame'](host)
      expect(m.msgs.some((m) => m.type === 'game_started')).toBe(false)
    })
  })

  describe('syncPlayersFromD1', () => {
    it('should sync players from D1 into local storage', async () => {
      const m = await createRoom()
      await m.room['syncPlayersFromD1']()
      // Should not throw
    })
  })

  describe('onPlayerConnected', () => {
    it('should register a new player connection', async () => {
      const m = await createRoom()
      const ws = makeWS('new-player-1')
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: 'new-player-1',
        playerName: 'NewGuy',
        isHost: false,
      }))
      ;(ws as any).send = vi.fn()

      await m.room['onPlayerConnected'](ws, 'NewGuy', 'new-player-1')

      expect(m.room['sessions'].has(ws)).toBe(true)
      expect(ws.send).toHaveBeenCalled()
    })

    it('should handle reconnect of an existing player', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const pidA = [...m.room['playerSockets'].keys()][0]
      const newWs = makeWS(pidA)
      ;(newWs as any).deserializeAttachment = vi.fn(() => ({
        playerId: pidA,
        playerName: 'A',
        isHost: true,
      }))
      ;(newWs as any).send = vi.fn()

      await m.room['onPlayerConnected'](newWs, 'A', pidA)

      expect(m.room['playerSockets'].get(pidA)).toBe(newWs)
    })

    it('should send game_started and current turn to reconnecting player during game', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const pidA = [...m.room['playerSockets'].keys()][0]
      const newWs = makeWS(pidA)
      const sent: any[] = []
      ;(newWs as any).deserializeAttachment = vi.fn(() => ({
        playerId: pidA,
        playerName: 'A',
        isHost: true,
      }))
      ;(newWs as any).send = vi.fn((msg: string) => sent.push(JSON.parse(msg)))

      await m.room['onPlayerConnected'](newWs, 'A', pidA)

      expect(sent.some((m) => m.type === 'game_started')).toBe(true)
    })

    it('should close old socket when reconnecting elsewhere', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const pidA = [...m.room['playerSockets'].keys()][0]
      const oldWs = m.room['playerSockets'].get(pidA)!

      const newWs = makeWS(pidA)
      ;(newWs as any).deserializeAttachment = vi.fn(() => ({
        playerId: pidA,
        playerName: 'A',
        isHost: true,
      }))
      ;(newWs as any).send = vi.fn()

      await m.room['onPlayerConnected'](newWs, 'A', pidA)

      expect(oldWs.close).toHaveBeenCalled()
      expect(m.room['sessions'].has(oldWs)).toBe(false)
    })
  })

  describe('webSocketMessage with attachment recovery', () => {
    it('should recover session from ws attachment', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))

      // Remove from sessions to simulate recovery path
      m.room['sessions'].delete(ws)
      m.room['playerSockets'].delete(pid)

      await m.room.webSocketMessage(ws, JSON.stringify({ type: 'end_game' }))

      // Session should be re-added
      expect(m.room['sessions'].has(ws)).toBe(true)
    })

    it('should send error when no session can be determined', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      ;(ws as any).deserializeAttachment = vi.fn(() => null)
      m.room['sessions'].delete(ws)

      m.msgs.length = 0
      await m.room.webSocketMessage(ws, JSON.stringify({ type: 'start_game' }))
      expect(m.msgs.some((m) => m.type === 'error')).toBe(true)
    })
  })

  describe('webSocketError with session cleanup', () => {
    it('should clean up D1 player record when no game active', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Host',
        isHost: true,
      }))

      await m.room['webSocketError'](ws, new Error('boom'))

      // Player should be removed from local storage
      expect(m.store.tables.players.has(pid)).toBe(false)
    })
  })

  describe('storage init failure', () => {
    it('should log and rethrow when initializeStorage fails', async () => {
      const m = await createRoom()
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ;(m.room['ctx'].storage.sql as any).exec = vi.fn(() => {
        throw new Error('boom')
      })

      await expect(m.room['initializeStorage']()).rejects.toThrow('boom')
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('cleanupRoomFromD1', () => {
    it('should no-op when roomId is empty', async () => {
      const m = await createRoom()
      m.room['roomId'] = ''
      await m.room['cleanupRoomFromD1']()
      expect(m.room['roomId']).toBe('')
    })

    it('should log error when D1 delete fails', async () => {
      const m = await createRoom()
      mockD1.fail = { op: 'delete' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await m.room['cleanupRoomFromD1']()
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('fetch roomId adoption', () => {
    it('should adopt roomId from query param when empty', async () => {
      const store = new MockSqlStorage()
      const room = new RoomDO(createMockDOState(store), makeMockEnv())

      await room.fetch(
        new Request('http://localhost/ws/whatever?name=Alice&playerId=p1&roomId=room-xyz') as any,
      )

      expect((room as any).roomId).toBe('room-xyz')
      expect(store.tables.meta.get('room_id')).toBeDefined()
    })

    it('should adopt roomId from header when empty', async () => {
      const store = new MockSqlStorage()
      const room = new RoomDO(createMockDOState(store), makeMockEnv())

      await room.fetch(
        new Request('http://localhost/ws/whatever?name=Alice&playerId=p1', {
          headers: { 'X-Room-Id': 'hdr-room' },
        }) as any,
      )

      expect((room as any).roomId).toBe('hdr-room')
    })
  })

  describe('fetch game in progress', () => {
    it('should reject connection when player not in active game', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      mockD1.players = [{ id: 'p-extra', name: 'C', isHost: false }]
      const res = await m.room.fetch(
        new Request('http://localhost/ws/test-room-id?name=C&playerId=p-extra') as any,
      )
      expect(res.status).toBe(403)
    })
  })

  describe('fetch success path', () => {
    it('should accept websocket and return 101', async () => {
      class MockWebSocketPair {
        0: any
        1: any
        constructor() {
          this[0] = makeWS('client-1')
          this[1] = makeWS('server-1')
        }
      }
      vi.stubGlobal('WebSocketPair', MockWebSocketPair)

      const m = await createRoom([])
      mockD1.players = [{ id: 'p1', name: 'Alice', isHost: true }]

      const res = await m.room.fetch(
        new Request('http://localhost/ws/test-room-id?name=Alice&playerId=p1') as any,
      )

      expect(res.status).toBe(101)
      expect(m.room['ctx'].acceptWebSocket).toHaveBeenCalled()
    })
  })

  describe('syncPlayersFromD1', () => {
    it('should no-op when roomId is empty', async () => {
      const m = await createRoom()
      m.room['roomId'] = ''
      await m.room['syncPlayersFromD1']()
    })

    it('should copy players from D1 into local storage', async () => {
      const m = await createRoom()
      mockD1.players = [{ id: 'd1p', name: 'D1', isHost: true }]
      await m.room['syncPlayersFromD1']()
      expect(m.store.tables.players.get('d1p')).toBeDefined()
    })

    it('should log error when D1 query fails', async () => {
      const m = await createRoom()
      mockD1.fail = { op: 'select' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await m.room['syncPlayersFromD1']()
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('onPlayerConnected reconnect variants', () => {
    it('should detect reconnect by name when no playerId', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }])
      const ws = makeWS('')
      ;(ws as any).deserializeAttachment = vi.fn(() => ({ playerName: 'Alice', isHost: true }))
      ;(ws as any).send = vi.fn()

      await m.room['onPlayerConnected'](ws, 'Alice', '')

      expect(m.room['playerSockets'].size).toBeGreaterThan(1)
    })

    it('should restore player from D1 when missing in DO', async () => {
      const m = await createRoom([])
      mockD1.players = [{ id: 'p9', name: 'Zed', isHost: false }]
      mockD1.fail = { op: 'select' } // first select (sync) fails, second (check) succeeds
      const ws = makeWS('p9')
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: 'p9',
        playerName: 'Zed',
        isHost: false,
      }))
      ;(ws as any).send = vi.fn()

      await m.room['onPlayerConnected'](ws, 'Zed', 'p9')

      expect(m.store.tables.players.has('p9')).toBe(true)
    })

    it('should log error when D1 player check fails', async () => {
      const m = await createRoom([])
      ;(m.room as any).syncPlayersFromD1 = vi.fn().mockResolvedValue(undefined)
      mockD1.fail = { op: 'select' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const ws = makeWS('p9')
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: 'p9',
        playerName: 'Zed',
        isHost: false,
      }))
      ;(ws as any).send = vi.fn()

      await m.room['onPlayerConnected'](ws, 'Zed', 'p9')

      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })

    it('should log error when D1 player insert on connect fails', async () => {
      const m = await createRoom()
      mockD1.fail = { op: 'insert' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const ws = makeWS('newp')
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: 'newp',
        playerName: 'New',
        isHost: false,
      }))
      ;(ws as any).send = vi.fn()

      await m.room['onPlayerConnected'](ws, 'New', 'newp')

      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })

    it('should resend turn_question when reconnecting player has stored choice', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const currentPid = gs.playerOrder[gs.currentPlayerIndex]
      m.store.tables.meta.set(`choice_${currentPid}`, {
        value: JSON.stringify({ type: 'truth', questionId: 'q1' }),
      })
      mockD1.questions = [{ id: 'q1', type: 'truth', text: 'Q1?' }]

      const newWs = makeWS(currentPid)
      ;(newWs as any).deserializeAttachment = vi.fn(() => ({
        playerId: currentPid,
        playerName: 'A',
        isHost: true,
      }))
      const sent: any[] = []
      ;(newWs as any).send = vi.fn((msg: string) => sent.push(JSON.parse(msg)))

      await m.room['onPlayerConnected'](newWs, 'A', currentPid)

      expect(sent.some((x) => x.type === 'turn_question')).toBe(true)
    })

    it('should send waiting_for_choice when transition in progress', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const currentPid = gs.playerOrder[gs.currentPlayerIndex]
      m.room['turnTransitionInProgress'] = true

      const newWs = makeWS(currentPid)
      ;(newWs as any).deserializeAttachment = vi.fn(() => ({
        playerId: currentPid,
        playerName: 'A',
        isHost: true,
      }))
      const sent: any[] = []
      ;(newWs as any).send = vi.fn((msg: string) => sent.push(JSON.parse(msg)))

      await m.room['onPlayerConnected'](newWs, 'A', currentPid)

      expect(sent.some((x) => x.type === 'waiting_for_choice')).toBe(true)
    })

    it('should send waiting_for_choice to non-current reconnecting player', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const currentPid = gs.playerOrder[gs.currentPlayerIndex]
      const otherPid = gs.playerOrder.find((x: string) => x !== currentPid)!

      const newWs = makeWS(otherPid)
      ;(newWs as any).deserializeAttachment = vi.fn(() => ({
        playerId: otherPid,
        playerName: 'B',
        isHost: false,
      }))
      const sent: any[] = []
      ;(newWs as any).send = vi.fn((msg: string) => sent.push(JSON.parse(msg)))

      await m.room['onPlayerConnected'](newWs, 'B', otherPid)

      expect(sent.some((x) => x.type === 'waiting_for_choice')).toBe(true)
    })
  })

  describe('getActiveGameState failure', () => {
    it('should return null when storage query fails', async () => {
      const m = await createRoom()
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ;(m.room['ctx'].storage.sql as any).exec = vi.fn(() => {
        throw new Error('boom')
      })

      const gs = await m.room['getActiveGameState']()
      expect(gs).toBeNull()
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('webSocketMessage routing', () => {
    it('should reply error on invalid JSON', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      m.msgs.length = 0
      await m.room.webSocketMessage(ws, '{bad json')
      expect(m.msgs.some((x) => x.type === 'error')).toBe(true)
    })

    it('should reply error on schema-invalid message', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      m.msgs.length = 0
      await m.room.webSocketMessage(ws, JSON.stringify({ type: 'bogus' }))
      expect(m.msgs.some((x) => x.type === 'error')).toBe(true)
    })

    it('should handle start_game message', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const hostWs = m.wsMap.get([...m.room['playerSockets'].keys()][0])!
      m.msgs.length = 0
      await m.room.webSocketMessage(hostWs, JSON.stringify({ type: 'start_game' }))
      expect(m.msgs.some((x) => x.type === 'game_started')).toBe(true)
    })

    it('should handle select_truth message', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      const ws = m.wsMap.get(pid)!
      m.msgs.length = 0
      await m.room.webSocketMessage(ws, JSON.stringify({ type: 'select_truth' }))
      // Should not throw; current player already has an auto-assigned choice
    })

    it('should handle turn_done message', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)
      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      const ws = m.wsMap.get(pid)!
      m.msgs.length = 0

      const p = m.room.webSocketMessage(
        ws,
        JSON.stringify({ type: 'turn_done', status: 'completed' }),
      )
      await vi.advanceTimersByTimeAsync(3500)
      await p

      expect(m.msgs.some((x) => x.type === 'turn_result')).toBe(true)
    })
  })

  describe('webSocketClose D1 failure', () => {
    it('should log error when D1 delete fails on close', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }])
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Alice',
        isHost: true,
      }))
      mockD1.fail = { op: 'delete' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await m.room['webSocketClose'](ws)
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('webSocketError D1 failure', () => {
    it('should log error when D1 delete fails on error', async () => {
      const m = await createRoom([{ name: 'Alice', isHost: true }])
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).deserializeAttachment = vi.fn(() => ({
        playerId: pid,
        playerName: 'Alice',
        isHost: true,
      }))
      mockD1.fail = { op: 'delete' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await m.room['webSocketError'](ws, new Error('boom'))
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('alarm disconnect grace', () => {
    it('should end game when grace expires', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      m.store.tables.meta.set('disconnect_grace_started_at', {
        value: String(Date.now() - DISCONNECT_GRACE_MS - 1000),
      })
      m.msgs.length = 0
      await m.room['alarm']()
      expect(m.msgs.some((x) => x.type === 'game_ended')).toBe(true)
    })

    it('should reschedule alarm when grace not expired', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }])
      m.store.tables.meta.set('disconnect_grace_started_at', { value: String(Date.now()) })
      await m.room['alarm']()
      expect(m.room['ctx'].storage.setAlarm).toHaveBeenCalled()
    })
  })

  describe('alarm room state', () => {
    it('should not clean up while game active (re-arms instead)', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const setAlarmSpy = m.room['ctx'].storage.setAlarm
      await m.room['alarm']()
      // No cleanup happens, but the pending turn alarm is re-armed.
      expect(m.room['roomId']).toBe('test-room-id')
      expect(setAlarmSpy).toHaveBeenCalled()
    })

    it('should clean up empty room when timeout elapsed', async () => {
      const m = await createRoom([])
      m.room['sessions'].clear()
      m.room['playerSockets'].clear()
      m.store.tables.meta.set('room_empty_since', {
        value: String(Date.now() - EMPTY_ROOM_TIMEOUT - 1_000),
      })

      await m.room['alarm']()
      expect(m.room['roomId']).toBe('')
    })
  })

  describe('findDisconnectedPlayer edge cases', () => {
    it('should return null when marker name is not a string', async () => {
      const m = await createRoom()
      m.store.tables.meta.set('disconnected_player_p1', { value: JSON.stringify({ name: 42 }) })
      expect(m.room['findDisconnectedPlayer']('p1')).toBeNull()
    })
  })

  describe('verifyIsHost D1 lookup', () => {
    it('should look up host from D1 when not cached', async () => {
      const m = await createRoom([])
      m.store.tables.meta.delete('room_host')
      mockD1.rooms = [{ id: 'test-room-id', hostName: 'Alice' }]

      const result = await m.room['verifyIsHost']('Alice')
      expect(result).toBe(true)
      expect(m.store.tables.meta.get('room_host')).toBeDefined()
    })

    it('should return false when D1 host does not match', async () => {
      const m = await createRoom([])
      m.store.tables.meta.delete('room_host')
      mockD1.rooms = [{ id: 'test-room-id', hostName: 'Bob' }]

      const result = await m.room['verifyIsHost']('Alice')
      expect(result).toBe(false)
    })

    it('should return false when D1 lookup fails', async () => {
      const m = await createRoom([])
      m.store.tables.meta.delete('room_host')
      mockD1.fail = { op: 'select' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await m.room['verifyIsHost']('Alice')
      expect(result).toBe(false)
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('handleStartGame failure', () => {
    it('should send error when D1 insert fails', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      mockD1.fail = { op: 'insert' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      m.msgs.length = 0

      await m.room['handleStartGame'](host)
      expect(errSpy).toHaveBeenCalled()
      expect(m.msgs.some((x) => x.type === 'error')).toBe(true)
      errSpy.mockRestore()
    })
  })

  describe('handleSelectType edge cases', () => {
    it('should ignore selection from non-current player', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const currentPid = gs.playerOrder[gs.currentPlayerIndex]
      const other = [...m.room['sessions'].values()].find((s) => s.playerId !== currentPid)!
      m.msgs.length = 0

      await m.room['handleSelectType'](other, 'truth')
      expect(m.msgs.some((x) => x.type === 'turn_question')).toBe(false)
    })

    it('should ignore duplicate selection while in-flight', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      m.room['currentChoices'].delete(pid)
      m.store.tables.meta.delete(`choice_${pid}`)
      m.room['selectingPlayers'].add(pid)

      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      m.msgs.length = 0
      await m.room['handleSelectType'](sess, 'truth')
      expect(m.msgs.some((x) => x.type === 'turn_question')).toBe(false)
    })

    it('should auto-skip when no question available', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      ;(m.room as any).pickQuestion = vi.fn().mockResolvedValue(null)
      ;(m.room as any).getFallbackQuestion = vi.fn().mockReturnValue(null)

      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      m.room['currentChoices'].delete(pid)
      m.store.tables.meta.delete(`choice_${pid}`)
      m.msgs.length = 0

      const p = m.room['handleSelectType'](sess, 'truth')
      // Auto-skip chains into the next player's turn with 3s transitions per round;
      // advance far enough for MAX_ROUNDS to elapse and the game to end.
      const maxTransitionMs = MAX_ROUNDS * 2 * 3_000 + 10_000
      await vi.advanceTimersByTimeAsync(maxTransitionMs)
      await p

      expect(m.msgs.some((x) => x.type === 'turn_result' && (x as any).status === 'skipped')).toBe(
        true,
      )
    })
  })

  describe('pickQuestion', () => {
    it('should pick an unused question from cache', async () => {
      const m = await createRoom()
      m.room['questionCacheLoaded'] = true
      m.store.tables.question_cache.set('q1', { id: 'q1', type: 'truth', text: 'Q1' })
      m.store.tables.question_cache.set('q2', { id: 'q2', type: 'truth', text: 'Q2' })

      const q = await m.room['pickQuestion']('truth', 'p1')
      expect(q).toBeTruthy()
      expect(['q1', 'q2']).toContain(q!.id)
    })

    it('should filter out questions already used by the player', async () => {
      const m = await createRoom()
      m.room['questionCacheLoaded'] = true
      m.store.tables.question_cache.set('q1', { id: 'q1', type: 'truth', text: 'Q1' })
      m.store.tables.question_cache.set('q2', { id: 'q2', type: 'truth', text: 'Q2' })
      m.store.tables.used_questions.set('p1_q1', { player_id: 'p1', question_id: 'q1' })

      const q = await m.room['pickQuestion']('truth', 'p1')
      expect(q).toBeTruthy()
      expect(q!.id).toBe('q2')
    })

    it('should return null and log when cache load fails', async () => {
      const m = await createRoom()
      mockD1.fail = { op: 'select' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const q = await m.room['pickQuestion']('truth', 'p1')
      expect(q).toBeNull()
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('ensureQuestionCache', () => {
    it('should skip D1 load when cache already populated', async () => {
      const m = await createRoom()
      m.store.tables.question_cache.set('q1', { id: 'q1', type: 'truth', text: 'Q1' })

      await m.room['ensureQuestionCache']()
      expect(m.room['questionCacheLoaded']).toBe(true)
    })

    it('should load questions from D1 into cache', async () => {
      const m = await createRoom()
      mockD1.questions = [
        { id: 'q1', type: 'truth', text: 'Q1' },
        { id: 'q2', type: 'dare', text: 'Q2' },
      ]

      await m.room['ensureQuestionCache']()
      expect(m.store.tables.question_cache.size).toBe(2)
      expect(m.room['questionCacheLoaded']).toBe(true)
    })
  })

  describe('getFallbackQuestion', () => {
    it('should return null when fallback list is empty', () => {
      const orig = (RoomDO as any)['FALLBACK_QUESTIONS']
      ;(RoomDO as any)['FALLBACK_QUESTIONS'] = []
      try {
        const room = new RoomDO(createMockDOState(new MockSqlStorage()), makeMockEnv())
        expect(room['getFallbackQuestion']('truth')).toBeNull()
      } finally {
        ;(RoomDO as any)['FALLBACK_QUESTIONS'] = orig
      }
    })
  })

  describe('handleTurnDone edge cases', () => {
    it('should no-op when no active game', async () => {
      const m = await createRoom()
      const host = [...m.room['sessions'].values()][0]
      await m.room['handleTurnDone'](host, 'completed')
    })

    it('should ignore turn_done from non-current player', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      const other = [...m.room['sessions'].values()].find((s) => s.playerId !== pid)!
      m.msgs.length = 0
      await m.room['handleTurnDone'](other, 'completed')
      expect(m.msgs.length).toBe(0)
    })

    it('should restore choice from storage when not in memory', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      m.room['currentChoices'].clear()
      m.store.tables.meta.set(`choice_${pid}`, {
        value: JSON.stringify({ type: 'truth', questionId: 'q1' }),
      })

      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      m.msgs.length = 0
      const p = m.room['handleTurnDone'](sess, 'completed')
      await vi.advanceTimersByTimeAsync(3500)
      await p

      expect(
        m.msgs.some((x) => x.type === 'turn_result' && (x as any).questionType === 'truth'),
      ).toBe(true)
    })

    it('should handle malformed stored choice', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      m.room['currentChoices'].clear()
      m.store.tables.meta.set(`choice_${pid}`, { value: '{bad json' })

      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      m.msgs.length = 0
      const p = m.room['handleTurnDone'](sess, 'completed')
      await vi.advanceTimersByTimeAsync(3500)
      await p

      expect(m.msgs.some((x) => x.type === 'turn_result')).toBe(true)
    })

    it('should log when recording turn fails', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      m.room['currentChoices'].set(pid, { type: 'truth', questionId: 'q1' })
      mockD1.fail = { op: 'update' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await m.room['handleTurnDone'](sess, 'completed')
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })

    it('should stop transition if game ended during delay', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      m.room['currentChoices'].set(pid, { type: 'truth', questionId: 'q1' })
      m.msgs.length = 0

      const p = m.room['handleTurnDone'](sess, 'completed')
      await vi.advanceTimersByTimeAsync(0)
      m.store.tables.game.clear()
      await vi.advanceTimersByTimeAsync(3000)
      await p

      expect(m.room['turnTransitionInProgress']).toBe(false)
    })

    it('should stop transition if state advanced during delay', async () => {
      const m = await createRoom([{ name: 'A', isHost: true }, { name: 'B' }])
      const host = [...m.room['sessions'].values()].find((s) => s.isHost)!
      await m.room['handleStartGame'](host)

      const gs = m.msgs.find((x) => x.type === 'game_started') as any
      const pid = gs.playerOrder[0]
      const sess = [...m.room['sessions'].values()].find((s) => s.playerId === pid)!
      m.room['currentChoices'].set(pid, { type: 'truth', questionId: 'q1' })
      m.msgs.length = 0

      const p = m.room['handleTurnDone'](sess, 'completed')
      await vi.advanceTimersByTimeAsync(0)
      for (const g of m.store.tables.game.values()) g.current_player_index = 999
      await vi.advanceTimersByTimeAsync(3000)
      await p

      expect(m.room['turnTransitionInProgress']).toBe(false)
    })
  })

  describe('endGame failure', () => {
    it('should log when D1 update fails', async () => {
      const m = await createRoom()
      const pid = [...m.room['playerSockets'].keys()][0]
      const gs = { id: 'g1', playerOrder: [pid], currentPlayerIndex: 0, round: 1 }
      m.store.tables.game.set('g1', {
        id: 'g1',
        status: 'playing',
        player_order: JSON.stringify([pid]),
        current_player_index: 0,
        round: 1,
      })
      mockD1.fail = { op: 'update' }
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await m.room['endGame'](gs)
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('autoSkipTurn edge cases', () => {
    it('should no-op when current player not found', async () => {
      const m = await createRoom([])
      m.store.tables.game.set('g1', {
        id: 'g1',
        status: 'playing',
        player_order: JSON.stringify(['ghost']),
        current_player_index: 0,
        round: 1,
      })
      await m.room['autoSkipTurn']()
    })
  })

  describe('sendSafe', () => {
    it('should no-op when ws is undefined', async () => {
      const m = await createRoom()
      m.room['sendSafe'](undefined, { type: 'error', message: 'x' } as any)
    })

    it('should clean up session when send throws', async () => {
      const m = await createRoom()
      const ws = m.ws[0]
      const pid = [...m.room['playerSockets'].keys()][0]
      ;(ws as any).send = vi.fn(() => {
        throw new Error('send fail')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      m.room['sendSafe'](ws, { type: 'error', message: 'x' } as any)

      expect(errSpy).toHaveBeenCalled()
      expect(m.room['sessions'].has(ws)).toBe(false)
      expect(m.room['playerSockets'].has(pid)).toBe(false)
      errSpy.mockRestore()
    })
  })

  describe('getPlayers edge cases', () => {
    it('should deduplicate players by id', async () => {
      const m = await createRoom([])
      m.store.tables.players.set('dup1', { id: 'dup', name: 'One', is_host: 0 })
      m.store.tables.players.set('dup2', { id: 'dup', name: 'Two', is_host: 0 })

      const pl = m.room['getPlayers']()
      expect(pl.filter((p) => p.id === 'dup')).toHaveLength(1)
    })

    it('should return cached players when storage fails', async () => {
      const m = await createRoom()
      ;(m.room['ctx'].storage.sql as any).exec = vi.fn(() => {
        throw new Error('boom')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      m.room['cachedPlayers'] = [{ id: 'c1', name: 'C', isHost: false }]
      m.room['playersDirty'] = true

      const pl = m.room['getPlayers']()
      expect(pl).toEqual([{ id: 'c1', name: 'C', isHost: false }])
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })
})
