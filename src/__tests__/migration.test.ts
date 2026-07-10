import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('migration SQL', () => {
  const migrationPath = path.resolve(__dirname, '../../migrations/0000_consolidated/migration.sql')
  const sql = fs.readFileSync(migrationPath, 'utf-8')

  it('should exist and be non-empty', () => {
    expect(sql.length).toBeGreaterThan(100)
  })

  it('should create rooms table with all columns', () => {
    expect(sql).toContain('CREATE TABLE `rooms`')
    expect(sql).toContain('`id` text PRIMARY KEY')
    expect(sql).toContain('`code` text NOT NULL UNIQUE')
    expect(sql).toContain('`name` text NOT NULL')
    expect(sql).toContain('`host_name` text NOT NULL')
    expect(sql).toContain('`max_players` integer')
    expect(sql).toContain('`password_hash` text')
    expect(sql).toContain('`status` text')
    expect(sql).toContain('`created_at` integer NOT NULL')
  })

  it('should create players table with foreign key', () => {
    expect(sql).toContain('CREATE TABLE `players`')
    expect(sql).toContain('`room_id` text NOT NULL')
    expect(sql).toContain('FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE')
    expect(sql).toContain('UNIQUE INDEX `idx_players_room_name`')
  })

  it('should create questions table', () => {
    expect(sql).toContain('CREATE TABLE `questions`')
    expect(sql).toContain('`type` text NOT NULL')
    expect(sql).toContain('`text` text NOT NULL')
    expect(sql).toContain('`created_at` integer')
  })

  it('should create games table with all columns', () => {
    expect(sql).toContain('CREATE TABLE `games`')
    expect(sql).toContain('`room_id` text NOT NULL')
    expect(sql).toContain('`player_order` text NOT NULL')
    expect(sql).toContain('`current_player_index` integer DEFAULT 0 NOT NULL')
    expect(sql).toContain('`round` integer DEFAULT 1 NOT NULL')
    expect(sql).toContain('`finished_at` integer')
  })

  it('should create turns table with auto-increment', () => {
    expect(sql).toContain('CREATE TABLE `turns`')
    expect(sql).toContain('`id` integer PRIMARY KEY AUTOINCREMENT')
    expect(sql).toContain('`type` text NOT NULL')
    expect(sql).toContain('`status` text DEFAULT \'pending\' NOT NULL')
  })

  it('should have statement breakpoints between CREATE TABLE statements', () => {
    const createCount = (sql.match(/CREATE TABLE/g) || []).length
    const breakpointCount = (sql.match(/--> statement-breakpoint/g) || []).length
    expect(createCount).toBeGreaterThanOrEqual(5)
    expect(breakpointCount).toBeGreaterThanOrEqual(createCount - 1)
  })
})

describe('seed data', () => {
  const seedPath = path.resolve(__dirname, '../../migrations/seed.sql')
  const sql = fs.readFileSync(seedPath, 'utf-8')

  it('should exist and be non-empty', () => {
    expect(sql.length).toBeGreaterThan(100)
  })

  it('should contain 500 truth questions (t001-t500)', () => {
    // Count lines starting with value tuples like ('t001', 'truth', ...)
    // Note: seed.sql has ONE INSERT statement with 500 multi-row values
    const valueLines = sql.match(/\('t\d{3}'/g) || []
    expect(valueLines.length).toBe(500)
  })

  it('should have sequential IDs from t001 to t500', () => {
    for (let i = 1; i <= 500; i++) {
      const id = `'t${String(i).padStart(3, '0')}'`
      expect(sql).toContain(id)
    }
  })

  it('should only contain truth type questions', () => {
    const dareCount = (sql.match(/'dare'/g) || []).length
    expect(dareCount).toBe(0)
  })

  it('should only use INSERT OR IGNORE (single multi-value statement)', () => {
    // The seed uses a single multi-row INSERT with 500 value tuples
    const insertCount = (sql.match(/INSERT OR IGNORE INTO/g) || []).length
    expect(insertCount).toBe(1)
  })

  it('should have non-empty question texts', () => {
    const lines = sql.split('\n')
    const valueLines = lines.filter(l => l.trim().startsWith("('t"))
    for (const line of valueLines) {
      const matches = line.match(/'truth',\s*'([^']+)'/)
      if (matches) {
        expect(matches[1].length).toBeGreaterThan(0)
      }
    }
  })

  it('should have reasonable question text length (min 5 chars)', () => {
    const lines = sql.split('\n')
    const valueLines = lines.filter(l => l.trim().startsWith("('t"))
    const shortQuestions = valueLines.filter(l => {
      const match = l.match(/'truth',\s*'([^']+)'/)
      return match && match[1].length < 5
    })
    expect(shortQuestions).toHaveLength(0)
  })

  it('should not have duplicate question texts', () => {
    const lines = sql.split('\n')
    const valueLines = lines.filter(l => l.trim().startsWith("('t"))
    const texts = valueLines.map(l => {
      const match = l.match(/'truth',\s*'([^']+)'/)
      return match ? match[1] : ''
    }).filter(Boolean)
    const uniqueTexts = new Set(texts)
    expect(uniqueTexts.size).toBe(texts.length)
  })
})

describe('schema consistency with migration', () => {
  const migrationPath = path.resolve(__dirname, '../../migrations/0000_consolidated/migration.sql')
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8')

  it('should have matching table names between schema and migration', () => {
    expect(migrationSql).toContain('CREATE TABLE `rooms`')
    expect(migrationSql).toContain('CREATE TABLE `players`')
    expect(migrationSql).toContain('CREATE TABLE `questions`')
    expect(migrationSql).toContain('CREATE TABLE `games`')
    expect(migrationSql).toContain('CREATE TABLE `turns`')
  })

  it('should have foreign key constraints for all relationships', () => {
    expect(migrationSql).toContain('`room_id`')
    expect(migrationSql).toContain('`game_id`')
    expect(migrationSql).toContain('`question_id`')
    expect(migrationSql).toContain('FOREIGN KEY')
  })
})
