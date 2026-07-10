import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { createSignal, onMount, Show } from 'solid-js'
import { getStoredUsername } from '../lib/username'
import { isValidPassword } from '../lib/password'
import { apiClient, type CreateRoomResponse } from '../api/client'
import { Plus, Sparkles, Shield, Lock } from 'lucide-solid'

export const Route = createFileRoute('/create-room')({ component: CreateRoom })

function CreateRoom() {
  const navigate = useNavigate()
  const [name, setName] = createSignal('')
  const [roomName, setRoomName] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [showOverlay, setShowOverlay] = createSignal(false)

  onMount(() => {
    const stored = getStoredUsername()
    if (stored) setName(stored)
  })

  async function handleCreate(e: Event) {
    e.preventDefault()
    setError('')
    if (!name().trim()) { setError('Masukkan nama kamu'); return }
    if (!roomName().trim()) { setError('Masukkan nama room'); return }

    setLoading(true)
    try {
      const res = await apiClient.rooms.$post({
        json: {
          name: roomName().trim(),
          hostName: name().trim(),
          password: password().trim() || undefined,
        },
      })

      if (!res.ok) {
        const errBody = await res.json() as Record<string, unknown>
        setError(typeof errBody.error === 'string' ? errBody.error : 'Gagal buat room')
        setLoading(false)
        return
      }

      const room = await res.json() as CreateRoomResponse
      setShowOverlay(true)
      setTimeout(() => navigate({ to: `/room/${room.id}` }), 600)
    } catch {
      setError('Gagal buat room')
      setLoading(false)
    }
  }

  return (
    <div class="flex-1 flex flex-col px-4 pt-4" style="padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));">
      <Show when={showOverlay()}>
        <div class="fixed inset-0 z-50 bg-base-200/80 backdrop-blur-sm flex items-center justify-center phase-fade-in">
          <div class="text-center">
            <Sparkles size={40} class="mx-auto mb-3 text-primary animate-pulse" />
            <p class="font-bold text-base">Menyiapkan room...</p>
          </div>
        </div>
      </Show>

      <div class="max-w-sm mx-auto w-full flex-1 flex flex-col">
        <div class="text-center mb-6">
          <div class="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Plus size={24} class="text-primary" />
          </div>
          <h1 class="text-xl font-bold">Buat Room</h1>
          <p class="text-sm text-base-content/50 mt-0.5">Buat game untuk kamu dan teman</p>
        </div>

        <div class="bg-base-100 rounded-2xl shadow-sm border border-base-200 p-5">
          <form onSubmit={handleCreate} class="space-y-4">
            <div>
              <label class="text-xs font-semibold text-base-content/60 mb-1.5 block" for="create-name">Nama Kamu</label>
              <input
                id="create-name"
                type="text"
                placeholder="Masukkan nama"
                class="input input-bordered w-full min-h-[48px] rounded-xl"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                maxLength={20}
              />
            </div>

            <div>
              <label class="text-xs font-semibold text-base-content/60 mb-1.5 block" for="create-room-name">Nama Room</label>
              <input
                id="create-room-name"
                type="text"
                placeholder="Misal: Party Seru"
                class="input input-bordered w-full min-h-[48px] rounded-xl"
                value={roomName()}
                onInput={(e) => setRoomName(e.currentTarget.value)}
                maxLength={30}
              />
            </div>

            <div>
              <label class="text-xs font-semibold text-base-content/60 mb-1.5 flex items-center gap-1.5" for="create-password">
                <Lock size={12} /> Password <span class="font-normal text-base-content/40">(opsional)</span>
              </label>
              <input
                id="create-password"
                type="password"
                autocomplete="new-password"
                placeholder="Kosongi untuk room publik"
                class="input input-bordered w-full min-h-[48px] rounded-xl"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                maxLength={72}
                minLength={8}
              />
              {password().length > 0 && !isValidPassword(password()) && (
                <p class="text-error text-xs mt-1.5">Password minimal 8 karakter</p>
              )}
            </div>

            {error() && (
              <div class="flex items-center gap-2 text-error text-sm bg-error/5 rounded-xl px-4 py-3">
                <Shield size={16} class="shrink-0" />
                <span>{error()}</span>
              </div>
            )}

            <button type="submit" class="btn btn-primary w-full min-h-[50px] text-base font-bold shadow-md rounded-xl mt-2" disabled={loading()}>
              <Show when={loading()} fallback={<>Buat Room</>}>
                <span class="loading loading-spinner loading-md" />
              </Show>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
