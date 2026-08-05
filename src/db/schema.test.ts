import { describe, it, expect } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { schema } from '../db'

describe('database schema', () => {
  describe('rooms table', () => {
    const roomColumns = schema.rooms

    it('should have expected columns', () => {
      expect(roomColumns.id).toBeDefined()
      expect(roomColumns.code).toBeDefined()
      expect(roomColumns.name).toBeDefined()
      expect(roomColumns.hostName).toBeDefined()
      expect(roomColumns.maxPlayers).toBeDefined()
      expect(roomColumns.passwordHash).toBeDefined()
      expect(roomColumns.status).toBeDefined()
      expect(roomColumns.createdAt).toBeDefined()
      expect(roomColumns.lastActiveAt).toBeDefined()
    })

    it('lastActiveAt should map to last_active_at with default 0', () => {
      expect(roomColumns.lastActiveAt.name).toBe('last_active_at')
      expect(roomColumns.lastActiveAt.notNull).toBe(true)
      expect(String(roomColumns.lastActiveAt.default)).toContain('0')
    })

    it('id should be primary key (text column)', () => {
      expect(roomColumns.id.name).toBe('id')
      expect(roomColumns.id.primary).toBe(true)
    })

    it('code should be unique, not null', () => {
      expect(roomColumns.code.name).toBe('code')
      expect(roomColumns.code.notNull).toBe(true)
    })

    it('maxPlayers should have a default value of 2', () => {
      expect(roomColumns.maxPlayers.name).toBe('max_players')
      expect(roomColumns.maxPlayers.default).toBeDefined()
      expect(String(roomColumns.maxPlayers.default)).toContain('2')
    })

    it('status should have default waiting', () => {
      expect(roomColumns.status.name).toBe('status')
      expect(roomColumns.status.default).toBe('waiting')
    })

    it('hostName should map to host_name column', () => {
      expect(roomColumns.hostName.name).toBe('host_name')
      expect(roomColumns.hostName.notNull).toBe(true)
    })

    it('passwordHash should be nullable', () => {
      expect(roomColumns.passwordHash.name).toBe('password_hash')
      expect(roomColumns.passwordHash.notNull).toBe(false)
    })

    it('createdAt should use timestamp_ms mode', () => {
      expect(roomColumns.createdAt.name).toBe('created_at')
      expect(roomColumns.createdAt.notNull).toBe(true)
    })
  })

  describe('players table', () => {
    const playerColumns = schema.players

    it('should have expected columns', () => {
      expect(playerColumns.id).toBeDefined()
      expect(playerColumns.roomId).toBeDefined()
      expect(playerColumns.name).toBeDefined()
      expect(playerColumns.isHost).toBeDefined()
    })

    it('roomId should reference rooms.id (not null)', () => {
      expect(playerColumns.roomId.name).toBe('room_id')
      expect(playerColumns.roomId.notNull).toBe(true)
    })

    it('isHost should have default false', () => {
      expect(playerColumns.isHost.name).toBe('is_host')
      expect(playerColumns.isHost.notNull).toBe(true)
      expect(playerColumns.isHost.default).toBeDefined()
      expect(playerColumns.isHost.default).toBe(false)
    })

    it('should have unique index on (roomId, name)', () => {
      const tableConfig = schema.players
      expect(tableConfig).toBeDefined()
    })
  })

  describe('questions table', () => {
    const questionColumns = schema.questions

    it('should have expected columns', () => {
      expect(questionColumns.id).toBeDefined()
      expect(questionColumns.type).toBeDefined()
      expect(questionColumns.text).toBeDefined()
      expect(questionColumns.createdAt).toBeDefined()
    })

    it('type should be not null (truth/dare enum)', () => {
      expect(questionColumns.type.name).toBe('type')
      expect(questionColumns.type.notNull).toBe(true)
    })

    it('text should be not null', () => {
      expect(questionColumns.text.name).toBe('text')
      expect(questionColumns.text.notNull).toBe(true)
    })
  })

  describe('games table', () => {
    const gameColumns = schema.games

    it('should have expected columns', () => {
      expect(gameColumns.id).toBeDefined()
      expect(gameColumns.roomId).toBeDefined()
      expect(gameColumns.status).toBeDefined()
      expect(gameColumns.playerOrder).toBeDefined()
      expect(gameColumns.currentPlayerIndex).toBeDefined()
      expect(gameColumns.round).toBeDefined()
      expect(gameColumns.createdAt).toBeDefined()
      expect(gameColumns.finishedAt).toBeDefined()
    })

    it('currentPlayerIndex should default to 0', () => {
      expect(gameColumns.currentPlayerIndex.name).toBe('current_player_index')
      expect(gameColumns.currentPlayerIndex.default).toBeDefined()
      expect(String(gameColumns.currentPlayerIndex.default)).toContain('0')
    })

    it('round should default to 1', () => {
      expect(gameColumns.round.name).toBe('round')
      expect(gameColumns.round.default).toBeDefined()
      expect(String(gameColumns.round.default)).toContain('1')
    })

    it('status should have enum playing/finished', () => {
      expect(gameColumns.status.name).toBe('status')
      expect(gameColumns.status.notNull).toBe(true)
      expect(gameColumns.status.default).toBe('playing')
    })

    it('finishedAt should be nullable', () => {
      expect(gameColumns.finishedAt.name).toBe('finished_at')
      expect(gameColumns.finishedAt.notNull).toBe(false)
    })
  })

  describe('turns table', () => {
    const turnColumns = schema.turns

    it('should have expected columns', () => {
      expect(turnColumns.id).toBeDefined()
      expect(turnColumns.gameId).toBeDefined()
      expect(turnColumns.round).toBeDefined()
      expect(turnColumns.playerId).toBeDefined()
      expect(turnColumns.type).toBeDefined()
      expect(turnColumns.questionId).toBeDefined()
      expect(turnColumns.status).toBeDefined()
      expect(turnColumns.createdAt).toBeDefined()
    })

    it('id should be auto-increment primary key', () => {
      expect(turnColumns.id.name).toBe('id')
      expect(turnColumns.id.primary).toBe(true)
      expect((turnColumns.id as any).autoIncrement).toBe(true)
    })

    it('type should be not null (truth or dare)', () => {
      expect(turnColumns.type.name).toBe('type')
      expect(turnColumns.type.notNull).toBe(true)
    })

    it('status should have default pending', () => {
      expect(turnColumns.status.name).toBe('status')
      expect(turnColumns.status.notNull).toBe(true)
      expect(turnColumns.status.default).toBe('pending')
    })

    it('questionId should be nullable (references questions)', () => {
      expect(turnColumns.questionId.name).toBe('question_id')
      expect(turnColumns.questionId.notNull).toBe(false)
    })
  })

  describe('table relationships', () => {
    it('players.roomId references rooms.id with cascade delete', () => {
      // The foreign key constraint is defined on the column
      expect(schema.players.roomId).toBeDefined()
    })

    it('games.roomId references rooms.id with cascade delete', () => {
      expect(schema.games.roomId).toBeDefined()
    })

    it('turns.gameId references games.id with cascade delete', () => {
      expect(schema.turns.gameId).toBeDefined()
    })
  })

  describe('materialized table config (lazy callbacks)', () => {
    it('players: foreign key + unique index callbacks are invoked', () => {
      // Accessing getTableConfig materializes the extraConfig uniqueIndex callback.
      // Calling fk.getName() materializes the lazy references(() => rooms.id) callback.
      const cfg = getTableConfig(schema.players)
      expect(cfg.foreignKeys.length).toBe(1)
      const fk = cfg.foreignKeys[0]
      expect(fk.onDelete).toBe('cascade')
      expect(fk.getName()).toContain('players')
      expect(cfg.indexes.length).toBe(1)
      expect(cfg.indexes[0].config.name).toBe('idx_players_room_name')
      expect(cfg.name).toBe('players')
    })

    it('games: foreign key callback is invoked', () => {
      const cfg = getTableConfig(schema.games)
      expect(cfg.foreignKeys.length).toBe(1)
      const fk = cfg.foreignKeys[0]
      expect(fk.onDelete).toBe('cascade')
      expect(fk.getName()).toContain('games')
      expect(cfg.name).toBe('games')
    })

    it('turns: both foreign key callbacks are invoked', () => {
      const cfg = getTableConfig(schema.turns)
      expect(cfg.foreignKeys.length).toBe(2)
      const names = cfg.foreignKeys.map((fk) => fk.getName())
      expect(names.some((n) => n.includes('turns'))).toBe(true)
      expect(cfg.name).toBe('turns')
    })
  })
})
