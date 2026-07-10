import { eq, inArray } from 'drizzle-orm'
import type { DbInstance } from '../db'
import { schema } from '../db'
import type { Room } from '../types'
import { CODE_CHARS, CODE_LENGTH, MAX_CODE_GENERATION_RETRIES, MAX_PLAYERS } from '../constants'
import { hashPassword, verifyPassword } from '../lib/password'

function generateCode(): string {
  let code = ''
  const codeCharsLen = CODE_CHARS.length // 30
  // Use rejection sampling to avoid modulo bias.
  // Uint16Array gives values in [0, 65535].
  // maxValid = floor(65536 / 30) * 30 = 65520
  const maxValid = Math.floor(65536 / codeCharsLen) * codeCharsLen
  for (let i = 0; i < CODE_LENGTH; i++) {
    let rand: number
    do {
      rand = crypto.getRandomValues(new Uint16Array(1))[0]
    } while (rand >= maxValid)
    code += CODE_CHARS[rand % codeCharsLen]
  }
  return code
}

async function generateUniqueCode(db: DbInstance): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_RETRIES; attempt++) {
    const code = generateCode()
    const existing = await db
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(eq(schema.rooms.code, code))
      .get()
    if (!existing) return code
  }
  throw new Error('Failed to generate unique room code')
}

function toRoom(room: typeof schema.rooms.$inferSelect, playerRows: (typeof schema.players.$inferSelect)[]): Room {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    hostName: room.hostName,
    maxPlayers: room.maxPlayers,
    hasPassword: !!room.passwordHash,
    status: room.status,
    createdAt: room.createdAt,
    players: playerRows.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
    })),
  }
}

async function getPlayersByRoomIds(db: DbInstance, roomIds: string[]): Promise<Map<string, typeof schema.players.$inferSelect[]>> {
  if (roomIds.length === 0) return new Map()
  const allPlayers = await db
    .select()
    .from(schema.players)
    .where(inArray(schema.players.roomId, roomIds))
    .all()
  const map = new Map<string, typeof schema.players.$inferSelect[]>()
  for (const p of allPlayers) {
    const list = map.get(p.roomId)
    if (list) list.push(p)
    else map.set(p.roomId, [p])
  }
  return map
}

async function getPlayersForRoom(db: DbInstance, roomId: string): Promise<typeof schema.players.$inferSelect[]> {
  const map = await getPlayersByRoomIds(db, [roomId])
  return map.get(roomId) ?? []
}

export async function listActiveRooms(db: DbInstance): Promise<Room[]> {
  const rows = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.status, 'waiting'))
    .all()

  const playersByRoom = await getPlayersByRoomIds(
    db,
    rows.map((r) => r.id)
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
  params: { name: string; hostName: string; password?: string }
): Promise<Room> {
  const roomId = crypto.randomUUID()
  const playerId = crypto.randomUUID()
  const code = await generateUniqueCode(db)
  const [room] = await db
    .insert(schema.rooms)
    .values({
      id: roomId,
      code,
      name: params.name,
      hostName: params.hostName,
      maxPlayers: MAX_PLAYERS,
      passwordHash: params.password ? await hashPassword(params.password) : null,
      status: 'waiting',
      createdAt: new Date(),
    })
    .returning()

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
    } catch { /* ignore cleanup error */ }
    throw insertError
  }

  return toRoom(room, [player])
}

export async function getRoomById(db: DbInstance, id: string): Promise<Room | null> {
  const room = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.id, id))
    .get()

  if (!room) return null

  const playerRows = await getPlayersForRoom(db, id)
  return toRoom(room, playerRows)
}

export async function getRoomByCode(db: DbInstance, code: string): Promise<Room | null> {
  const room = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.code, code))
    .get()

  if (!room) return null

  const playerRows = await getPlayersForRoom(db, room.id)
  return toRoom(room, playerRows)
}

export async function joinRoom(
  db: DbInstance,
  params: { roomId: string; playerName: string; password?: string }
): Promise<{ room: Room } | { error: string }> {
  const room = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.id, params.roomId))
    .get()

  if (!room) return { error: 'Room not found' }
  if (room.status !== 'waiting') return { error: 'Room is not accepting players' }

  const playerRows = await getPlayersForRoom(db, room.id)

  if (playerRows.length >= room.maxPlayers) return { error: 'Room is full' }
  if (room.passwordHash && !(await verifyPassword(params.password || '', room.passwordHash))) {
    return { error: 'Incorrect password' }
  }

  // Reject duplicate names to prevent identity hijack
  const existingPlayer = playerRows.find(p => p.name === params.playerName.trim())
  if (existingPlayer) {
    return { error: 'Name already taken in this room' }
  }

  const [player] = await db
    .insert(schema.players)
    .values({
      id: crypto.randomUUID(),
      roomId: room.id,
      name: params.playerName.trim(),
      isHost: false,
    })
    .returning()

  return { room: toRoom(room, [...playerRows, player]) }
}