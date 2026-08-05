import { STALE_ROOM_AGE_MS, FINISHED_ROOM_AGE_MS } from '../constants'

/**
 * Removes stale rooms from D1 (run by the worker's scheduled/cron handler):
 *
 *  - `waiting` rooms with no activity for `STALE_ROOM_AGE_MS`. This catches
 *    "zombie" rooms whose creator never connected to the WebSocket — those
 *    never arm a DO alarm because the Durable Object is never instantiated,
 *    so they used to linger in the lobby listing forever.
 *  - `finished` rooms older than `FINISHED_ROOM_AGE_MS`.
 *
 * Deletes in dependency order (turns → games → players → rooms) so nothing is
 * orphaned even if D1 does not enforce foreign-key cascades, then sweeps any
 * rows orphaned by earlier cascade-less deletes (e.g. the DO's
 * cleanupRoomFromD1 only removes the room row itself).
 *
 * @returns the number of rooms removed.
 */
export async function cleanupStaleRooms(db: D1Database, now = Date.now()): Promise<number> {
  const waitingCutoff = now - STALE_ROOM_AGE_MS
  const finishedCutoff = now - FINISHED_ROOM_AGE_MS

  const stale = await db
    .prepare(
      `SELECT id FROM rooms WHERE (status = 'waiting' AND last_active_at < ?) OR (status = 'finished' AND created_at < ?)`,
    )
    .bind(waitingCutoff, finishedCutoff)
    .all<{ id: string }>()

  const ids = (stale.results ?? []).map((r) => r.id)
  if (ids.length === 0) return 0

  const where = `(status = 'waiting' AND last_active_at < ?) OR (status = 'finished' AND created_at < ?)`

  await db.batch([
    db
      .prepare(
        `DELETE FROM turns WHERE game_id IN (SELECT id FROM games WHERE room_id IN (SELECT id FROM rooms WHERE ${where}))`,
      )
      .bind(waitingCutoff, finishedCutoff),
    db
      .prepare(`DELETE FROM games WHERE room_id IN (SELECT id FROM rooms WHERE ${where})`)
      .bind(waitingCutoff, finishedCutoff),
    db
      .prepare(`DELETE FROM players WHERE room_id IN (SELECT id FROM rooms WHERE ${where})`)
      .bind(waitingCutoff, finishedCutoff),
    db.prepare(`DELETE FROM rooms WHERE ${where}`).bind(waitingCutoff, finishedCutoff),
    // Sweep rows orphaned by earlier cascade-less deletes.
    db.prepare('DELETE FROM players WHERE room_id NOT IN (SELECT id FROM rooms)'),
    db.prepare('DELETE FROM games WHERE room_id NOT IN (SELECT id FROM rooms)'),
    db.prepare('DELETE FROM turns WHERE game_id NOT IN (SELECT id FROM games)'),
  ])

  return ids.length
}
