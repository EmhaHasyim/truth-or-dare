import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { createSignal, Show, Switch, Match, createMemo } from 'solid-js'
import { Transition } from 'solid-transition-group'
import { getStoredUsername, setStoredUsername } from '../lib/username'
import { Sparkles, Plus, Gamepad2, ArrowRight, LogIn } from 'lucide-solid'
import { showToast } from '../lib/toast'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const navigate = useNavigate()
  const [username, setUsername] = createSignal(getStoredUsername() || '')
  const [nameInput, setNameInput] = createSignal('')
  const [showNameForm, setShowNameForm] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [touched, setTouched] = createSignal(false)

  const nameTrimmed = () => nameInput().trim()
  const nameValid = createMemo(() => {
    const val = nameTrimmed()
    if (!val) return { valid: false, reason: '' }
    if (val.length > 20) return { valid: false, reason: 'Maksimal 20 karakter' }
    if (/[<>{}\]\]/.test(val)) return { valid: false, reason: 'Karakter spesial tidak diizinkan' }
    return { valid: true, reason: '' }
  })

  function handleSaveName(e: Event) {
    e.preventDefault()
    if (!nameValid().valid || saving()) return
    setSaving(true)
    setTimeout(() => {
      const trimmed = nameTrimmed()
      setStoredUsername(trimmed)
      setUsername(trimmed)
      setShowNameForm(false)
      setSaving(false)
      setTouched(false)
      showToast(`Halo, ${trimmed}!`, 'success')
    }, 300)
  }

  const showActions = () => !!username()

  return (
    <div class="flex-1 flex flex-col px-4 pt-4" style="padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));">
      <div class="flex-1 flex flex-col max-w-sm mx-auto w-full">
        {/* Hero */}
        <div class="text-center mb-8">
          <div class="flex justify-center mb-4">
            <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles size={32} class="text-primary" />
            </div>
          </div>
          <h1 class="text-3xl font-black tracking-tight gradient-text mb-1">
            Truth or Dare
          </h1>
          <p class="text-sm text-base-content/50">
            {showActions() ? 'Mau main lagi?' : 'Game seru — sekarang online!'}
          </p>
        </div>

        <Transition name="view-transition" mode="outin">
          <Switch>
            <Match when={!showActions() || showNameForm()}>
              <div class="flex-1 flex flex-col justify-center">
                <form onSubmit={handleSaveName} class="space-y-4">
                  <div>
                    <input
                      type="text"
                      placeholder="Masukkan nama kamu"
                      class="input input-bordered w-full text-center text-lg min-h-[52px] rounded-2xl transition-shadow duration-200"
                      classList={{
                        'input-error': touched() && !nameValid().valid && nameTrimmed().length > 0,
                      }}
                      value={nameInput()}
                      onInput={(e) => { setNameInput(e.currentTarget.value); setTouched(true) }}
                      onBlur={() => setTouched(true)}
                      maxLength={20}
                      autofocus
                    />
                    <Show when={touched() && !nameValid().valid && nameTrimmed().length > 0}>
                      <p class="text-error text-xs text-center mt-2">{nameValid().reason}</p>
                    </Show>
                  </div>
                  <button
                    type="submit"
                    class="btn btn-primary w-full min-h-[52px] text-base font-bold shadow-md rounded-2xl"
                    disabled={!nameValid().valid || saving()}
                  >
                    <Show when={saving()} fallback={<><Gamepad2 size={20} /> Mulai Main!</>}>
                      <span class="loading loading-spinner loading-md" />
                    </Show>
                  </button>
                </form>
              </div>
            </Match>
            <Match when={showActions() && !showNameForm()}>
              <div class="space-y-3">
                <p class="text-center text-sm text-base-content/50 mb-2">
                  Masuk sebagai <span class="font-semibold text-base-content">{username()}</span>
                </p>

                <button
                  class="card bg-base-100 shadow-sm border border-base-200 rounded-2xl card-hover cursor-pointer w-full text-left"
                  onClick={() => navigate({ to: '/create-room' })}
                >
                  <div class="card-body p-5 flex-row items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Plus size={24} class="text-primary" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <h2 class="font-bold text-base">Buat Room</h2>
                      <p class="text-sm text-base-content/50">Buat game dan undang teman</p>
                    </div>
                    <ArrowRight size={18} class="text-base-content/30 shrink-0" />
                  </div>
                </button>

                <button
                  class="card bg-base-100 shadow-sm border border-base-200 rounded-2xl card-hover cursor-pointer w-full text-left"
                  onClick={() => navigate({ to: '/join-room' })}
                >
                  <div class="card-body p-5 flex-row items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-secondary/10 flex items-center justify-center shrink-0">
                      <LogIn size={24} class="text-secondary" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <h2 class="font-bold text-base">Gabung Room</h2>
                      <p class="text-sm text-base-content/50">Masuk pakai kode room</p>
                    </div>
                    <ArrowRight size={18} class="text-base-content/30 shrink-0" />
                  </div>
                </button>

                <button
                  class="btn btn-ghost w-full text-sm text-base-content/40 mt-2 min-h-[44px] rounded-xl"
                  onClick={() => { setNameInput(''); setShowNameForm(true); setTouched(false) }}
                >
                  Bukan {username()}?
                </button>
              </div>
            </Match>
          </Switch>
        </Transition>
      </div>
    </div>
  )
}
