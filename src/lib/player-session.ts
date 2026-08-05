// Remembers the player identity this browser used for a given room (per
// tab/session). Needed for reconnects: when a player's D1 row is cleaned up
// on disconnect, the room listing no longer contains their playerId, but the
// WebSocket endpoint requires a matching playerId + name.
//
// The playerName is stored too so we can always send a name that matches the
// registered player — even if the user changed their stored username after
// creating/joining the room.

const KEY_PREFIX = 'tod-player-session-'

export interface StoredPlayerSession {
  playerId: string
  playerName: string
}

export function storePlayerSession(roomId: string, session: StoredPlayerSession): void {
  if (typeof window === 'undefined' || !roomId || !session?.playerId || !session?.playerName) return
  try {
    sessionStorage.setItem(KEY_PREFIX + roomId, JSON.stringify(session))
  } catch {
    // sessionStorage unavailable (private mode etc.) — reconnect falls back to
    // finding the player by name in the room listing.
  }
}

export function getStoredPlayerSession(roomId: string): StoredPlayerSession | null {
  if (typeof window === 'undefined' || !roomId) return null
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + roomId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredPlayerSession>
    if (typeof parsed?.playerId !== 'string' || typeof parsed?.playerName !== 'string') return null
    return { playerId: parsed.playerId, playerName: parsed.playerName }
  } catch {
    return null
  }
}
