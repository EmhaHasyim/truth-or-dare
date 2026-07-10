import { DurableObject } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import type { ServerMessage } from '../types/ws'
import type { Bindings } from '../types'
import * as schema from '../db/schema'
import { fisherYatesShuffle } from '../lib/shuffle'
import { EMPTY_ROOM_TIMEOUT, EMPTY_ROOM_CHECK_INTERVAL, MAX_ROUNDS, TURN_TIMEOUT_MS, DISCONNECT_GRACE_MS } from '../constants'

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_game') }),
  z.object({ type: z.literal('select_truth') }),
  z.object({ type: z.literal('turn_done'), status: z.union([z.literal('completed'), z.literal('skipped')]) }),
  z.object({ type: z.literal('end_game') }),
])

export interface PlayerSession {
  playerId: string
  playerName: string
  isHost: boolean
}

interface GameState {
  id: string
  playerOrder: string[]
  currentPlayerIndex: number
  round: number
}

interface PlayerChoice {
  type: 'truth' | 'dare'
  questionId: string
}

export class RoomDO extends DurableObject<Bindings> {
  private sessions: Map<WebSocket, PlayerSession> = new Map()
  private playerSockets: Map<string, WebSocket> = new Map()
  private cachedPlayers: { id: string; name: string; isHost: boolean }[] = []
  private playersDirty = true
  private roomId = ''
  private currentChoices: Map<string, PlayerChoice> = new Map()
  private turnTimeoutId: ReturnType<typeof setTimeout> | null = null
  /** Tracks player IDs that are in the process of reconnecting.
   *  Prevents webSocketClose from cleaning up a player's state
   *  while onPlayerConnected is still setting up the new connection. */
  private connectingIds = new Set<string>()
  /** Flag set during the 3s turn transition delay to prevent
   *  onPlayerConnected from calling handleSelectType while
   *  handleTurnDone's delayed callback is about to do so. */
  private turnTransitionInProgress = false

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      await this.initializeStorage()
    })
  }

  private async initializeStorage(): Promise<void> {
    try {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          is_host INTEGER NOT NULL DEFAULT 0
        )
      `)
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS game (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'playing',
          player_order TEXT NOT NULL,
          current_player_index INTEGER NOT NULL DEFAULT 0,
          round INTEGER NOT NULL DEFAULT 1
        )
      `)
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS used_questions (
          player_id TEXT NOT NULL,
          question_id TEXT NOT NULL,
          PRIMARY KEY (player_id, question_id)
        )
      `)

      const roomIdRow = this.ctx.storage.sql.exec<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?', 'room_id'
      ).toArray()
      if (roomIdRow.length > 0) {
        this.roomId = roomIdRow[0].value
      }

      // If DO was evicted while room was empty, the alarm was lost.
      // Check if we need to re-schedule cleanup or clean up immediately.
      if (this.roomId) {
        await this.handleStaleEmptyRoom()
      }

      // Restore turn timeout if game was in progress when DO was evicted
      await this.restoreTimersOnInit()
    } catch (error) {
      console.error('Failed to initialize RoomDO storage:', error)
      throw error
    }
  }

  /**
   * If the DO was evicted while the room was marked empty (no players, no game),
   * the alarm that would have cleaned up the D1 room was lost.
   * This method re-schedules the alarm or cleans up immediately if the timeout has passed.
   */
  private async handleStaleEmptyRoom(): Promise<void> {
    const emptySinceRow = this.ctx.storage.sql.exec<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?', 'room_empty_since'
    ).toArray()
    if (emptySinceRow.length === 0) return // Room not empty, nothing to do

    const gameState = await this.getActiveGameState()
    if (gameState) return // Game in progress, ignore empty marker

    const emptySince = Number(emptySinceRow[0].value)
    const elapsed = Date.now() - emptySince

    if (elapsed >= EMPTY_ROOM_TIMEOUT) {
      // Room has been empty long enough — clean up immediately
      await this.cleanupRoomFromD1()
      this.clearAllLocalData()
    } else {
      // Re-schedule alarm for the remaining time
      const remaining = EMPTY_ROOM_TIMEOUT - elapsed
      await this.ctx.storage.setAlarm(Date.now() + Math.min(remaining, EMPTY_ROOM_CHECK_INTERVAL))
    }
  }

  private async cleanupRoomFromD1(): Promise<void> {
    if (!this.roomId) return
    try {
      const db = drizzle(this.env.DB, { schema })
      await db.delete(schema.rooms).where(eq(schema.rooms.id, this.roomId))
    } catch (error) {
      console.error('Failed to delete room from D1 on stale cleanup:', error)
    }
  }

  private clearAllLocalData(): void {
    this.ctx.storage.sql.exec('DELETE FROM players')
    this.ctx.storage.sql.exec('DELETE FROM game')
    this.ctx.storage.sql.exec('DELETE FROM used_questions')
    this.ctx.storage.sql.exec('DELETE FROM meta')
    this.cachedPlayers = []
    this.playersDirty = true
    this.roomId = ''
  }

  private async restoreTimersOnInit(): Promise<void> {
    // Check if there's a pending turn timeout that survived DO eviction
    const row = this.ctx.storage.sql.exec<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?', 'turn_started_at'
    ).toArray()

    if (row.length === 0) return

    const turnStartedAt = Number(row[0].value)
    const elapsed = Date.now() - turnStartedAt

    if (elapsed >= TURN_TIMEOUT_MS) {
      // Turn has already expired — auto-skip the current player's turn
      await this.autoSkipTurn()
    } else {
      // Schedule the remaining time
      const remaining = TURN_TIMEOUT_MS - elapsed
      this.turnTimeoutId = setTimeout(() => {
        this.autoSkipTurn()
      }, remaining)
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const playerName = url.searchParams.get('name') || ''
    const playerId = url.searchParams.get('playerId') || ''
    // Extract roomId from (in priority order):
    // 1. Search param (legacy from old server.ts that added ?roomId=)
    // 2. URL path (/ws/ROOM_ID)
    // 3. X-Room-Id header (set by some DO routing configurations)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const roomId = url.searchParams.get('roomId') ||
      request.headers.get('X-Room-Id') ||
      pathParts[pathParts.length - 1] ||
      ''

    const trimmedPlayerName = playerName.trim()
    if (!trimmedPlayerName || trimmedPlayerName.length > 20) {
      return new Response('Invalid player name', { status: 400 })
    }

    if (roomId && !this.roomId) {
      this.roomId = roomId
      this.ctx.storage.sql.exec(
        'INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)',
        'room_id',
        roomId
      )
    }

    const db = drizzle(this.env.DB, { schema })
    const registeredPlayers = this.roomId
      ? await db.select().from(schema.players).where(eq(schema.players.roomId, this.roomId)).all()
      : []

    const gameState = await this.getActiveGameState()

    if (gameState) {
      const isInGame = playerId ? gameState.playerOrder.includes(playerId) : false
      if (!isInGame) {
        return new Response('Game already in progress', { status: 403 })
      }
    } else {
      // Check authorization in this order:
      // 1. D1 player records (brand-new players just joined via REST API)
      // 2. DO local storage (players currently connected or recently connected)
      // 3. DO meta storage (disconnected players who can still reconnect)
      const isAuthorizedD1 = playerId
        ? registeredPlayers.some(p => p.id === playerId)
        : registeredPlayers.some(p => p.name === trimmedPlayerName)
      const doPlayers = this.getPlayers()
      const isAuthorizedDO = playerId
        ? doPlayers.some(p => p.id === playerId)
        : doPlayers.some(p => p.name === trimmedPlayerName)
      const isDisconnected = playerId
        ? this.ctx.storage.sql.exec<{ value: string }>(
            'SELECT value FROM meta WHERE key = ?', `disconnected_player_${playerId}`
          ).toArray().length > 0
        : false
      if (!isAuthorizedD1 && !isAuthorizedDO && !isDisconnected) {
        return new Response('Player not registered in this room', { status: 403 })
      }
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)

    server.serializeAttachment({ playerId, playerName: trimmedPlayerName, isHost: false })

    // Guard: prevent the old socket's webSocketClose from cleaning up player state
    // while this new connection is being set up. Must be set BEFORE the first
    // asynchronous operation to ensure webSocketClose sees the guard.
    if (playerId) {
      this.connectingIds.add(playerId)
    }

    // Clear the disconnected player marker (if any) since they're connecting now.
    if (playerId) {
      this.ctx.storage.sql.exec(
        'DELETE FROM meta WHERE key = ?', `disconnected_player_${playerId}`
      )
    }

    try {
      await this.onPlayerConnected(server, trimmedPlayerName, playerId)
    } finally {
      if (playerId) {
        this.connectingIds.delete(playerId)
      }
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  private async syncPlayersFromD1(): Promise<void> {
    if (!this.roomId) return
    try {
      const db = drizzle(this.env.DB, { schema })
      const roomPlayers = await db
        .select()
        .from(schema.players)
        .where(eq(schema.players.roomId, this.roomId))
        .all()
      for (const p of roomPlayers) {
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO players (id, name, is_host) VALUES (?, ?, ?)',
          p.id,
          p.name,
          p.isHost ? 1 : 0
        )
      }
      this.playersDirty = true
    } catch (error) {
      console.error('Failed to sync players from D1:', error)
    }
  }

  private async onPlayerConnected(server: WebSocket, playerName: string, urlPlayerId: string): Promise<void> {
    // Cancel any pending disconnect grace alarm — a player reconnected.
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'disconnect_grace_started_at')

    // Check reconnect status BEFORE syncPlayersFromD1() — after sync, new D1 players
    // would also be in DO storage, making it impossible to distinguish reconnects.
    const preSyncDoPlayers = this.getPlayers()
    let isReconnect = urlPlayerId
      ? preSyncDoPlayers.some(p => p.id === urlPlayerId)
      : preSyncDoPlayers.some(p => p.name === playerName)

    await this.syncPlayersFromD1()

    const att = server.deserializeAttachment() as PlayerSession | null
    const attachmentPlayerId = att?.playerId || ''
    
    let playerId = urlPlayerId || attachmentPlayerId
    
    if (!playerId) {
      const existingPlayers = this.getPlayers()
      const existing = existingPlayers.find(p => p.name === playerName)
      if (existing) {
        playerId = existing.id
      } else {
        playerId = crypto.randomUUID()
      }
    } else {
      const existingInDO = this.getPlayers().find(p => p.id === playerId)
      if (!existingInDO && this.roomId) {
        try {
          const db = drizzle(this.env.DB, { schema })
          const playerInD1 = await db
            .select()
            .from(schema.players)
            .where(eq(schema.players.id, playerId))
            .get()
          if (playerInD1) {
            this.ctx.storage.sql.exec(
              'INSERT OR REPLACE INTO players (id, name, is_host) VALUES (?, ?, ?)',
              playerInD1.id,
              playerInD1.name,
              playerInD1.isHost ? 1 : 0
            )
            this.playersDirty = true
          }
        } catch (error) {
          console.error('Failed to check D1 for playerId:', error)
        }
      }
    }

    const isHost = await this.verifyIsHost(playerName.trim())

    await this.ctx.storage.deleteAlarm()
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'room_empty_since')

    if (att) {
      att.playerId = playerId
      att.isHost = isHost
      server.serializeAttachment(att)
    }

    this.sessions.set(server, { playerId, playerName, isHost })
    
    const oldSocket = this.playerSockets.get(playerId)
    if (oldSocket && oldSocket !== server) {
      try { oldSocket.close(1000, 'Reconnected elsewhere') } catch { }
      this.sessions.delete(oldSocket)
    }
    this.playerSockets.set(playerId, server)

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO players (id, name, is_host) VALUES (?, ?, ?)',
      playerId,
      playerName,
      isHost ? 1 : 0
    )
    this.playersDirty = true

    // Sync player back to D1 so the lobby listing reflects actual connected players.
    // Players are deleted from D1 on disconnect (webSocketClose), so reconnects
    // must re-insert. Use onConflictDoNothing in case the player never disconnected.
    if (this.roomId) {
      try {
        const d1db = drizzle(this.env.DB, { schema })
        await d1db.insert(schema.players).values({
          id: playerId,
          roomId: this.roomId,
          name: playerName,
          isHost,
        }).onConflictDoNothing()
      } catch (error) {
        console.error('Failed to sync player to D1 on connect:', error)
      }
    }

    const players = this.getPlayers()
    this.sendSafe(server, { type: 'room_state', playerId, players } satisfies ServerMessage)

    if (!isReconnect) {
      this.broadcast({
        type: 'player_joined',
        playerId,
        playerName,
        isHost,
        players,
      } satisfies ServerMessage, server)

      // Keep all clients in sync: send room_state to every existing player
      for (const [existingWs, existingSess] of this.sessions) {
        if (existingWs !== server) {
          this.sendSafe(existingWs, {
            type: 'room_state',
            playerId: existingSess.playerId,
            players,
          } satisfies ServerMessage)
        }
      }
    }

    const gameState = await this.getActiveGameState()
    if (gameState) {
      this.sendSafe(server, {
        type: 'game_started',
        gameId: gameState.id,
        playerOrder: gameState.playerOrder,
        currentPlayerIndex: gameState.currentPlayerIndex,
        round: gameState.round,
      } satisfies ServerMessage)

      const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex]
      if (currentPlayerId === playerId) {
        // Check if player already has a pending choice (reconnect after selecting truth/dare)
        const stored = this.ctx.storage.sql.exec<{ value: string }>(
          'SELECT value FROM meta WHERE key = ?', `choice_${playerId}`
        ).toArray()
        if (stored.length > 0) {
          try {
            const choice = JSON.parse(stored[0].value) as PlayerChoice
            const db = drizzle(this.env.DB, { schema })
            const question = await db
              .select()
              .from(schema.questions)
              .where(eq(schema.questions.id, choice.questionId))
              .get()
            if (question) {
              const cp = players.find((p) => p.id === playerId)
              this.sendSafe(server, {
                type: 'turn_question',
                playerId,
                playerName: cp?.name || playerName,
                questionType: choice.type,
                question: question.text,
                questionId: choice.questionId,
              } satisfies ServerMessage)
              return
            }
          } catch {}
        }

        // If a turn transition is in progress (3s delay after previous turn),
        // don't call handleSelectType yet — handleTurnDone's delayed callback
        // will handle it after the delay expires.
        if (this.turnTransitionInProgress) {
          const cp = players.find((p) => p.id === currentPlayerId)
          this.sendSafe(server, {
            type: 'waiting_for_choice',
            playerId: currentPlayerId,
            playerName: cp?.name || playerName,
          } satisfies ServerMessage)
          return
        }

        // Truth-only mode: auto-assign truth question
        const cp = players.find((p) => p.id === playerId)
        if (cp) {
          const sess: PlayerSession = { playerId: cp.id, playerName: cp.name, isHost: cp.isHost }
          await this.handleSelectType(sess, 'truth')
        }
      } else {
        const cp2 = players.find((p) => p.id === currentPlayerId)
        this.sendSafe(server, {
          type: 'waiting_for_choice',
          playerId: currentPlayerId,
          playerName: cp2?.name || '',
        } satisfies ServerMessage)
      }
    }
  }

  private async getActiveGameState(): Promise<GameState | null> {
    try {
      const gameRows = this.ctx.storage.sql.exec<{
        id: string
        player_order: string
        current_player_index: number
        round: number
      }>('SELECT id, player_order, current_player_index, round FROM game WHERE status = ?', 'playing').toArray()
      
      if (gameRows.length === 0) return null
      
      const gr = gameRows[0]
      return {
        id: gr.id,
        playerOrder: JSON.parse(gr.player_order),
        currentPlayerIndex: gr.current_player_index,
        round: gr.round,
      }
    } catch (error) {
      console.error('Failed to get active game state:', error)
      return null
    }
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    let sess = this.sessions.get(ws)
    if (!sess) {
      const att = ws.deserializeAttachment()
      if (att) {
        sess = att as PlayerSession
        if (!this.sessions.has(ws)) {
          this.sessions.set(ws, sess)
          this.playerSockets.set(sess.playerId, ws)
        }
      }
    }

    if (!sess) {
      this.sendSafe(ws, { type: 'error', message: 'Not connected properly' } satisfies ServerMessage)
      return
    }

    let parsed: unknown
    try { 
      parsed = JSON.parse(message) 
    } catch {
      this.sendSafe(ws, { type: 'error', message: 'Invalid message format' } satisfies ServerMessage)
      return 
    }

    const result = clientMessageSchema.safeParse(parsed)
    if (!result.success) {
      this.sendSafe(ws, { type: 'error', message: 'Invalid message format' } satisfies ServerMessage)
      return
    }

    const data = result.data

    switch (data.type) {
      case 'start_game':
        await this.handleStartGame(sess)
        break
      case 'select_truth':
        await this.handleSelectType(sess, 'truth')
        break
      case 'turn_done':
        await this.handleTurnDone(sess, data.status)
        break
      case 'end_game':
        await this.handleEndGame(sess)
        break
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment()
    this.sessions.delete(ws)

    if (!att) {
      // DO was evicted and restarted — attachment (player session) is lost.
      // But DO SQLite storage still has the player/room data.
      // If no game is active, clean up stale D1 room data so it doesn't
      // appear in the lobby listing forever.
      const gameState = await this.getActiveGameState()
      if (!gameState && this.roomId) {
        await this.cleanupRoomFromD1()
      }
      return
    }

    const sess = att as PlayerSession

    // If a reconnection is in progress for this player, skip cleanup entirely.
    // The new onPlayerConnected handler already set up the new socket
    // (before any await), so we must not touch playerSockets here.
    if (this.connectingIds.has(sess.playerId)) {
      return
    }

    const actualSocket = this.playerSockets.get(sess.playerId)
    if (actualSocket !== ws) {
      // New socket already took over — don't delete the player or broadcast left
      return
    }
    this.playerSockets.delete(sess.playerId)

    const gameState = await this.getActiveGameState()
    if (!gameState) {
      // Player disconnected during lobby phase.
      // Save player info in meta storage so they can reconnect even after
      // being cleaned up from D1. The meta marker is cleared on next connect.
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
        `disconnected_player_${sess.playerId}`,
        JSON.stringify({ name: sess.playerName, isHost: sess.isHost })
      )

      this.ctx.storage.sql.exec('DELETE FROM players WHERE id = ?', sess.playerId)

      // Hapus dari D1 juga agar lobby listing tidak menampilkan player yang sudah disconnect.
      if (this.roomId) {
        try {
          const d1db = drizzle(this.env.DB, { schema })
          await d1db.delete(schema.players).where(eq(schema.players.id, sess.playerId))
        } catch (error) {
          console.error('Failed to delete player from D1 on disconnect:', error)
        }
      }
    }

    this.playersDirty = true

    // During an active game, skip the player_left broadcast to avoid flicker
    // during lobby→game WS transition. The reconnecting player's new WS
    // connection sends room_state with the full player list.
    if (!gameState) {
      const leftPlayers = this.getPlayers()
      this.broadcast({
        type: 'player_left',
        playerId: sess.playerId,
        players: leftPlayers,
      } satisfies ServerMessage)
    }

    // All players disconnected during an active game → give them a grace period
    // to reconnect before ending the game. This prevents the game from ending
    // when both players reconnect simultaneously (e.g., lobby→game transition,
    // network blip, etc.).
    if (gameState && this.sessions.size === 0) {
      const now = Date.now()
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
        'disconnect_grace_started_at',
        String(now)
      )
      await this.ctx.storage.setAlarm(now + DISCONNECT_GRACE_MS)
      return
    }

    const remainingPlayers = this.getPlayers()
    if (remainingPlayers.length === 0 && !gameState) {
      // Room is empty with no active game — delete from D1 immediately
      // so it disappears from the lobby listing instead of showing stale player counts.
      // DO local storage is preserved for potential reconnection within the timeout.
      await this.cleanupRoomFromD1()

      const now = Date.now()
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
        'room_empty_since',
        String(now)
      )
      await this.ctx.storage.setAlarm(now + EMPTY_ROOM_CHECK_INTERVAL)
    } else if (remainingPlayers.length > 0) {
      this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'room_empty_since')
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Clean up session state proactively in case webSocketClose doesn't follow.
    // The Workers runtime typically calls webSocketClose after webSocketError,
    // but this isn't guaranteed by spec — if it doesn't, we'd leak the session.
    const sess = this.sessions.get(ws)
    if (sess) {
      this.playerSockets.delete(sess.playerId)
      this.sessions.delete(ws)
    }
    console.error('RoomDO WebSocket error:', error)
  }

  async alarm(): Promise<void> {
    // Check if this is a disconnect grace alarm (all players went offline during game).
    const graceRow = this.ctx.storage.sql.exec<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?', 'disconnect_grace_started_at'
    ).toArray()
    if (graceRow.length > 0) {
      const startedAt = Number(graceRow[0].value)
      const elapsed = Date.now() - startedAt
      if (elapsed >= DISCONNECT_GRACE_MS) {
        // Grace period expired — no one reconnected, end the game and clean up.
        const gameState = await this.getActiveGameState()
        if (gameState) {
          await this.endGame(gameState)
          await this.cleanupRoomFromD1()
          this.clearAllLocalData()
        }
      } else {
        // Grace period hasn't expired yet, re-schedule the remainder.
        const remaining = DISCONNECT_GRACE_MS - elapsed
        await this.ctx.storage.setAlarm(Date.now() + Math.min(remaining, EMPTY_ROOM_CHECK_INTERVAL))
      }
      return
    }

    if (await this.getActiveGameState()) return
    if (this.getPlayers().length > 0) return

    const row = this.ctx.storage.sql.exec<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?', 'room_empty_since'
    ).toArray()
    const emptySince = row.length > 0 ? Number(row[0].value) : Date.now()
    const elapsed = Date.now() - emptySince

    if (elapsed < EMPTY_ROOM_TIMEOUT) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_CHECK_INTERVAL)
      return
    }

    if (this.roomId) {
      await this.cleanupRoomFromD1()
    }

    this.clearAllLocalData()
  }

  private async verifyIsHost(playerName: string): Promise<boolean> {
    const normalized = playerName.trim()
    if (!this.roomId || !normalized) return false
    try {
      // Check cache in DO storage first
      const cached = this.ctx.storage.sql.exec<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?', 'room_host'
      ).toArray()
      if (cached.length > 0) {
        return cached[0].value === normalized
      }

      const db = drizzle(this.env.DB, { schema })
      const room = await db
        .select({ hostName: schema.rooms.hostName })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, this.roomId))
        .get()
      // Host name was normalized (trimmed) on room creation, so direct comparison is safe
      const isHost = room?.hostName === normalized

      // Cache the host name for future lookups
      if (room?.hostName) {
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
          'room_host',
          room.hostName
        )
      }

      return isHost
    } catch (error) {
      console.error('Failed to verify host:', error)
      return false
    }
  }

  private async handleStartGame(sess: PlayerSession): Promise<void> {
    if (!sess.isHost) {
      this.sendSafe(this.playerSockets.get(sess.playerId), { type: 'error', message: 'Only the host can start the game' } satisfies ServerMessage)
      return
    }

    const existingGame = await this.getActiveGameState()
    if (existingGame) return

    const players = this.getPlayers()
    if (players.length < 2) {
      this.sendSafe(this.playerSockets.get(sess.playerId), { type: 'error', message: 'Need at least 2 players to start' } satisfies ServerMessage)
      return
    }

    const roomId = this.roomId
    const shuffled = fisherYatesShuffle(players)
    const playerOrder = shuffled.map((p) => p.id)
    const gameId = crypto.randomUUID()

    try {
      const db = drizzle(this.env.DB, { schema })
      await db.insert(schema.games).values({
        id: gameId,
        roomId,
        status: 'playing',
        playerOrder: JSON.stringify(playerOrder),
        currentPlayerIndex: 0,
        round: 1,
      })

      await db
        .update(schema.rooms)
        .set({ status: 'playing' })
        .where(eq(schema.rooms.id, roomId))

      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO game (id, room_id, status, player_order, current_player_index, round) VALUES (?, ?, ?, ?, ?, ?)',
        gameId,
        roomId,
        'playing',
        JSON.stringify(playerOrder),
        0,
        1
      )

      this.broadcast({
        type: 'game_started',
        gameId,
        playerOrder,
        currentPlayerIndex: 0,
        round: 1,
      } satisfies ServerMessage)

      // Truth-only: immediately assign truth question to first player
      const firstPlayer = players.find(p => p.id === playerOrder[0])
      if (firstPlayer) {
        const firstSess: PlayerSession = {
          playerId: firstPlayer.id,
          playerName: firstPlayer.name,
          isHost: firstPlayer.isHost,
        }
        await this.handleSelectType(firstSess, 'truth')
      }
    } catch (error) {
      console.error('Failed to start game:', error)
      this.sendSafe(this.playerSockets.get(sess.playerId), { type: 'error', message: 'Failed to start game' } satisfies ServerMessage)
    }
  }

  private async handleSelectType(sess: PlayerSession, selectedType: 'truth' | 'dare'): Promise<void> {
    const gameState = await this.getActiveGameState()
    if (!gameState) return

    const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex]
    if (sess.playerId !== currentPlayerId) return

    // Prevent duplicate choices
    if (this.currentChoices.has(sess.playerId)) return

    // Player responded — clear the turn choice timeout
    this.clearTurnTimeout()

    const db = drizzle(this.env.DB, { schema })

    const pickQuestion = async (type: 'truth' | 'dare') => {
      try {
        // Get all available question IDs: query all questions of the type,
        // then exclude used ones. Uses a local used_questions table (DO SQL)
        // to avoid re-querying D1 for each turn.
        const allQuestions = await db
          .select({ id: schema.questions.id, text: schema.questions.text })
          .from(schema.questions)
          .where(eq(schema.questions.type, type))
          .all()

        const usedIds = this.ctx.storage.sql.exec<{ question_id: string }>(
          'SELECT question_id FROM used_questions WHERE player_id = ?',
          sess.playerId
        ).toArray()
        const usedSet = new Set(usedIds.map((r) => r.question_id))

        const available = allQuestions.filter((q) => !usedSet.has(q.id))
        if (available.length === 0) return null

        const idx = crypto.getRandomValues(new Uint32Array(1))[0] % available.length
        return available[idx]
      } catch (error) {
        console.error('Failed to pick question:', error)
        return null
      }
    }

    // Truth-only mode: only pick truth questions
    let picked = await pickQuestion('truth')
    if (!picked) {
      // No database questions available — use a fallback question
      picked = this.getFallbackQuestion('truth')
    }
    if (!picked) {
      // No questions available at all — auto-skip this turn instead of softlocking
      await this.handleTurnDone(sess, 'skipped')
      return
    }

    const choice: PlayerChoice = { type: selectedType, questionId: picked.id }
    this.currentChoices.set(sess.playerId, choice)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      `choice_${sess.playerId}`,
      JSON.stringify(choice)
    )

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO used_questions (player_id, question_id) VALUES (?, ?)',
      sess.playerId,
      picked.id
    )

    this.broadcast({
      type: 'turn_question',
      playerId: sess.playerId,
      playerName: sess.playerName,
      questionType: selectedType,
      question: picked.text,
      questionId: picked.id,
    } satisfies ServerMessage)

    // Start turn timeout: if player doesn't respond within TURN_TIMEOUT_MS, auto-skip
    this.scheduleTurnTimeout(sess.playerId)
  }

  private static FALLBACK_QUESTIONS: { type: 'truth' | 'dare'; text: string }[] = [
    { type: 'truth', text: 'Apa hal paling random yang ada di pikiranmu sekarang?' },
    { type: 'truth', text: 'Apa aplikasi di HP-mu yang paling boros waktu?' },
    { type: 'truth', text: 'Siapa orang yang paling sering kamu chat setiap hari?' },
    { type: 'truth', text: 'Apa ketakutan terbesar kamu?' },
    { type: 'truth', text: 'Apa satu tempat yang paling ingin kamu kunjungi?' },
  ]

  private static fallbackCounter = 0

  private getFallbackQuestion(_type: 'truth' | 'dare'): { id: string; type: 'truth' | 'dare'; text: string; createdAt: Date } | null {
    const fallbacks = RoomDO.FALLBACK_QUESTIONS
    if (fallbacks.length === 0) return null
    const idx = crypto.getRandomValues(new Uint32Array(1))[0] % fallbacks.length
    const picked = fallbacks[idx]
    RoomDO.fallbackCounter++
    return { id: `fallback_${RoomDO.fallbackCounter}`, type: 'truth', text: picked.text, createdAt: new Date() }
  }

  private async handleTurnDone(sess: PlayerSession, status: 'completed' | 'skipped'): Promise<void> {
    const gameState = await this.getActiveGameState()
    if (!gameState) return

    const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex]
    if (sess.playerId !== currentPlayerId) return

    // Clear turn timeout (only timer remaining)
    this.clearTurnTimeout()

    const db = drizzle(this.env.DB, { schema })

    let nextIdx = gameState.currentPlayerIndex + 1
    let nextRound = gameState.round
    if (nextIdx >= gameState.playerOrder.length) {
      nextIdx = 0
      nextRound += 1
    }

    // Retrieve choice before any guard clauses that might return early
    let choice = this.currentChoices.get(sess.playerId)
    if (!choice) {
      const stored = this.ctx.storage.sql.exec<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?', `choice_${sess.playerId}`
      ).toArray()
      if (stored.length > 0) {
        try {
          choice = JSON.parse(stored[0].value) as PlayerChoice
        } catch {
          choice = undefined
        }
      }
    }

    // Auto-end game if max rounds reached.
    // IMPORTANT: this check is intentionally placed AFTER choice retrieval so that
    // the final turn_result can be broadcast before game_ended.
    if (MAX_ROUNDS > 0 && nextRound > MAX_ROUNDS) {
      // Clean up the choice before ending
      this.currentChoices.delete(sess.playerId)
      this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', `choice_${sess.playerId}`)

      // Broadcast the final turn result so all clients see it before game_ended
      const fPlayers = this.getPlayers()
      const fNextPlayer = fPlayers.find((p) => p.id === gameState.playerOrder[nextIdx])
      const fSelectedType = choice?.type ?? 'truth'

      this.broadcast({
        type: 'turn_result',
        playerId: sess.playerId,
        playerName: sess.playerName,
        status,
        questionType: fSelectedType,
        nextPlayerId: gameState.playerOrder[nextIdx],
        nextPlayerName: fNextPlayer?.name || '',
        round: nextRound,
      } satisfies ServerMessage)

      await this.endGame(gameState)
      return
    }

    this.currentChoices.delete(sess.playerId)
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', `choice_${sess.playerId}`)

    try {
      await db
        .update(schema.games)
        .set({ currentPlayerIndex: nextIdx, round: nextRound })
        .where(eq(schema.games.id, gameState.id))

      // Only record a turn in D1 if the player actually chose truth/dare.
      // Auto-skips (timeouts before picking) don't have a choice,
      // so omitting the turn row avoids recording a misleading type.
      if (choice) {
        const questionId = choice.questionId || null
        await db.insert(schema.turns).values({
          gameId: gameState.id,
          round: gameState.round,
          playerId: sess.playerId,
          type: choice.type,
          questionId,
          status,
        })
      }

      this.ctx.storage.sql.exec(
        'UPDATE game SET current_player_index = ?, round = ? WHERE id = ?',
        nextIdx,
        nextRound,
        gameState.id
      )
    } catch (error) {
      console.error('Failed to record turn:', error)
      return
    }

    const nextPlayerId = gameState.playerOrder[nextIdx]
    const players = this.getPlayers()
    const nextPlayer = players.find((p) => p.id === nextPlayerId)

    // Determine question type for the broadcast.
    // For auto-skips (no choice made, timeout before selecting truth/dare),
    // fall back to 'truth' as a display-only value.
    const selectedType = choice?.type ?? 'truth'

    this.broadcast({
      type: 'turn_result',
      playerId: sess.playerId,
      playerName: sess.playerName,
      status,
      questionType: selectedType,
      nextPlayerId,
      nextPlayerName: nextPlayer?.name || '',
      round: nextRound,
    } satisfies ServerMessage)

    // Truth-only: wait 3s (matching client's turn_result display), then auto-assign truth
    if (nextPlayer) {
      // Snapshot the expected game state to detect if client grabbed the turn during delay
      const expectedIdx = nextIdx
      const expectedPlayerId = nextPlayerId

      this.turnTransitionInProgress = true

      await new Promise(resolve => setTimeout(resolve, 3000))

      // Check if game state is still valid AND hasn't advanced
      const current = await this.getActiveGameState()
      if (!current) {
        this.turnTransitionInProgress = false
        return
      }
      if (current.currentPlayerIndex !== expectedIdx ||
          current.playerOrder[current.currentPlayerIndex] !== expectedPlayerId) {
        // Game state already advanced — next player already got/handled their question
        this.turnTransitionInProgress = false
        return
      }

      const nextSess: PlayerSession = {
        playerId: nextPlayer.id,
        playerName: nextPlayer.name,
        isHost: nextPlayer.isHost,
      }
      try {
        await this.handleSelectType(nextSess, 'truth')
      } finally {
        this.turnTransitionInProgress = false
      }
    }
  }

  private async handleEndGame(sess: PlayerSession): Promise<void> {
    if (!sess.isHost) {
      this.sendSafe(this.playerSockets.get(sess.playerId), { type: 'error', message: 'Only the host can end the game' } satisfies ServerMessage)
      return
    }

    const gameState = await this.getActiveGameState()
    if (!gameState) return

    await this.endGame(gameState)
  }

  private async endGame(gameState: GameState): Promise<void> {
    // Clean up turn-related state
    this.clearTurnTimeout()
    this.turnTransitionInProgress = false
    this.currentChoices.clear()
    this.ctx.storage.sql.exec("DELETE FROM meta WHERE key LIKE 'choice_%'")
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'turn_started_at')

    try {
      // DO local state FIRST (synchronous — no yield point) so that
      // getActiveGameState() returns null before any await yields to
      // other handlers (like the setTimeout callback in handleTurnDone).
      this.ctx.storage.sql.exec(
        'UPDATE game SET status = ? WHERE id = ?',
        'finished',
        gameState.id
      )

      const db = drizzle(this.env.DB, { schema })
      await db
        .update(schema.games)
        .set({ status: 'finished', finishedAt: new Date() })
        .where(eq(schema.games.id, gameState.id))

      await db
        .update(schema.rooms)
        .set({ status: 'finished' })
        .where(eq(schema.rooms.id, this.roomId))

      this.broadcast({
        type: 'game_ended',
      } satisfies ServerMessage)
    } catch (error) {
      console.error('Failed to end game:', error)
    }
  }

  private scheduleTurnTimeout(playerId: string): void {
    this.clearTurnTimeout()
    const now = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'turn_started_at',
      String(now)
    )
    this.turnTimeoutId = setTimeout(() => {
      this.turnTimeoutId = null
      this.autoSkipTurn()
    }, TURN_TIMEOUT_MS)
  }

  private async autoSkipTurn(): Promise<void> {
    const gameState = await this.getActiveGameState()
    if (!gameState) return

    const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex]
    const players = this.getPlayers()
    const currentPlayer = players.find(p => p.id === currentPlayerId)
    if (!currentPlayer) return

    // Clear stored turn timer marker since we're processing it now
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'turn_started_at')

    const sess: PlayerSession = {
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      isHost: currentPlayer.isHost,
    }
    await this.handleTurnDone(sess, 'skipped')
  }

  private clearTurnTimeout(): void {
    if (this.turnTimeoutId !== null) {
      clearTimeout(this.turnTimeoutId)
      this.turnTimeoutId = null
    }
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'turn_started_at')
  }

  private sendSafe(ws: WebSocket | undefined, msg: ServerMessage): void {
    if (!ws) return
    try {
      ws.send(JSON.stringify(msg))
    } catch (error) {
      console.error('Failed to send message:', error)
      const att = ws.deserializeAttachment() as PlayerSession | null
      if (att) {
        this.playerSockets.delete(att.playerId)
        this.sessions.delete(ws)
      }
    }
  }

  private getPlayers(): { id: string; name: string; isHost: boolean }[] {
    if (!this.playersDirty && this.cachedPlayers.length > 0) {
      return this.cachedPlayers
    }
    try {
      const rows = this.ctx.storage.sql.exec<{ id: string; name: string; is_host: number }>(
        'SELECT id, name, is_host FROM players'
      ).toArray()
      
      // Deduplicate by playerId (keep first occurrence)
      const seen = new Set<string>()
      this.cachedPlayers = rows
        .filter((r) => {
          if (seen.has(r.id)) return false
          seen.add(r.id)
          return true
        })
        .map((r) => ({ id: r.id, name: r.name, isHost: !!r.is_host }))
      
      this.playersDirty = false
      return this.cachedPlayers
    } catch (error) {
      console.error('Failed to get players:', error)
      return this.cachedPlayers
    }
  }

  private broadcast(msg: ServerMessage, exclude?: WebSocket): void {
    for (const [ws] of this.sessions) {
      if (ws !== exclude) {
        this.sendSafe(ws, msg)
      }
    }
  }
}