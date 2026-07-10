import type { DbEnv } from './db'
import type { RoomDO } from './rooms/room-do'

export interface Player {
  id: string
  name: string
  isHost: boolean
}

export interface Room {
  id: string
  code: string
  name: string
  hostName: string
  maxPlayers: number
  players: Player[]
  hasPassword: boolean
  status: 'waiting' | 'playing' | 'finished'
  createdAt: number
}

export type Bindings = DbEnv & {
  ROOM_DO: DurableObjectNamespace<RoomDO>
}
