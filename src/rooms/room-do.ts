import { DurableObject } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { createDb, type DbInstance } from '../db'
import type { ServerMessage } from '../types/ws'
import type { Bindings } from '../types'
import * as schema from '../db/schema'
import { clientMessageSchema } from '../types/ws-validation'
import { fisherYatesShuffle } from '../lib/shuffle'
import { randomInt } from '../lib/random'
import { EMPTY_ROOM_TIMEOUT, MAX_ROUNDS, TURN_TIMEOUT_MS, DISCONNECT_GRACE_MS } from '../constants'

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
  private dbInstance: DbInstance | null = null

  private sessions: Map<WebSocket, PlayerSession> = new Map()
  private playerSockets: Map<string, WebSocket> = new Map()
  private cachedPlayers: { id: string; name: string; isHost: boolean }[] = []
  private playersDirty = true
  private roomId = ''
  private currentChoices: Map<string, PlayerChoice> = new Map()
  /** Tracks player IDs that are in the process of reconnecting.
   *  Prevents webSocketClose from cleaning up a player's state
   *  while onPlayerConnected is still setting up the new connection. */
  private connectingIds = new Set<string>()
  /** Flag set during the 3s turn transition delay to prevent
   *  onPlayerConnected from calling handleSelectType while
   *  handleTurnDone's delayed callback is about to do so. */
  private turnTransitionInProgress = false
  /** Players currently in the middle of picking a question. Set synchronously
   *  (before any await) so duplicate concurrent select_truth messages can't
   *  both pick a question. */
  private selectingPlayers = new Set<string>()
  /** Whether the DO-local question cache has been loaded from D1. */
  private questionCacheLoaded = false

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
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS question_cache (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          text TEXT NOT NULL
        )
      `)

      const roomIdRow = this.ctx.storage.sql
        .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'room_id')
        .toArray()
      if (roomIdRow.length > 0) {
        this.roomId = roomIdRow[0].value
      }

      // If DO was evicted while room was empty, the alarm was lost.
      // Check if we need to re-schedule cleanup or clean up immediately.
      if (this.roomId) {
        await this.handleStaleEmptyRoom()
        await this.armTurnTimeoutIfMissing()
      }
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
    const emptySinceRow = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'room_empty_since')
      .toArray()
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
      // Re-arm the alarm for the deadline. DO alarms are durable and survive
      // evictions/restarts, so the cleanup still happens even if the DO sleeps.
      await this.scheduleAlarm()
    }
  }

  /**
   * Re-arms the durable turn timeout after a DO restart when a game is in
   * progress but no turn marker survived (e.g. the DO restarted during the 3s
   * turn transition, when the marker is briefly absent). Without this, a game
   * could hang forever if the current player never reconnects — no alarm would
   * ever fire to auto-skip their turn.
   */
  private async armTurnTimeoutIfMissing(): Promise<void> {
    const gameState = await this.getActiveGameState()
    if (!gameState) return

    const turnRow = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'turn_started_at')
      .toArray()
    if (turnRow.length > 0) return

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'turn_started_at',
      String(Date.now()),
    )
    await this.scheduleAlarm()
  }

  private async cleanupRoomFromD1(): Promise<void> {
    if (!this.roomId) return
    try {
      const db = this.getDb()
      await db.delete(schema.rooms).where(eq(schema.rooms.id, this.roomId))
    } catch (error) {
      console.error('Failed to delete room from D1 on stale cleanup:', error)
    }
  }

  private clearAllLocalData(): void {
    this.ctx.storage.sql.exec('DELETE FROM players')
    this.ctx.storage.sql.exec('DELETE FROM game')
    this.ctx.storage.sql.exec('DELETE FROM used_questions')
    this.ctx.storage.sql.exec('DELETE FROM question_cache')
    this.ctx.storage.sql.exec('DELETE FROM meta')
    this.cachedPlayers = []
    this.playersDirty = true
    this.questionCacheLoaded = false
    this.roomId = ''
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
    const roomId =
      url.searchParams.get('roomId') ||
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
        roomId,
      )
    }

    const db = this.getDb()
    const registeredPlayers = this.roomId
      ? await db.select().from(schema.players).where(eq(schema.players.roomId, this.roomId)).all()
      : []

    // ── Identity & authorization ──
    // A playerId is REQUIRED and must belong to this room; the provided name
    // must match the registered name. Name-only connections are rejected to
    // prevent impersonation: player names are visible to everyone in the room,
    // so accepting a bare name would let anyone take over another player's
    // identity (including the host). Legitimate reconnects still work via
    // playerId + the disconnected_player_* markers kept in DO storage.
    if (!playerId) {
      return new Response('playerId is required', { status: 403 })
    }

    const doPlayers = this.getPlayers()
    const d1Player = registeredPlayers.find((p) => p.id === playerId)
    const doPlayer = doPlayers.find((p) => p.id === playerId)
    const disconnected = this.findDisconnectedPlayer(playerId)

    if (!d1Player && !doPlayer && !disconnected) {
      return new Response('Player not registered in this room', { status: 403 })
    }
    const expectedName = d1Player?.name ?? doPlayer?.name ?? disconnected?.name ?? ''
    if (expectedName !== trimmedPlayerName) {
      return new Response('Player name does not match', { status: 403 })
    }

    const gameState = await this.getActiveGameState()
    if (gameState && !gameState.playerOrder.includes(playerId)) {
      return new Response('Game already in progress', { status: 403 })
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
      this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', `disconnected_player_${playerId}`)
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
      const db = this.getDb()
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
          p.isHost ? 1 : 0,
        )
      }
      this.playersDirty = true
    } catch (error) {
      console.error('Failed to sync players from D1:', error)
    }
  }

  private async onPlayerConnected(
    server: WebSocket,
    playerName: string,
    urlPlayerId: string,
  ): Promise<void> {
    // Cancel any pending disconnect grace alarm — a player reconnected.
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'disconnect_grace_started_at')

    // Check reconnect status BEFORE syncPlayersFromD1() — after sync, new D1 players
    // would also be in DO storage, making it impossible to distinguish reconnects.
    const preSyncDoPlayers = this.getPlayers()
    let isReconnect = urlPlayerId
      ? preSyncDoPlayers.some((p) => p.id === urlPlayerId)
      : preSyncDoPlayers.some((p) => p.name === playerName)

    await this.syncPlayersFromD1()

    const att = server.deserializeAttachment() as PlayerSession | null
    const attachmentPlayerId = att?.playerId || ''

    // fetch() already validated the playerId and matched it against the
    // registered name, so identity is fixed here. We deliberately do NOT
    // re-resolve identity by name — that would allow impersonating another
    // player by connecting with their name alone.
    let playerId = urlPlayerId || attachmentPlayerId
    if (!playerId) {
      // Defensive fallback: fetch() normally rejects connections without a playerId.
      playerId = crypto.randomUUID()
    } else {
      const existingInDO = this.getPlayers().find((p) => p.id === playerId)
      if (!existingInDO && this.roomId) {
        try {
          const db = this.getDb()
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
              playerInD1.isHost ? 1 : 0,
            )
            this.playersDirty = true
          }
        } catch (error) {
          console.error('Failed to check D1 for playerId:', error)
        }
      }
    }

    const isHost = await this.verifyIsHost(playerName.trim())

    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'room_empty_since')
    await this.scheduleAlarm()

    if (att) {
      att.playerId = playerId
      att.isHost = isHost
      server.serializeAttachment(att)
    }

    this.sessions.set(server, { playerId, playerName, isHost })

    const oldSocket = this.playerSockets.get(playerId)
    if (oldSocket && oldSocket !== server) {
      try {
        oldSocket.close(1000, 'Reconnected elsewhere')
      } catch {}
      this.sessions.delete(oldSocket)
    }
    this.playerSockets.set(playerId, server)

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO players (id, name, is_host) VALUES (?, ?, ?)',
      playerId,
      playerName,
      isHost ? 1 : 0,
    )
    this.playersDirty = true

    // Sync player back to D1 so the lobby listing reflects actual connected players.
    // Players are deleted from D1 on disconnect (webSocketClose), so reconnects
    // must re-insert. Use onConflictDoNothing in case the player never disconnected.
    if (this.roomId) {
      try {
        const d1db = this.getDb()
        await d1db
          .insert(schema.players)
          .values({
            id: playerId,
            roomId: this.roomId,
            name: playerName,
            isHost,
          })
          .onConflictDoNothing()
      } catch (error) {
        console.error('Failed to sync player to D1 on connect:', error)
      }
      // Bump the room's last-active timestamp so the periodic cron cleanup
      // never deletes a room that still has players connected.
      try {
        await this.env.DB.prepare('UPDATE rooms SET last_active_at = ? WHERE id = ?')
          .bind(Date.now(), this.roomId)
          .run()
      } catch (error) {
        console.error('Failed to update room activity:', error)
      }
    }

    const players = this.getPlayers()
    this.sendSafe(server, { type: 'room_state', playerId, players } satisfies ServerMessage)

    if (!isReconnect) {
      this.broadcast(
        {
          type: 'player_joined',
          playerId,
          playerName,
          isHost,
          players,
        } satisfies ServerMessage,
        server,
      )
    }

    // Keep all clients in sync: send room_state to every existing player.
    // This also runs on reconnects so other players' lists don't show a stale
    // player count after someone's connection blipped and recovered.
    for (const [existingWs, existingSess] of this.sessions) {
      if (existingWs !== server) {
        this.sendSafe(existingWs, {
          type: 'room_state',
          playerId: existingSess.playerId,
          players,
        } satisfies ServerMessage)
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
        const stored = this.ctx.storage.sql
          .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', `choice_${playerId}`)
          .toArray()
        if (stored.length > 0) {
          try {
            const choice = JSON.parse(stored[0].value) as PlayerChoice
            const db = this.getDb()
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
      const gameRows = this.ctx.storage.sql
        .exec<{
          id: string
          player_order: string
          current_player_index: number
          round: number
        }>(
          'SELECT id, player_order, current_player_index, round FROM game WHERE status = ?',
          'playing',
        )
        .toArray()

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
      this.sendSafe(ws, {
        type: 'error',
        message: 'Not connected properly',
      } satisfies ServerMessage)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      this.sendSafe(ws, {
        type: 'error',
        message: 'Invalid message format',
      } satisfies ServerMessage)
      return
    }

    const result = clientMessageSchema.safeParse(parsed)
    if (!result.success) {
      this.sendSafe(ws, {
        type: 'error',
        message: 'Invalid message format',
      } satisfies ServerMessage)
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
      // But DO SQLite storage still has the player/room data, and the D1 room
      // row is kept so players can reconnect via the room link. If no game is
      // active, arm the empty-room cleanup instead of deleting the row
      // immediately (the alarm removes it after EMPTY_ROOM_TIMEOUT, and the
      // hourly cron backs that up).
      const gameState = await this.getActiveGameState()
      if (!gameState && this.roomId) {
        const now = Date.now()
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
          'room_empty_since',
          String(now),
        )
        await this.scheduleAlarm()
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
      await this.handleLobbyPlayerLeave(sess)
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
        String(now),
      )
      await this.scheduleAlarm()
      return
    }

    const remainingPlayers = this.getPlayers()
    if (remainingPlayers.length === 0 && !gameState) {
      // Room is empty with no active game — KEEP the D1 room row so the room
      // stays joinable from the lobby and the last player can reconnect via
      // the room link. Deleting it here made the room page 404 for the host
      // even though the DO still accepted reconnects for ~1h. The DO alarm
      // removes the row after EMPTY_ROOM_TIMEOUT (and the hourly cron backs
      // that up), so it never lingers forever.
      const now = Date.now()
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
        'room_empty_since',
        String(now),
      )
      await this.scheduleAlarm()
    } else if (remainingPlayers.length > 0) {
      this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'room_empty_since')
    }
  }

  /**
   * Lobby-phase cleanup when a player's socket closes — shared by
   * webSocketClose and webSocketError. Writes the reconnect marker, removes the
   * player from DO + D1, and transfers the host role if the host left.
   */
  private async handleLobbyPlayerLeave(sess: PlayerSession): Promise<void> {
    // Save player info in meta storage so they can reconnect even after being
    // cleaned up from D1. The meta marker is cleared on next connect.
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      `disconnected_player_${sess.playerId}`,
      JSON.stringify({ name: sess.playerName, isHost: sess.isHost }),
    )

    this.ctx.storage.sql.exec('DELETE FROM players WHERE id = ?', sess.playerId)

    // Remove from D1 too so the lobby listing doesn't show disconnected players.
    if (this.roomId) {
      try {
        const d1db = this.getDb()
        await d1db.delete(schema.players).where(eq(schema.players.id, sess.playerId))
        // If the host left the lobby, transfer the host role to another player
        // so the room doesn't become permanently un-startable.
        if (sess.isHost) {
          await this.promoteNextHost()
        }
      } catch (error) {
        console.error('Failed to delete player from D1 on disconnect:', error)
      }
    }
  }

  /** Promotes the first remaining player to host after the host leaves the lobby. */
  private async promoteNextHost(): Promise<void> {
    const remaining = this.getPlayers()
    const promoted = remaining[0]
    if (!promoted) return

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO players (id, name, is_host) VALUES (?, ?, ?)',
      promoted.id,
      promoted.name,
      1,
    )
    this.playersDirty = true

    // Keep the in-memory session in sync so the new host can start the game immediately.
    const newHostWs = this.playerSockets.get(promoted.id)
    const newHostSess = newHostWs ? this.sessions.get(newHostWs) : undefined
    if (newHostSess) newHostSess.isHost = true

    try {
      const d1db = this.getDb()
      await d1db
        .update(schema.players)
        .set({ isHost: true })
        .where(eq(schema.players.id, promoted.id))
      await d1db
        .update(schema.rooms)
        .set({ hostName: promoted.name })
        .where(eq(schema.rooms.id, this.roomId))
    } catch (error) {
      console.error('Failed to persist host transfer:', error)
    }
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'room_host',
      promoted.name,
    )
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Clean up session state proactively in case webSocketClose doesn't follow.
    // The Workers runtime typically calls webSocketClose after webSocketError,
    // but this isn't guaranteed by spec — if it doesn't, we'd leak the session.
    // To prevent D1 leaks, we run the full close logic here.
    const att = ws.deserializeAttachment()
    this.sessions.delete(ws)

    if (!att) {
      // DO was evicted and restarted — attachment (player session) is lost.
      // Same policy as webSocketClose: keep the D1 room row, arm the
      // empty-room cleanup instead of deleting immediately.
      const gameState = await this.getActiveGameState()
      if (!gameState && this.roomId) {
        const now = Date.now()
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
          'room_empty_since',
          String(now),
        )
        await this.scheduleAlarm()
      }
      console.error('RoomDO WebSocket error:', error)
      return
    }

    const sess = att as PlayerSession

    // Mirror webSocketClose: never clean up a player who is mid-reconnect, and
    // never touch the maps if a newer socket already took over. Otherwise this
    // handler could delete a freshly re-inserted D1 player row or unregister
    // the new connection's socket (race with onPlayerConnected).
    if (this.connectingIds.has(sess.playerId)) return
    const actualSocket = this.playerSockets.get(sess.playerId)
    if (actualSocket !== ws) return
    this.playerSockets.delete(sess.playerId)

    const gameState = await this.getActiveGameState()
    if (!gameState) {
      await this.handleLobbyPlayerLeave(sess)
    }
    this.playersDirty = true

    // If webSocketClose never follows and everyone is gone mid-game, start the
    // disconnect grace period so the game can end instead of lingering.
    if (gameState && this.sessions.size === 0) {
      const now = Date.now()
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
        'disconnect_grace_started_at',
        String(now),
      )
      await this.scheduleAlarm()
    }

    console.error('RoomDO WebSocket error:', error)
  }

  async alarm(): Promise<void> {
    const now = Date.now()

    // 1) Disconnect grace — all players went offline during a game.
    const graceRow = this.ctx.storage.sql
      .exec<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?',
        'disconnect_grace_started_at',
      )
      .toArray()
    if (graceRow.length > 0) {
      const startedAt = Number(graceRow[0].value)
      if (now >= startedAt + DISCONNECT_GRACE_MS) {
        // Grace period expired — no one reconnected, end the game and clean up.
        const gameState = await this.getActiveGameState()
        if (gameState) {
          await this.endGame(gameState)
          await this.cleanupRoomFromD1()
          this.clearAllLocalData()
        } else {
          this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'disconnect_grace_started_at')
        }
      }
      await this.scheduleAlarm()
      return
    }

    // 2) Turn timeout — the current player hasn't responded.
    // The turn timeout is now alarm-based (durable across DO evictions/restarts).
    const turnRow = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'turn_started_at')
      .toArray()
    if (turnRow.length > 0) {
      const startedAt = Number(turnRow[0].value)
      if (now >= startedAt + TURN_TIMEOUT_MS) {
        await this.autoSkipTurn()
        await this.scheduleAlarm()
        return
      }
    }

    // 3) Empty-room cleanup.
    if (await this.getActiveGameState()) {
      await this.scheduleAlarm()
      return
    }
    if (this.getPlayers().length > 0) {
      await this.scheduleAlarm()
      return
    }

    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'room_empty_since')
      .toArray()
    const emptySince = row.length > 0 ? Number(row[0].value) : now
    if (now - emptySince < EMPTY_ROOM_TIMEOUT) {
      await this.scheduleAlarm()
      return
    }

    if (this.roomId) {
      await this.cleanupRoomFromD1()
    }

    this.clearAllLocalData()
  }

  /**
   * DOs only hold a single alarm slot, so every pending event (turn timeout,
   * disconnect grace, empty-room cleanup) is merged into one alarm scheduled at
   * the earliest deadline. Call this after ANY change to the meta markers that
   * drive those events. If nothing is pending the alarm is cleared.
   */
  private async scheduleAlarm(): Promise<void> {
    const candidates: number[] = []
    const readMeta = (key: string): number | null => {
      const rows = this.ctx.storage.sql
        .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
        .toArray()
      if (rows.length === 0) return null
      const n = Number(rows[0].value)
      return Number.isFinite(n) ? n : null
    }

    const turnStarted = readMeta('turn_started_at')
    if (turnStarted !== null) candidates.push(turnStarted + TURN_TIMEOUT_MS)
    const graceStarted = readMeta('disconnect_grace_started_at')
    if (graceStarted !== null) candidates.push(graceStarted + DISCONNECT_GRACE_MS)
    const emptySince = readMeta('room_empty_since')
    if (emptySince !== null) candidates.push(emptySince + EMPTY_ROOM_TIMEOUT)

    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now(), Math.min(...candidates)))
  }

  /** Looks up the reconnect marker for a playerId, if any. */
  private findDisconnectedPlayer(playerId: string): { name: string; isHost: boolean } | null {
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?',
        `disconnected_player_${playerId}`,
      )
      .toArray()
    if (rows.length === 0) return null
    try {
      const parsed = JSON.parse(rows[0].value) as { name?: string; isHost?: boolean }
      if (typeof parsed?.name !== 'string') return null
      return { name: parsed.name, isHost: !!parsed.isHost }
    } catch {
      return null
    }
  }

  private async verifyIsHost(playerName: string): Promise<boolean> {
    const normalized = playerName.trim()
    if (!this.roomId || !normalized) return false
    try {
      // Check cache in DO storage first
      const cached = this.ctx.storage.sql
        .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'room_host')
        .toArray()
      if (cached.length > 0) {
        return cached[0].value === normalized
      }

      const db = this.getDb()
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
          room.hostName,
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
      this.sendSafe(this.playerSockets.get(sess.playerId), {
        type: 'error',
        message: 'Only the host can start the game',
      } satisfies ServerMessage)
      return
    }

    const existingGame = await this.getActiveGameState()
    if (existingGame) return

    const players = this.getPlayers()
    if (players.length < 2) {
      this.sendSafe(this.playerSockets.get(sess.playerId), {
        type: 'error',
        message: 'Need at least 2 players to start',
      } satisfies ServerMessage)
      return
    }

    const roomId = this.roomId
    const shuffled = fisherYatesShuffle(players)
    const playerOrder = shuffled.map((p) => p.id)
    const gameId = crypto.randomUUID()

    try {
      const db = this.getDb()
      await db.insert(schema.games).values({
        id: gameId,
        roomId,
        status: 'playing',
        playerOrder: JSON.stringify(playerOrder),
        currentPlayerIndex: 0,
        round: 1,
      })

      await db.update(schema.rooms).set({ status: 'playing' }).where(eq(schema.rooms.id, roomId))

      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO game (id, room_id, status, player_order, current_player_index, round) VALUES (?, ?, ?, ?, ?, ?)',
        gameId,
        roomId,
        'playing',
        JSON.stringify(playerOrder),
        0,
        1,
      )

      this.broadcast({
        type: 'game_started',
        gameId,
        playerOrder,
        currentPlayerIndex: 0,
        round: 1,
      } satisfies ServerMessage)

      // Truth-only: immediately assign truth question to first player
      const firstPlayer = players.find((p) => p.id === playerOrder[0])
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
      this.sendSafe(this.playerSockets.get(sess.playerId), {
        type: 'error',
        message: 'Failed to start game',
      } satisfies ServerMessage)
    }
  }

  private async handleSelectType(
    sess: PlayerSession,
    selectedType: 'truth' | 'dare',
  ): Promise<void> {
    const gameState = await this.getActiveGameState()
    if (!gameState) return

    const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex]
    if (sess.playerId !== currentPlayerId) return

    // Prevent duplicate choices. The in-flight guard is set synchronously
    // (before any await) so two rapid select_truth messages can't both pass.
    if (this.currentChoices.has(sess.playerId)) return
    if (this.selectingPlayers.has(sess.playerId)) return
    this.selectingPlayers.add(sess.playerId)

    try {
      // Player responded — clear the turn choice timeout
      await this.clearTurnTimeout()

      // Truth-only mode: only pick truth questions
      let picked = await this.pickQuestion('truth', sess.playerId)
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
        JSON.stringify(choice),
      )

      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO used_questions (player_id, question_id) VALUES (?, ?)',
        sess.playerId,
        picked.id,
      )

      this.broadcast({
        type: 'turn_question',
        playerId: sess.playerId,
        playerName: sess.playerName,
        questionType: selectedType,
        question: picked.text,
        questionId: picked.id,
      } satisfies ServerMessage)

      // Start turn timeout: if player doesn't respond within TURN_TIMEOUT_MS, auto-skip.
      // Uses a durable DO alarm so the timeout survives evictions and restarts.
      await this.scheduleTurnTimeout()
    } finally {
      this.selectingPlayers.delete(sess.playerId)
    }
  }

  /**
   * Picks a random unused question of the given type for a player.
   * Question ids/text live in a DO SQLite cache (loaded lazily from D1) so a
   * turn never pays a D1 round-trip just to choose one question.
   */
  private async pickQuestion(
    type: 'truth' | 'dare',
    playerId: string,
  ): Promise<{ id: string; text: string } | null> {
    try {
      await this.ensureQuestionCache()
      const allQuestions = this.ctx.storage.sql
        .exec<{ id: string; text: string }>(
          'SELECT id, text FROM question_cache WHERE type = ?',
          type,
        )
        .toArray()

      const usedIds = this.ctx.storage.sql
        .exec<{ question_id: string }>(
          'SELECT question_id FROM used_questions WHERE player_id = ?',
          playerId,
        )
        .toArray()
      const usedSet = new Set(usedIds.map((r) => r.question_id))

      const available = allQuestions.filter((q) => !usedSet.has(q.id))
      if (available.length === 0) return null

      return available[randomInt(available.length)]
    } catch (error) {
      console.error('Failed to pick question:', error)
      return null
    }
  }

  /** Loads all questions from D1 into DO SQLite once (lazy, per DO instance). */
  private async ensureQuestionCache(): Promise<void> {
    if (this.questionCacheLoaded) return

    // Already cached from a previous DO lifetime (storage survives eviction).
    const countRow = this.ctx.storage.sql
      .exec<{ c: number }>('SELECT COUNT(*) AS c FROM question_cache')
      .toArray()
    if (countRow.length > 0 && countRow[0].c > 0) {
      this.questionCacheLoaded = true
      return
    }

    const db = this.getDb()
    const allQuestions = await db
      .select({ id: schema.questions.id, type: schema.questions.type, text: schema.questions.text })
      .from(schema.questions)
      .all()
    for (const q of allQuestions) {
      this.ctx.storage.sql.exec(
        'INSERT OR IGNORE INTO question_cache (id, type, text) VALUES (?, ?, ?)',
        q.id,
        q.type,
        q.text,
      )
    }
    // Mark loaded even if D1 returned zero rows so we don't re-query every turn.
    this.questionCacheLoaded = true
  }

  private static FALLBACK_QUESTIONS: { type: 'truth' | 'dare'; text: string }[] = [
    { type: 'truth', text: 'Apa hal paling random yang ada di pikiranmu sekarang?' },
    { type: 'truth', text: 'Apa aplikasi di HP-mu yang paling boros waktu?' },
    { type: 'truth', text: 'Siapa orang yang paling sering kamu chat setiap hari?' },
    { type: 'truth', text: 'Apa ketakutan terbesar kamu?' },
    { type: 'truth', text: 'Apa satu tempat yang paling ingin kamu kunjungi?' },
  ]

  private static fallbackCounter = 0

  private getFallbackQuestion(
    _type: 'truth' | 'dare',
  ): { id: string; type: 'truth' | 'dare'; text: string; createdAt: Date } | null {
    const fallbacks = RoomDO.FALLBACK_QUESTIONS
    if (fallbacks.length === 0) return null
    const picked = fallbacks[randomInt(fallbacks.length)]
    RoomDO.fallbackCounter++
    return {
      id: `fallback_${RoomDO.fallbackCounter}`,
      type: 'truth',
      text: picked.text,
      createdAt: new Date(),
    }
  }

  private async handleTurnDone(
    sess: PlayerSession,
    status: 'completed' | 'skipped',
  ): Promise<void> {
    const gameState = await this.getActiveGameState()
    if (!gameState) return

    const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex]
    if (sess.playerId !== currentPlayerId) return

    // Clear turn timeout (only timer remaining)
    await this.clearTurnTimeout()

    const db = this.getDb()

    let nextIdx = gameState.currentPlayerIndex + 1
    let nextRound = gameState.round
    if (nextIdx >= gameState.playerOrder.length) {
      nextIdx = 0
      nextRound += 1
    }

    // Retrieve choice before any guard clauses that might return early
    let choice = this.currentChoices.get(sess.playerId)
    if (!choice) {
      const stored = this.ctx.storage.sql
        .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', `choice_${sess.playerId}`)
        .toArray()
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

      // Broadcast the final turn result so all clients see it before game_ended.
      // Use the round that was just COMPLETED (the game is ending, so there is
      // no "next round" — this keeps the game-over screen from showing round+1).
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
        round: gameState.round,
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
        gameState.id,
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

      await new Promise((resolve) => setTimeout(resolve, 3000))

      // Check if game state is still valid AND hasn't advanced
      const current = await this.getActiveGameState()
      if (!current) {
        this.turnTransitionInProgress = false
        return
      }
      if (
        current.currentPlayerIndex !== expectedIdx ||
        current.playerOrder[current.currentPlayerIndex] !== expectedPlayerId
      ) {
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
      this.sendSafe(this.playerSockets.get(sess.playerId), {
        type: 'error',
        message: 'Only the host can end the game',
      } satisfies ServerMessage)
      return
    }

    const gameState = await this.getActiveGameState()
    if (!gameState) return

    await this.endGame(gameState)
  }

  private async endGame(gameState: GameState): Promise<void> {
    // Clean up turn-related state
    await this.clearTurnTimeout()
    this.turnTransitionInProgress = false
    this.currentChoices.clear()
    this.selectingPlayers.clear()
    this.ctx.storage.sql.exec("DELETE FROM meta WHERE key LIKE 'choice_%'")
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'turn_started_at')

    try {
      // DO local state FIRST (synchronous — no yield point) so that
      // getActiveGameState() returns null before any await yields to
      // other handlers (like the setTimeout callback in handleTurnDone).
      this.ctx.storage.sql.exec('UPDATE game SET status = ? WHERE id = ?', 'finished', gameState.id)

      const db = this.getDb()
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

  private async scheduleTurnTimeout(): Promise<void> {
    await this.clearTurnTimeout()
    const now = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'turn_started_at',
      String(now),
    )
    await this.scheduleAlarm()
  }

  private async autoSkipTurn(): Promise<void> {
    const gameState = await this.getActiveGameState()
    if (!gameState) return

    const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex]
    const players = this.getPlayers()
    const currentPlayer = players.find((p) => p.id === currentPlayerId)
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

  private async clearTurnTimeout(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', 'turn_started_at')
    await this.scheduleAlarm()
  }

  /** Returns a cached Drizzle instance bound to the D1 database for this DO. */
  private getDb(): DbInstance {
    if (!this.dbInstance) {
      this.dbInstance = createDb(this.env.DB)
    }
    return this.dbInstance
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
      const rows = this.ctx.storage.sql
        .exec<{ id: string; name: string; is_host: number }>(
          'SELECT id, name, is_host FROM players',
        )
        .toArray()

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
