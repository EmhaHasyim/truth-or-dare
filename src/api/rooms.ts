import { eq, inArray, sql } from 'drizzle-orm'
import type { DbInstance } from '../db'
import { schema } from '../db'
import type { Room } from '../types'
import { CODE_CHARS, CODE_LENGTH, MAX_CODE_GENERATION_RETRIES, MAX_PLAYERS } from '../constants'
import { hashPassword, verifyPassword } from '../lib/password'
import { randomInt } from '../lib/random'

function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)]
  }
  return code
}

/** Detects SQLite unique-constraint violations from drizzle/raw errors. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
}

function toRoom(
  room: typeof schema.rooms.$inferSelect,
  playerRows: (typeof schema.players.$inferSelect)[],
): Room {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    hostName: room.hostName,
    maxPlayers: room.maxPlayers,
    hasPassword: !!room.passwordHash,
    status: room.status,
    createdAt: room.createdAt.getTime(),
    players: playerRows.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
    })),
  }
}

async function getPlayersByRoomIds(
  db: DbInstance,
  roomIds: string[],
): Promise<Map<string, (typeof schema.players.$inferSelect)[]>> {
  if (roomIds.length === 0) return new Map()
  const allPlayers = await db
    .select()
    .from(schema.players)
    .where(inArray(schema.players.roomId, roomIds))
    .all()
  const map = new Map<string, (typeof schema.players.$inferSelect)[]>()
  for (const p of allPlayers) {
    const list = map.get(p.roomId)
    if (list) list.push(p)
    else map.set(p.roomId, [p])
  }
  return map
}

async function getPlayersForRoom(
  db: DbInstance,
  roomId: string,
): Promise<(typeof schema.players.$inferSelect)[]> {
  const map = await getPlayersByRoomIds(db, [roomId])
  return map.get(roomId) ?? []
}

export async function listActiveRooms(db: DbInstance): Promise<Room[]> {
  const rows = await db.select().from(schema.rooms).where(eq(schema.rooms.status, 'waiting')).all()

  const playersByRoom = await getPlayersByRoomIds(
    db,
    rows.map((r) => r.id),
  )

  const result: Room[] = []
  for (const room of rows) {
    const playerRows = playersByRoom.get(room.id) ?? []
    // Show all waiting rooms in the lobby regardless of current player count.
    // D1 player records may be stale (disconnected players aren't removed),
    // so filtering by maxPlayers would hide rooms that are actually joinable.
    // The join endpoint itself enforces the maxPlayers limit.
    result.push(toRoom(room, playerRows))
  }

  return result.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createRoom(
  db: DbInstance,
  params: { name: string; hostName: string; password?: string },
): Promise<Room> {
  const roomId = crypto.randomUUID()
  const playerId = crypto.randomUUID()
  const passwordHash = params.password ? await hashPassword(params.password) : null

  // Generate a code and insert the room. If two concurrent requests pick the
  // same code, the insert throws a unique-constraint violation — retry with a
  // fresh code instead of surfacing a 500 to the client.
  let room!: typeof schema.rooms.$inferSelect
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_RETRIES; attempt++) {
    const code = generateCode()
    try {
      const [insertedRoom] = await db
        .insert(schema.rooms)
        .values({
          id: roomId,
          code,
          name: params.name,
          hostName: params.hostName,
          maxPlayers: MAX_PLAYERS,
          passwordHash,
          status: 'waiting',
          createdAt: new Date(),
        })
        .returning()
      room = insertedRoom
      break
    } catch (error) {
      if (isUniqueViolation(error) && attempt < MAX_CODE_GENERATION_RETRIES - 1) continue
      throw error
    }
  }

  // Stamp the room's last-active timestamp so the hourly cron cleanup (which
  // removes "zombie" waiting rooms) never touches a freshly created room.
  // Raw SQL: the column is managed by the cleanup cron, not the drizzle schema.
  try {
    await db.run(sql`UPDATE rooms SET last_active_at = ${Date.now()} WHERE id = ${roomId}`)
  } catch {
    // Non-fatal: if this fails the room is simply eligible for stale cleanup sooner.
  }

  // Insert the host player. If this fails, delete the orphaned room.
  let player: typeof schema.players.$inferSelect
  try {
    const [insertedPlayer] = await db
      .insert(schema.players)
      .values({
        id: playerId,
        roomId,
        name: params.hostName,
        isHost: true,
      })
      .returning()
    player = insertedPlayer
  } catch (insertError) {
    // Clean up the orphaned room since the player insert failed
    try {
      await db.delete(schema.rooms).where(eq(schema.rooms.id, roomId))
    } catch {
      /* ignore cleanup error */
    }
    throw insertError
  }

  return toRoom(room, [player])
}

export async function getRoomById(db: DbInstance, id: string): Promise<Room | null> {
  const room = await db.select().from(schema.rooms).where(eq(schema.rooms.id, id)).get()

  if (!room) return null

  const playerRows = await getPlayersForRoom(db, id)
  return toRoom(room, playerRows)
}

export async function getRoomByCode(db: DbInstance, code: string): Promise<Room | null> {
  const room = await db.select().from(schema.rooms).where(eq(schema.rooms.code, code)).get()

  if (!room) return null

  const playerRows = await getPlayersForRoom(db, room.id)
  return toRoom(room, playerRows)
}

export async function joinRoom(
  db: DbInstance,
  params: { roomId: string; playerName: string; password?: string },
): Promise<{ room: Room } | { error: string }> {
  const room = await db.select().from(schema.rooms).where(eq(schema.rooms.id, params.roomId)).get()

  if (!room) return { error: 'Room not found' }
  if (room.status !== 'waiting') return { error: 'Room is not accepting players' }

  const playerRows = await getPlayersForRoom(db, room.id)

  if (playerRows.length >= room.maxPlayers) return { error: 'Room is full' }
  if (room.passwordHash && !(await verifyPassword(params.password || '', room.passwordHash))) {
    return { error: 'Incorrect password' }
  }

  // Reject duplicate names to prevent identity hijack
  const existingPlayer = playerRows.find((p) => p.name === params.playerName.trim())
  if (existingPlayer) {
    return { error: 'Name already taken in this room' }
  }

  let player: typeof schema.players.$inferSelect
  try {
    const [insertedPlayer] = await db
      .insert(schema.players)
      .values({
        id: crypto.randomUUID(),
        roomId: room.id,
        name: params.playerName.trim(),
        isHost: false,
      })
      .returning()
    player = insertedPlayer
  } catch (error) {
    // The duplicate-name check above is advisory: a concurrent join can still
    // hit the unique index (room_id, name). Report it as a normal error
    // instead of a 500.
    if (isUniqueViolation(error)) {
      return { error: 'Name already taken in this room' }
    }
    throw error
  }

  return { room: toRoom(room, [...playerRows, player]) }
}
