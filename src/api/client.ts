import { hc } from 'hono/client'
import type { AppType } from './index'
import type { Room } from '../types'

export const apiClient = hc<AppType>('/api')

// Hono RPC infers response types automatically from the route definitions.
// No manual response type aliases needed.

export type CreateRoomResponse = Room
