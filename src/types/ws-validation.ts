import { z } from 'zod'

const wsPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  isHost: z.boolean(),
})

export type WsPlayer = z.infer<typeof wsPlayerSchema>

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('room_state'),
    playerId: z.string(),
    players: z.array(wsPlayerSchema),
  }),
  z.object({
    type: z.literal('player_joined'),
    playerId: z.string(),
    playerName: z.string(),
    isHost: z.boolean(),
    players: z.array(wsPlayerSchema),
  }),
  z.object({
    type: z.literal('player_left'),
    playerId: z.string(),
    players: z.array(wsPlayerSchema),
  }),
  z.object({
    type: z.literal('game_started'),
    gameId: z.string(),
    playerOrder: z.array(z.string()),
    currentPlayerIndex: z.number(),
    round: z.number(),
  }),
  z.object({
    type: z.literal('turn_question'),
    playerId: z.string(),
    playerName: z.string(),
    questionType: z.union([z.literal('truth'), z.literal('dare')]),
    question: z.string(),
    questionId: z.string(),
  }),
  z.object({ type: z.literal('waiting_for_choice'), playerId: z.string(), playerName: z.string() }),
  z.object({
    type: z.literal('turn_result'),
    playerId: z.string(),
    playerName: z.string(),
    status: z.union([z.literal('completed'), z.literal('skipped')]),
    questionType: z.union([z.literal('truth'), z.literal('dare')]),
    nextPlayerId: z.string(),
    nextPlayerName: z.string(),
    round: z.number(),
  }),
  z.object({ type: z.literal('game_ended') }),
  z.object({ type: z.literal('error'), message: z.string() }),
])

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_game') }),
  z.object({ type: z.literal('select_truth') }),
  z.object({
    type: z.literal('turn_done'),
    status: z.union([z.literal('completed'), z.literal('skipped')]),
  }),
  z.object({ type: z.literal('end_game') }),
])

export type ServerMessageOutput = z.infer<typeof serverMessageSchema>
export type ClientMessageOutput = z.infer<typeof clientMessageSchema>
