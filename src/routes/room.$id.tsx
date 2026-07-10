import { createFileRoute, Outlet, useMatch, useNavigate, useParams } from '@tanstack/solid-router'
import { createSignal, Match, onCleanup, onMount, Switch, Show } from 'solid-js'
import { getStoredUsername } from '../lib/username'
import { getWsUrl } from '../lib/ws'
import { MAX_RECONNECT_ATTEMPTS, WS_RECONNECT_DELAY } from '../constants'
import { apiClient } from '../api/client'
import { serverMessageSchema } from '../types/ws-validation'
import { showToast } from '../lib/toast'
import { SkeletonPlayerList } from '../components/skeleton'
import type { WsPlayer } from '../types/ws'
import type { Room, Player } from '../types'
import { Users, Copy, Share2, Play, ArrowLeft, Crown } from 'lucide-solid'

export const Route = createFileRoute('/room/$id')({
  component: RoomPage,
  loader: async ({ params }) => {
    const res = await apiClient.rooms[':id'].$get({ param: { id: params.id } })
    if (!res.ok) return null
    return await res.json() as Room
  },
})

function formatRoomCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}` : code
}

function RoomPage() {
  const navigate = useNavigate()
  const routeParams = useParams({ from: '/room/$id' })
  const loaderData = Route.useLoaderData()
  const id = routeParams().id

  const [room, setRoom] = createSignal<Room | null>(loaderData() ?? null)
  const [players, setPlayers] = createSignal<WsPlayer[]>([])
  const [myPlayerId, setMyPlayerId] = createSignal('')
  const [error, setError] = createSignal('')
  const [ws, setWs] = createSignal<WebSocket | null>(null)
  const [isReconnecting, setIsReconnecting] = createSignal(false)
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectCount = 0
  let wsCleanup: (() => void) | null = null
  let gameStarted = false

  onMount(async () => {
    const username = getStoredUsername()
    if (!username) { navigate({ to: '/' }); return }

    if (!room()) {
      try {
        const res = await apiClient.rooms[':id'].$get({ param: { id } })
        if (!res.ok) { setError('Room tidak ditemukan'); return }
        setRoom(await res.json() as Room)
      } catch { setError('Gagal muat room') }
    }

    const currentRoom = room()
    if (!currentRoom) return

    const myPlayer = currentRoom.players.find((p: Player) => p.name === username)
    connectWs(id, username, myPlayer?.id || '')
  })

  onCleanup(() => cleanupWs())

  function cleanupWs() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (wsCleanup) { wsCleanup(); wsCleanup = null }
    ws()?.close()
    setWs(null)
    setIsReconnecting(false)
  }

  function connectWs(roomId: string, name: string, playerIdFromRoom: string) {
    cleanupWs()
    setError('')
    const url = playerIdFromRoom
      ? getWsUrl(`/ws/${roomId}?name=${encodeURIComponent(name)}&playerId=${encodeURIComponent(playerIdFromRoom)}`)
      : getWsUrl(`/ws/${roomId}?name=${encodeURIComponent(name)}`)
    const socket = new WebSocket(url)

    socket.onopen = () => {
      setError('')
      reconnectCount = 0
      setIsReconnecting(false)
    }

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        const msgResult = serverMessageSchema.safeParse(parsed)
        if (!msgResult.success) return
        const msg = msgResult.data
        switch (msg.type) {
          case 'room_state':
            setMyPlayerId(msg.playerId)
            setPlayers(msg.players)
            break
          case 'player_joined':
          case 'player_left':
            setPlayers(msg.players)
            break
          case 'game_started':
            gameStarted = true
            const myEntry = players().find(p => p.name === getStoredUsername())
            navigate({
              to: '/room/$id/game',
              params: { id: roomId },
              search: { playerId: myEntry?.id || myPlayerId() || '' },
            })
            break
          case 'error':
            setError(msg.message)
            break
        }
      } catch { /* ignore */ }
    }

    socket.onclose = () => {
      if (reconnectTimer) return
      scheduleReconnect(roomId, name, playerIdFromRoom)
    }

    wsCleanup = () => {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
    }

    setWs(socket)
  }

  function scheduleReconnect(roomId: string, name: string, playerIdFromRoom: string) {
    if (gameStarted) return
    if (!ws() || reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) setError('Koneksi terputus. Refresh halaman untuk mencoba lagi.')
      setIsReconnecting(false)
      return
    }
    reconnectCount++
    setIsReconnecting(true)
    setError('Menghubungkan kembali...')
    reconnectTimer = setTimeout(() => {
      connectWs(roomId, name, playerIdFromRoom)
    }, WS_RECONNECT_DELAY)
  }

  function startGame() {
    const socket = ws()
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try { socket.send(JSON.stringify({ type: 'start_game' })) } catch {}
  }

  const gameMatch = useMatch({ from: '/room/$id/game', shouldThrow: false })
  const username = getStoredUsername()

  return (
    <Switch>
      <Match when={!room()}>
        <div class="flex-1 flex items-center justify-center px-4">
          {error() ? (
            <div class="bg-base-100 rounded-2xl shadow-sm border border-base-200 p-6 max-w-sm w-full text-center">
              <h2 class="font-bold text-lg mb-1">Room Tidak Ditemukan</h2>
              <p class="text-sm text-base-content/50 mb-5">{error()}</p>
              <button class="btn btn-primary min-h-[44px] w-full rounded-xl shadow-md" onClick={() => navigate({ to: '/' })}>
                Kembali
              </button>
            </div>
          ) : (
            <div class="text-center">
              <span class="loading loading-spinner loading-md" />
              <p class="mt-3 text-sm text-base-content/50">Memuat room...</p>
            </div>
          )}
        </div>
      </Match>
      <Match when={gameMatch()}>
        <Outlet />
      </Match>
      <Match when={true}>
        <div class="flex-1 flex flex-col px-4 pt-4" style="padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));">
          <div class="max-w-sm mx-auto w-full flex-1 flex flex-col">
            {/* Reconnect banner */}
            <Show when={isReconnecting()}>
              <div class="flex items-center gap-3 bg-warning/10 border border-warning/20 rounded-2xl px-4 py-3 mb-4">
                <span class="loading loading-spinner loading-sm text-warning" />
                <div>
                  <p class="text-sm font-semibold text-warning">Menyambung kembali...</p>
                  <p class="text-xs text-base-content/50">Percobaan {reconnectCount}/{MAX_RECONNECT_ATTEMPTS}</p>
                </div>
              </div>
            </Show>

            <Show when={error() && !isReconnecting()}>
              <div class="bg-error/5 border border-error/20 rounded-2xl px-4 py-3 mb-4">
                <p class="text-sm text-error">{error()}</p>
              </div>
            </Show>

            {/* Room header */}
            <div class="bg-base-100 rounded-2xl shadow-sm border border-base-200 p-5 mb-4">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div class="min-w-0">
                  <h1 class="font-bold text-lg truncate">{room()!.name}</h1>
                  <p class="text-xs text-base-content/50 mt-0.5">
                    Oleh {room()!.hostName} · {players().length}/{room()!.maxPlayers} pemain
                  </p>
                </div>
                <button class="btn btn-ghost btn-sm min-h-[36px] rounded-xl" onClick={() => navigate({ to: '/' })}>
                  <ArrowLeft size={16} />
                </button>
              </div>

              {/* Room code */}
              <div class="bg-base-200 rounded-xl p-4 text-center mb-4">
                <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-2">Kode Room</p>
                <div class="text-2xl font-mono font-black tracking-[0.25em] text-primary">
                  {formatRoomCode(room()!.code)}
                </div>
                <button class="btn btn-ghost btn-sm min-h-[36px] rounded-xl mt-2 text-xs" onClick={() => {
                  navigator.clipboard.writeText(room()!.code)
                  showToast('Kode room disalin!', 'success')
                }}>
                  <Copy size={13} /> Salin Kode
                </button>
              </div>

              {/* Share buttons */}
              <div class="flex gap-2">
                <button class="btn btn-outline flex-1 min-h-[44px] rounded-xl text-xs font-medium" onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  showToast('Link room disalin!', 'success')
                }}>
                  <Share2 size={15} /> Salin Link
                </button>
                <button class="btn btn-outline flex-1 min-h-[44px] rounded-xl text-xs font-medium" onClick={() =>
                  window.open(`https://wa.me/?text=${encodeURIComponent('Ikutan main Truth or Dare yuk! Kode: ' + room()!.code)}`)
                }>
                  <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> WhatsApp
                </button>
              </div>
            </div>

            {/* Players */}
            <div class="bg-base-100 rounded-2xl shadow-sm border border-base-200 p-5 flex-1">
              <div class="flex items-center gap-2 mb-4">
                <Users size={16} class="text-base-content/50" />
                <h2 class="font-semibold text-sm">Pemain</h2>
                <span class="badge badge-ghost badge-xs ml-auto">{players().length}</span>
              </div>

              <Show when={players().length === 0}>
                <SkeletonPlayerList count={3} />
              </Show>

              <ul class="space-y-2">
                {players().map((p, idx) => (
                  <li class="flex items-center gap-3 bg-base-200/70 rounded-xl px-4 py-3 phase-fade-in" style={`animation-delay: ${idx * 50}ms`}>
                    <div class="w-9 h-9 rounded-full bg-primary text-primary-content flex items-center justify-center text-sm font-bold shrink-0">
                      {p.name[0].toUpperCase()}
                    </div>
                    <span class="font-medium text-sm min-w-0 truncate">{p.name}</span>
                    <div class="ml-auto flex items-center gap-1.5 shrink-0">
                      {p.isHost && <Crown size={14} class="text-accent" />}
                      {p.name === username && <span class="badge badge-ghost badge-xs">Kamu</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Start/Leave buttons */}
            <div class="mt-4 space-y-2.5">
              {room()!.hostName === username ? (
                <button
                  class="btn btn-primary w-full min-h-[50px] text-base font-bold shadow-md rounded-xl"
                  onClick={startGame}
                  disabled={players().length < 2}
                >
                  {players().length < 2 ? <><Users size={18} /> Butuh 2 pemain</> : <><Play size={18} /> Mulai Game</>}
                </button>
              ) : (
                <div class="flex items-center justify-center gap-2 bg-base-100 rounded-xl py-3.5 border border-base-200">
                  <span class="loading loading-dots loading-sm text-primary" />
                  <span class="text-sm text-base-content/50">Menunggu host mulai...</span>
                </div>
              )}
              <button class="btn btn-ghost w-full min-h-[44px] rounded-xl text-sm text-base-content/50" onClick={() => navigate({ to: '/' })}>
                <ArrowLeft size={16} /> Keluar
              </button>
            </div>
          </div>
        </div>
      </Match>
    </Switch>
  )
}
