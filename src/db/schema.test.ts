import { describe, it, expect } from 'vitest'
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
    })

    it('id should be primary key (text column)', () => {
      expect(roomColumns.id.name).toBe('id')
    })

    it('code should be unique, not null', () => {
      expect(roomColumns.code.name).toBe('code')
      expect(roomColumns.code.notNull).toBe(true)
    })

    it('maxPlayers should have a default value', () => {
      expect(roomColumns.maxPlayers.name).toBe('max_players')
      expect(roomColumns.maxPlayers.default).toBeDefined()
    })

    it('status should have default waiting', () => {
      expect(roomColumns.status.name).toBe('status')
      expect(roomColumns.status.default).toBe('waiting')
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
      expect(turnColumns.id.autoIncrement).toBe(true)
    })

    it('type should be not null (truth or dare)', () => {
      expect(turnColumns.type.name).toBe('type')
      expect(turnColumns.type.notNull).toBe(true)
    })

    it('status should have default', () => {
      expect(turnColumns.status.name).toBe('status')
      expect(turnColumns.status.notNull).toBe(true)
    })
  })
})
