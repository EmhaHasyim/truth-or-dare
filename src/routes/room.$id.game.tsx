import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/solid-router'
import { createSignal, onMount, onCleanup } from 'solid-js'
import { z } from 'zod'
import { getStoredUsername } from '../lib/username'
import { getStoredPlayerSession } from '../lib/player-session'
import { getWsUrl } from '../lib/ws'
import {
  Check,
  X,
  SkipForward,
  Gamepad2,
  Users,
  LogOut,
  Sparkles,
  Flag,
  RefreshCw,
} from 'lucide-solid'
import { MAX_RECONNECT_ATTEMPTS, WS_RECONNECT_DELAY } from '../constants'
import { serverMessageSchema } from '../types/ws-validation'
import type { ServerMessageOutput } from '../types/ws-validation'
import type { WsPlayer } from '../types/ws'
import { playTurnChime, playSuccess, playSkip, playFanfare } from '../lib/sounds'
import { fireConfetti } from '../lib/confetti'
import { vibrate } from '../lib/haptic'

const searchSchema = z.object({
  playerId: z.string().catch(''),
})

export const Route = createFileRoute('/room/$id/game')({
  component: GamePage,
  validateSearch: searchSchema,
})

type GamePhase = 'connecting' | 'show_question' | 'waiting_turn' | 'turn_result' | 'game_ended'

function GamePage() {
  const navigate = useNavigate()
  const routeParams = useParams({ from: '/room/$id/game' })
  const search = useSearch({ from: '/room/$id/game' })
  const roomId = routeParams().id
  const storedSession = getStoredPlayerSession(roomId)

  const [phase, setPhase] = createSignal<GamePhase>('connecting')
  const [players, setPlayers] = createSignal<WsPlayer[]>([])
  const [myPlayerId, setMyPlayerId] = createSignal(
    search().playerId || storedSession?.playerId || '',
  )
  const [currentTurnPlayerId, setCurrentTurnPlayerId] = createSignal('')
  const [currentTurnPlayerName, setCurrentTurnPlayerName] = createSignal('')
  const [question, setQuestion] = createSignal('')
  const [lastResult, setLastResult] = createSignal<{ playerName: string; status: string } | null>(
    null,
  )
  const [round, setRound] = createSignal(1)
  const [isHost, setIsHost] = createSignal(false)
  const [ws, setWs] = createSignal<WebSocket | null>(null)
  const [wsError, setWsError] = createSignal('')
  let reconnectCount = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectTimeout: ReturnType<typeof setTimeout> | null = null
  let turnResultTimer: ReturnType<typeof setTimeout> | null = null
  let wsCleanup: (() => void) | null = null

  onMount(() => {
    const username = getStoredUsername()
    if (!username) {
      navigate({ to: '/' })
      return
    }
    connectWs()
  })

  onCleanup(() => {
    if (turnResultTimer) {
      clearTimeout(turnResultTimer)
      turnResultTimer = null
    }
    cleanupWs()
  })

  function cleanupWs() {
    if (connectTimeout) {
      clearTimeout(connectTimeout)
      connectTimeout = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (turnResultTimer) {
      clearTimeout(turnResultTimer)
      turnResultTimer = null
    }
    if (wsCleanup) {
      wsCleanup()
      wsCleanup = null
    }
    ws()?.close()
    setWs(null)
  }

  function connectWs() {
    cleanupWs()
    setWsError('')
    const pid = search().playerId || storedSession?.playerId || ''
    // Prefer the registered name so the server's name-match check passes even
    // if the user changed their stored username after joining.
    const username = storedSession?.playerName || getStoredUsername() || ''
    const socket = new WebSocket(
      getWsUrl(
        `/ws/${roomId}?name=${encodeURIComponent(username)}${pid ? `&playerId=${encodeURIComponent(pid)}` : ''}`,
      ),
    )

    connectTimeout = setTimeout(() => {
      if (phase() === 'connecting') setWsError('Server game tidak merespon')
    }, 8000)

    socket.onopen = () => {
      if (connectTimeout) {
        clearTimeout(connectTimeout)
        connectTimeout = null
      }
      reconnectCount = 0
      setWsError('')
    }

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        const result = serverMessageSchema.safeParse(parsed)
        if (result.success) handleMessage(result.data)
      } catch {
        /* ignore */
      }
    }

    socket.onclose = () => {
      if (connectTimeout) {
        clearTimeout(connectTimeout)
        connectTimeout = null
      }
      if (phase() !== 'game_ended' && !reconnectTimer && reconnectCount < MAX_RECONNECT_ATTEMPTS) {
        setPhase('connecting')
        reconnectCount++
        setWsError(`Menyambung (${reconnectCount}/${MAX_RECONNECT_ATTEMPTS})...`)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connectWs()
        }, WS_RECONNECT_DELAY)
      } else if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
        setWsError('Koneksi terputus. Refresh halaman untuk mencoba lagi.')
      }
    }

    wsCleanup = () => {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
    }

    setWs(socket)
  }

  function sendEndGame() {
    const socket = ws()
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify({ type: 'end_game' }))
    } catch {}
  }

  const [showLeaveModal, setShowLeaveModal] = createSignal(false)
  const [showEndModal, setShowEndModal] = createSignal(false)

  function handleMessage(msg: ServerMessageOutput) {
    switch (msg.type) {
      case 'room_state':
        setMyPlayerId(msg.playerId)
        setPlayers(msg.players)
        // Detect if I'm the host
        const me = msg.players.find((p) => p.id === msg.playerId)
        if (me) setIsHost(me.isHost)
        if (phase() === 'connecting') setPhase('waiting_turn')
        if (currentTurnPlayerId() && !currentTurnPlayerName()) {
          const cp = msg.players.find((p) => p.id === currentTurnPlayerId())
          if (cp) setCurrentTurnPlayerName(cp.name)
        }
        break
      case 'player_joined':
      case 'player_left':
        setPlayers(msg.players)
        break
      case 'game_started':
        setPhase('waiting_turn')
        setRound(msg.round)
        const firstPlayerId = msg.playerOrder[msg.currentPlayerIndex]
        setCurrentTurnPlayerId(firstPlayerId)
        // Try from existing players first; fall back to 'Pemain X' if unknown
        const known = players().find((p) => p.id === firstPlayerId)
        setCurrentTurnPlayerName(
          known?.name || (firstPlayerId === myPlayerId() ? getStoredUsername() || '' : ''),
        )
        break
      case 'turn_question':
        setCurrentTurnPlayerId(msg.playerId)
        setCurrentTurnPlayerName(msg.playerName)
        setQuestion(msg.question)
        setPhase('show_question')
        if (msg.playerId === myPlayerId()) {
          playTurnChime()
          vibrate(25)
        }
        break
      case 'waiting_for_choice':
        setCurrentTurnPlayerId(msg.playerId)
        setCurrentTurnPlayerName(msg.playerName)
        setPhase('waiting_turn')
        break
      case 'turn_result':
        setLastResult({ playerName: msg.playerName, status: msg.status })
        setCurrentTurnPlayerId(msg.nextPlayerId)
        setCurrentTurnPlayerName(msg.nextPlayerName)
        if (msg.round !== undefined) setRound(msg.round)
        setPhase('turn_result')
        if (msg.status === 'completed') playSuccess()
        else playSkip()
        if (turnResultTimer) {
          clearTimeout(turnResultTimer)
          turnResultTimer = null
        }
        turnResultTimer = setTimeout(() => {
          turnResultTimer = null
          setPhase('waiting_turn')
        }, 2800)
        break
      case 'game_ended':
        setPhase('game_ended')
        playFanfare()
        setTimeout(() => fireConfetti(), 200)
        break
    }
  }

  function send(msg: { type: 'turn_done'; status: 'completed' | 'skipped' }) {
    const socket = ws()
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(msg))
    } catch {}
  }

  function completeTurn() {
    vibrate(15)
    send({ type: 'turn_done', status: 'completed' })
  }
  function skipTurn() {
    vibrate(10)
    send({ type: 'turn_done', status: 'skipped' })
  }

  const isMyTurn = () => currentTurnPlayerId() === myPlayerId()

  return (
    <div class="min-h-dvh flex flex-col bg-gradient-to-b from-base-200 to-base-300 pb-[env(safe-area-inset-bottom,0px)]">
      {/* Thin header */}
      <div class="flex items-center justify-between px-4 h-12 shrink-0">
        <button
          class="btn btn-ghost btn-sm min-h-[36px] rounded-xl text-base-content/50"
          aria-label="Tinggalkan game"
          onClick={() => setShowLeaveModal(true)}
        >
          <LogOut size={15} />
        </button>
        <div class="flex items-center gap-2">
          {isHost() && phase() !== 'game_ended' && (
            <button
              class="btn btn-ghost btn-sm min-h-[36px] rounded-xl text-error/70"
              aria-label="Akhiri game"
              onClick={() => setShowEndModal(true)}
            >
              <Flag size={14} />
            </button>
          )}
          <div class="badge badge-ghost badge-sm gap-1.5 px-3 py-2">
            <Sparkles size={12} />
            <span class="text-xs font-medium">Ronde {round()}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <Users size={14} class="text-base-content/40" />
          <span class="text-xs text-base-content/50 font-medium">{players().length}</span>
        </div>
      </div>

      {/* Player avatars row */}
      <div class="flex justify-center gap-2 px-4 mb-3">
        {players().map((p) => {
          const isCurrent = p.id === currentTurnPlayerId()
          const isMe = p.id === myPlayerId()
          return (
            <div class="flex flex-col items-center gap-1" classList={{ 'opacity-40': !isCurrent }}>
              <div
                class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
                classList={{
                  'bg-primary text-primary-content ring-2 ring-primary/30 scale-110': isCurrent,
                  'bg-base-300 text-base-content/60': !isCurrent,
                  'ring-2 ring-accent/50': isMe && !isCurrent,
                }}
              >
                {p.name[0].toUpperCase()}
              </div>
              <span class="text-[10px] font-medium truncate max-w-[48px] text-base-content/50">
                {p.name}
                {isMe ? '' : ''}
              </span>
            </div>
          )
        })}
      </div>

      {/* Main content */}
      <div class="flex-1 flex flex-col px-4 pb-4">
        <div class="flex-1 flex items-center justify-center">
          {/* Connecting */}
          {phase() === 'connecting' && (
            <div class="text-center phase-fade-in">
              {wsError() ? (
                <div class="bg-base-100 rounded-2xl shadow-sm border border-base-200 p-6 max-w-sm w-full">
                  <div class="text-center">
                    <div class="w-12 h-12 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-3">
                      <X size={24} class="text-error" />
                    </div>
                    <h2 class="font-bold text-base mb-1">Koneksi Error</h2>
                    <p class="text-sm text-base-content/50 mb-5">{wsError()}</p>
                    <div class="flex flex-col gap-2">
                      <button
                        class="btn btn-primary min-h-[44px] w-full rounded-xl shadow-md"
                        onClick={() => window.location.reload()}
                      >
                        <RefreshCw size={16} /> Refresh Halaman
                      </button>
                      <button
                        class="btn btn-ghost min-h-[44px] w-full rounded-xl"
                        onClick={() => navigate({ to: '/' })}
                      >
                        Kembali
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <span class="loading loading-spinner loading-md text-primary" />
                  <p class="mt-3 text-sm text-base-content/50">Menghubungkan ke game...</p>
                </>
              )}
            </div>
          )}

          {/* Question card */}
          {phase() === 'show_question' && (
            <div class="w-full max-w-sm phase-slide-up">
              <div class="bg-base-100 rounded-3xl shadow-lg border border-base-200 p-6 text-center">
                <div class="badge badge-accent badge-soft badge-sm mb-4 px-3 py-2">TRUTH</div>
                <p class="text-lg font-medium leading-relaxed min-h-[80px] flex items-center justify-center">
                  {question()}
                </p>
              </div>

              {isMyTurn() ? (
                <div class="flex flex-col gap-2.5 mt-5">
                  <button
                    class="btn btn-primary w-full min-h-[52px] text-base font-bold shadow-md rounded-2xl active:scale-[0.97] transition-all duration-150"
                    onClick={completeTurn}
                  >
                    <Check size={20} /> Selesai
                  </button>
                  <button
                    class="btn btn-ghost w-full min-h-[48px] text-sm rounded-xl text-base-content/50"
                    onClick={skipTurn}
                  >
                    <SkipForward size={16} /> Skip
                  </button>
                </div>
              ) : (
                <div class="flex flex-col items-center gap-3 mt-6">
                  <span class="loading loading-dots loading-md text-primary" />
                  <p class="text-sm text-base-content/50">
                    Menunggu {currentTurnPlayerName()} menjawab...
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Waiting */}
          {phase() === 'waiting_turn' && (
            <div class="text-center phase-fade-in">
              <div class="w-16 h-16 rounded-full bg-base-300 flex items-center justify-center mx-auto mb-4">
                <span class="text-2xl font-bold text-base-content/60">
                  {currentTurnPlayerName()[0]?.toUpperCase() || '?'}
                </span>
              </div>
              <p class="font-bold text-base">{currentTurnPlayerName()}</p>
              <p class="text-sm text-base-content/50 mt-1">sedang giliran...</p>
              <span class="loading loading-dots loading-md text-primary mt-4" />
            </div>
          )}

          {/* Turn result */}
          {phase() === 'turn_result' && lastResult() && (
            <div class="w-full max-w-sm phase-slide-up">
              <div class="bg-base-100 rounded-3xl shadow-lg border border-base-200 p-6 text-center">
                <div
                  class={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${lastResult()?.status === 'completed' ? 'bg-success/10' : 'bg-base-200'}`}
                >
                  {lastResult()?.status === 'completed' ? (
                    <Check size={28} class="text-success" />
                  ) : (
                    <SkipForward size={28} class="text-base-content/40" />
                  )}
                </div>
                <p class="font-bold text-base">{lastResult()?.playerName}</p>
                <p class="text-sm text-base-content/50 mt-1">
                  {lastResult()?.status === 'completed' ? 'menjawab pertanyaan!' : 'melewati'}
                </p>
                <div class="w-full bg-base-200 rounded-full h-1.5 mt-5 overflow-hidden">
                  <div
                    class="h-full bg-primary rounded-full progress-countdown"
                    style="animation-duration: 2.8s"
                  />
                </div>
                <p class="text-xs text-base-content/40 mt-3">
                  {currentTurnPlayerName()} selanjutnya...
                </p>
              </div>
            </div>
          )}

          {/* Game ended */}
          {phase() === 'game_ended' && (
            <div class="w-full max-w-sm phase-slide-up">
              <div class="bg-base-100 rounded-3xl shadow-lg border border-base-200 p-6 text-center">
                <div class="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Gamepad2 size={28} class="text-primary" />
                </div>
                <h2 class="text-xl font-black gradient-text mb-1">Game Selesai!</h2>
                <p class="text-sm text-base-content/50 mb-6">Makasih udah main!</p>

                <div class="stats stats-vertical shadow-sm w-full rounded-xl mb-6">
                  <div class="stat py-3">
                    <div class="stat-title text-xs">Total Ronde</div>
                    <div class="stat-value text-lg text-primary">{round()}</div>
                  </div>
                  <div class="stat py-3">
                    <div class="stat-title text-xs">Pemain</div>
                    <div class="stat-value text-lg text-secondary">{players().length}</div>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <button
                    class="btn btn-primary w-full min-h-[48px] text-sm font-bold shadow-md rounded-xl"
                    onClick={() => navigate({ to: '/create-room' })}
                  >
                    <Gamepad2 size={18} /> Main Lagi
                  </button>
                  <button
                    class="btn btn-ghost w-full min-h-[44px] text-sm rounded-xl"
                    onClick={() => navigate({ to: '/' })}
                  >
                    Kembali
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* End game modal */}
      <dialog class={`modal ${showEndModal() ? 'modal-open' : ''}`}>
        <div class="modal-box p-6 rounded-2xl">
          <h3 class="text-lg font-bold mb-1">Akhiri Game?</h3>
          <p class="text-sm text-base-content/50 mb-6">Game akan berakhir untuk semua pemain.</p>
          <div class="flex flex-col gap-2">
            <button
              class="btn btn-error w-full min-h-[48px] rounded-xl shadow-md"
              onClick={() => {
                setShowEndModal(false)
                sendEndGame()
              }}
            >
              <Flag size={16} /> Akhiri Game
            </button>
            <button
              class="btn btn-ghost w-full min-h-[48px] rounded-xl"
              onClick={() => setShowEndModal(false)}
            >
              Batal
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button onClick={() => setShowEndModal(false)}>close</button>
        </form>
      </dialog>

      {/* Leave game modal */}
      <dialog class={`modal ${showLeaveModal() ? 'modal-open' : ''}`}>
        <div class="modal-box p-6 rounded-2xl">
          <h3 class="text-lg font-bold mb-1">Tinggalkan Game?</h3>
          <p class="text-sm text-base-content/50 mb-6">Kamu bisa balik lewat halaman room.</p>
          <div class="flex flex-col gap-2">
            <button
              class="btn btn-primary w-full min-h-[48px] rounded-xl shadow-md"
              onClick={() => {
                setShowLeaveModal(false)
                navigate({ to: '/' })
              }}
            >
              Ya, Keluar
            </button>
            <button
              class="btn btn-ghost w-full min-h-[48px] rounded-xl"
              onClick={() => setShowLeaveModal(false)}
            >
              Batal
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button onClick={() => setShowLeaveModal(false)}>close</button>
        </form>
      </dialog>
    </div>
  )
}
