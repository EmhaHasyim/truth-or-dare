import type { WsPlayer } from './ws-validation'

export type { WsPlayer }

// Server -> Client messages
export interface WsRoomState {
  type: 'room_state'
  playerId: string
  players: WsPlayer[]
}

export interface WsPlayerJoined {
  type: 'player_joined'
  playerId: string
  playerName: string
  isHost: boolean
  players: WsPlayer[]
}

export interface WsPlayerLeft {
  type: 'player_left'
  playerId: string
  players: WsPlayer[]
}

export interface WsGameStarted {
  type: 'game_started'
  gameId: string
  playerOrder: string[]
  currentPlayerIndex: number
  round: number
}

export interface WsTurnQuestion {
  type: 'turn_question'
  playerId: string
  playerName: string
  questionType: 'truth' | 'dare'
  question: string
  questionId: string
}

export interface WsTurnResult {
  type: 'turn_result'
  playerId: string
  playerName: string
  status: 'completed' | 'skipped'
  questionType: 'truth' | 'dare'
  nextPlayerId: string
  nextPlayerName: string
  round: number
}

export interface WsWaitingForChoice {
  type: 'waiting_for_choice'
  playerId: string
  playerName: string
}

export interface WsGameEnded {
  type: 'game_ended'
}

export interface WsError {
  type: 'error'
  message: string
}

export type ServerMessage =
  | WsRoomState
  | WsPlayerJoined
  | WsPlayerLeft
  | WsGameStarted
  | WsTurnQuestion
  | WsTurnResult
  | WsWaitingForChoice
  | WsGameEnded
  | WsError

// Client -> Server messages
export interface WsStartGame {
  type: 'start_game'
}

export interface WsSelectTruth {
  type: 'select_truth'
}

export interface WsTurnDone {
  type: 'turn_done'
  status: 'completed' | 'skipped'
}

export interface WsEndGame {
  type: 'end_game'
}

export type ClientMessage = WsStartGame | WsSelectTruth | WsTurnDone | WsEndGame
