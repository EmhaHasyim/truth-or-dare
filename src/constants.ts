export const MAX_PLAYERS = 2
/** Maximum rounds before the game auto-ends (0 = no limit) */
export const MAX_ROUNDS = 10
export const MAX_RECONNECT_ATTEMPTS = 5
export const WS_RECONNECT_DELAY = 2000

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6
export const MAX_CODE_GENERATION_RETRIES = 10

export const EMPTY_ROOM_TIMEOUT = 3_600_000
export const EMPTY_ROOM_CHECK_INTERVAL = 300_000

/** Time in ms before a player's turn is auto-skipped if they don't respond */
export const TURN_TIMEOUT_MS = 60_000

/** Grace period (ms) to wait for players to reconnect before ending the game when all disconnect */
export const DISCONNECT_GRACE_MS = 15_000

/**
 * Waiting rooms with no activity for this long are removed by the hourly cron.
 * `last_active_at` is bumped whenever a player connects to the room's DO.
 */
export const STALE_ROOM_AGE_MS = 6 * 60 * 60 * 1000

/** Finished rooms older than this are purged by the hourly cron. */
export const FINISHED_ROOM_AGE_MS = 24 * 60 * 60 * 1000
