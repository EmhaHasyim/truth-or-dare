import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export type DbEnv = {
  DB: D1Database
}

export function createDb(db: D1Database) {
  return drizzle(db)
}

export type DbInstance = ReturnType<typeof createDb>

export { schema }
