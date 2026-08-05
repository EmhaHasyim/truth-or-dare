import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { getStoredUsername, setStoredUsername } from '../lib/username'
import { storePlayerSession } from '../lib/player-session'
import { apiClient } from '../api/client'
import { Search, Lock, Plus, RefreshCw, Hash } from 'lucide-solid'
import { showToast } from '../lib/toast'
import { SkeletonCardList } from '../components/skeleton'
import type { Room } from '../types'

export const Route = createFileRoute('/join-room')({ component: JoinRoom })

function JoinRoom() {
  const navigate = useNavigate()
  const [name, setName] = createSignal('')
  const [code, setCode] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [fetching, setFetching] = createSignal(true)
  const [polling, setPolling] = createSignal(false)

  let pollCounter = 0

  async function fetchRooms(silent = false) {
    if (!silent) setFetching(true)
    const pollId = ++pollCounter
    try {
      const res = await apiClient.rooms.$get()
      if (res.ok) setRooms(await res.json())
    } catch {
      /* ignore */
    } finally {
      if (!silent) setFetching(false)
      else if (pollCounter === pollId) setPolling(false)
    }
  }

  onMount(() => {
    const stored = getStoredUsername()
    if (stored) setName(stored)
    fetchRooms(false)

    const intervalId = setInterval(() => {
      setPolling(true)
      fetchRooms(true)
    }, 7000)

    onCleanup(() => clearInterval(intervalId))
  })

  async function joinRoom(roomId: string, roomPassword: string | undefined) {
    setError('')
    if (!name().trim()) {
      setError('Masukkan nama kamu')
      return
    }
    setLoading(true)

    try {
      const joinRes = await apiClient.rooms[':id'].join.$post({
        param: { id: roomId },
        json: { playerName: name().trim(), password: roomPassword || undefined },
      })

      if (!joinRes.ok) {
        const errBody = (await joinRes.json()) as Record<string, unknown>
        setError(typeof errBody.error === 'string' ? errBody.error : 'Gagal gabung')
        setLoading(false)
        return
      }

      const joinedRoom = (await joinRes.json()) as Room
      const usedName = name().trim()
      // Keep the stored username in sync so the room page can find this
      // player by name after navigation.
      setStoredUsername(usedName)
      // Remember this browser's player identity for this room (see create-room.tsx).
      const myId = joinedRoom.players.find((p) => p.name === usedName)?.id
      if (myId) storePlayerSession(joinedRoom.id, { playerId: myId, playerName: usedName })
      showToast(`Gabung ke ${joinedRoom.name}!`, 'success')
      navigate({ to: `/room/${joinedRoom.id}` })
    } catch {
      setError('Gagal gabung')
    } finally {
      setLoading(false)
    }
  }

  function requestJoinRoom(room: Room) {
    if (room.hasPassword) {
      setPasswordTargetRoom(room)
      setPasswordInput('')
      setShowPasswordModal(true)
    } else {
      joinRoom(room.id, undefined)
    }
  }

  async function handleJoinByCode(e: Event) {
    e.preventDefault()
    setError('')
    if (!name().trim()) {
      setError('Masukkan nama kamu')
      return
    }
    if (!code().trim()) {
      setError('Masukkan kode room')
      return
    }

    setLoading(true)
    try {
      const res = await apiClient.rooms.code[':code'].$get({
        param: { code: code().trim().toUpperCase() },
      })
      if (!res.ok) {
        setError('Room tidak ditemukan')
        setLoading(false)
        return
      }
      const room = (await res.json()) as Room

      // Jika room butuh password, tampilkan modal dulu
      if (room.hasPassword) {
        setPasswordTargetRoom(room)
        setPasswordInput('')
        setShowPasswordModal(true)
        setLoading(false)
        return
      }

      await joinRoom(room.id, undefined)
    } catch {
      setError('Gagal cari room')
    } finally {
      setLoading(false)
    }
  }

  const [showPasswordModal, setShowPasswordModal] = createSignal(false)
  const [passwordTargetRoom, setPasswordTargetRoom] = createSignal<Room | null>(null)
  const [passwordInput, setPasswordInput] = createSignal('')

  function handlePasswordSubmit(e: Event) {
    e.preventDefault()
    const target = passwordTargetRoom()
    if (!target) return
    // Capture password before resetting state
    const enteredPassword = passwordInput().trim() || undefined
    setShowPasswordModal(false)
    setPasswordTargetRoom(null)
    setPasswordInput('')
    joinRoom(target.id, enteredPassword)
  }

  return (
    <div
      class="flex-1 flex flex-col px-4 pt-4"
      style="padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));"
    >
      <div class="max-w-sm mx-auto w-full flex-1 flex flex-col">
        <div class="text-center mb-6">
          <div class="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center mx-auto mb-3">
            <Search size={24} class="text-secondary" />
          </div>
          <h1 class="text-xl font-bold">Gabung Room</h1>
          <p class="text-sm text-base-content/50 mt-0.5">Cari room atau masukkan kode</p>
        </div>

        {/* Join by code */}
        <div class="bg-base-100 rounded-2xl shadow-sm border border-base-200 p-5 mb-5">
          <form onSubmit={handleJoinByCode} class="space-y-3">
            <div>
              <label
                class="text-xs font-semibold text-base-content/60 mb-1.5 block"
                for="join-name"
              >
                Nama Kamu
              </label>
              <input
                id="join-name"
                type="text"
                placeholder="Masukkan nama"
                class="input input-bordered w-full min-h-[44px] rounded-xl text-sm"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                maxLength={20}
              />
            </div>
            <div>
              <label
                class="text-xs font-semibold text-base-content/60 mb-1.5 block"
                for="join-code"
              >
                Kode Room
              </label>
              <input
                id="join-code"
                type="text"
                inputmode="text"
                autocapitalize="characters"
                autocomplete="off"
                placeholder="ABC123"
                class="input input-bordered w-full font-mono uppercase tracking-widest text-center text-lg min-h-[48px] rounded-xl"
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
                maxLength={6}
              />
            </div>
            {error() && <p class="text-error text-xs">{error()}</p>}
            <button
              type="submit"
              class="btn btn-secondary w-full min-h-[48px] text-sm font-bold shadow-md rounded-xl"
              disabled={loading()}
            >
              <Show
                when={loading()}
                fallback={
                  <>
                    <Hash size={16} /> Gabung Pakai Kode
                  </>
                }
              >
                <span class="loading loading-spinner loading-md" />
              </Show>
            </button>
          </form>
        </div>

        <div class="flex items-center gap-3 mb-4">
          <hr class="flex-1 border-base-300" />
          <span class="text-xs font-medium text-base-content/40">ATAU PILIH ROOM</span>
          <hr class="flex-1 border-base-300" />
        </div>

        {/* Live indicator */}
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-success pulse-dot" />
            <span class="text-xs font-medium text-base-content/50">Live</span>
          </div>
          <button
            class="btn btn-ghost btn-xs min-h-[32px] rounded-xl gap-1.5"
            onClick={() => {
              setPolling(true)
              fetchRooms(true)
            }}
          >
            <RefreshCw size={13} classList={{ 'animate-spin': polling() }} />
            <span class="text-xs">Refresh</span>
          </button>
        </div>

        <Show when={fetching()}>
          <SkeletonCardList count={4} />
        </Show>

        <Show when={!fetching() && rooms().length === 0}>
          <div class="flex-1 flex flex-col items-center justify-center text-center py-8">
            <div class="w-14 h-14 rounded-2xl bg-base-200 flex items-center justify-center mb-3">
              <Search size={24} class="text-base-content/30" />
            </div>
            <p class="text-sm font-medium text-base-content/50">Belum ada room aktif</p>
            <p class="text-xs text-base-content/40 mb-5">Buat room dan undang teman!</p>
            <button
              class="btn btn-primary min-h-[44px] shadow-md rounded-xl text-sm"
              onClick={() => navigate({ to: '/create-room' })}
            >
              <Plus size={16} /> Buat Room
            </button>
          </div>
        </Show>

        <Show when={!fetching() && rooms().length > 0}>
          <div class="space-y-2.5">
            {rooms().map((room) => {
              const isFull = room.players.length >= room.maxPlayers
              return (
                <div class="bg-base-100 rounded-2xl shadow-sm border border-base-200 p-4 flex items-center gap-3">
                  <div class="min-w-0 flex-1">
                    <h3 class="font-semibold text-sm truncate">{room.name}</h3>
                    <p class="text-xs text-base-content/50 mt-0.5">
                      {room.hostName} · {room.players.length}/{room.maxPlayers}
                      {room.hasPassword ? (
                        <span>
                          {' '}
                          · <Lock size={11} class="inline" />
                        </span>
                      ) : (
                        ''
                      )}
                    </p>
                  </div>
                  <button
                    class="btn btn-primary min-h-[40px] shrink-0 text-sm rounded-xl"
                    disabled={loading() || isFull}
                    onClick={() => requestJoinRoom(room)}
                  >
                    {isFull ? (
                      'Penuh'
                    ) : loading() ? (
                      <span class="loading loading-spinner loading-sm" />
                    ) : (
                      'Gabung'
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </Show>
      </div>

      {/* Password modal */}
      <dialog class={`modal ${showPasswordModal() ? 'modal-open' : ''}`}>
        <div class="modal-box p-6 rounded-2xl">
          <form onSubmit={handlePasswordSubmit}>
            <h3 class="text-lg font-bold mb-1">{passwordTargetRoom()?.name}</h3>
            <p class="text-sm text-base-content/50 mb-5">Room ini butuh password</p>
            <input
              type="password"
              class="input input-bordered w-full min-h-[48px] rounded-xl"
              placeholder="Masukkan password room"
              value={passwordInput()}
              onInput={(e) => setPasswordInput(e.currentTarget.value)}
              autofocus
            />
            <div class="modal-action flex flex-col gap-2 mt-6">
              <button
                type="submit"
                class="btn btn-primary w-full min-h-[48px] rounded-xl shadow-md"
              >
                Gabung
              </button>
              <button
                type="button"
                class="btn btn-ghost w-full min-h-[48px] rounded-xl"
                onClick={() => {
                  setShowPasswordModal(false)
                  setPasswordTargetRoom(null)
                  setPasswordInput('')
                }}
              >
                Batal
              </button>
            </div>
          </form>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button
            onClick={() => {
              setShowPasswordModal(false)
              setPasswordTargetRoom(null)
              setPasswordInput('')
            }}
          >
            close
          </button>
        </form>
      </dialog>
    </div>
  )
}
