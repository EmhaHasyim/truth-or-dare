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
