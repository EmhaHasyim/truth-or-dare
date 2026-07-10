import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  hostName: text('host_name').notNull(),
  maxPlayers: integer('max_players').notNull().default(2),
  passwordHash: text('password_hash'),
  status: text('status', { enum: ['waiting', 'playing', 'finished'] }).notNull().default('waiting'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isHost: integer('is_host', { mode: 'boolean' }).notNull().default(false),
}, (table) => ({
  uniqueNamePerRoom: uniqueIndex('idx_players_room_name').on(table.roomId, table.name),
}))

export const questions = sqliteTable('questions', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['truth', 'dare'] }).notNull(),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['playing', 'finished'] }).notNull().default('playing'),
  playerOrder: text('player_order').notNull(),
  currentPlayerIndex: integer('current_player_index').notNull().default(0),
  round: integer('round').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
})

export const turns = sqliteTable('turns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  playerId: text('player_id').notNull(),
  type: text('type', { enum: ['truth', 'dare'] }).notNull(),
  questionId: text('question_id').references(() => questions.id),
  status: text('status', { enum: ['pending', 'completed', 'skipped'] }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})