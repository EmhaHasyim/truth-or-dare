import {
  Outlet,
  createRootRouteWithContext,
  Link,
  useNavigate,
} from '@tanstack/solid-router'
import { Suspense, createSignal, createEffect, onCleanup, onMount, Show, ErrorBoundary } from 'solid-js'
import { Transition } from 'solid-transition-group'
import { getStoredUsername, setStoredUsername, clearStoredUsername } from '../lib/username'
import { showToast } from '../lib/toast'
import { Sparkles, Sun, Moon, LogOut, Edit3 } from 'lucide-solid'
import { themeChange } from 'theme-change'

// ── 404 Page ──
function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div class="min-h-dvh flex items-center justify-center px-4">
      <div class="max-w-sm w-full text-center phase-fade-in">
        <div class="text-6xl mb-5 opacity-60">🤔</div>
        <h1 class="text-2xl font-black mb-2">Halaman Tidak Ditemukan</h1>
        <p class="text-base-content/60 text-sm mb-8">
          Halaman ini tidak ada. Yuk balik ke beranda.
        </p>
        <button class="btn btn-primary min-h-[48px] w-full shadow-md" onClick={() => navigate({ to: '/' })}>
          Kembali ke Beranda
        </button>
      </div>
    </div>
  )
}

// ── Username Modal ──
function UsernameModal(props: { show: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = createSignal('')
  let inputRef: HTMLInputElement | undefined

  createEffect(() => {
    if (props.show && inputRef) {
      setTimeout(() => inputRef?.focus(), 100)
    }
  })

  function handleSave(e: Event) {
    e.preventDefault()
    const trimmed = name().trim()
    if (!trimmed || trimmed.length < 1) return
    setStoredUsername(trimmed)
    setName(trimmed)
    showToast('Nama berhasil diubah!', 'success')
    props.onSave(trimmed)
    props.onClose()
  }

  return (
    <dialog class={`modal ${props.show ? 'modal-open' : ''}`}>
      <div class="modal-box p-6 rounded-2xl">
        <form onSubmit={handleSave}>
          <h3 class="text-lg font-bold mb-1">Ganti Nama</h3>
          <p class="text-sm text-base-content/50 mb-5">Panggilan kamu selama main</p>
          <input
            ref={inputRef}
            type="text"
            class="input input-bordered w-full min-h-[48px] rounded-xl"
            placeholder="Masukkan nama kamu"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            maxLength={20}
          />
          <div class="modal-action flex flex-col gap-2 mt-6">
            <button type="submit" class="btn btn-primary min-h-[48px] w-full rounded-xl shadow-md">Simpan</button>
            <button type="button" class="btn btn-ghost min-h-[48px] w-full rounded-xl" onClick={props.onClose}>Batal</button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button onClick={props.onClose}>close</button>
      </form>
    </dialog>
  )
}

// ── Error Fallback ──
function RootErrorFallback() {
  const navigate = useNavigate()
  return (
    <div class="min-h-dvh flex items-center justify-center px-4">
      <div class="card bg-base-100 shadow-xl max-w-sm w-full rounded-2xl">
        <div class="card-body items-center text-center p-6">
          <h2 class="card-title text-xl mb-2">Terjadi Kesalahan</h2>
          <p class="text-base-content/60 text-sm mb-5">Error tidak terduga. Coba lagi ya.</p>
          <button class="btn btn-primary min-h-[48px] w-full shadow-md rounded-xl" onClick={() => navigate({ to: '/' })}>
            Kembali ke Beranda
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Theme Toggle ──
function ThemeToggle() {
  const [isDark, setIsDark] = createSignal(false)

  onMount(() => {
    const current = document.documentElement.getAttribute('data-theme')
    setIsDark(current === 'dark' || current === 'forest')
  })

  function toggleTheme() {
    const newTheme = isDark() ? 'cupcake' : 'dark'
    document.documentElement.setAttribute('data-theme', newTheme)
    try { localStorage.setItem('theme', newTheme) } catch {}
    setIsDark(!isDark())
  }

  return (
    <button onClick={toggleTheme} class="btn btn-ghost btn-sm btn-square min-h-[40px] min-w-[40px]" aria-label="Toggle theme">
      <Sun size={18} classList={{ 'hidden': isDark(), 'block': !isDark() }} />
      <Moon size={18} classList={{ 'block': isDark(), 'hidden': !isDark() }} />
    </button>
  )
}

// ── Root Component ──
function RootComponent() {
  const navigate = useNavigate()
  const [username, setUsername] = createSignal(getStoredUsername() || '')
  const [showModal, setShowModal] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)

  onMount(() => {
    try { themeChange(false) } catch {}
  })

  function handleLogout() {
    setUsername('')
    clearStoredUsername()
    showToast('Berhasil logout', 'info')
    navigate({ to: '/' })
  }

  // Click outside to close mobile menu
  onMount(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (menuOpen() && !target.closest('.mobile-menu') && !target.closest('.menu-trigger')) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', handler)
    onCleanup(() => document.removeEventListener('click', handler))
  })

  return (
    <ErrorBoundary fallback={<RootErrorFallback />}>
      <div class="min-h-dvh flex flex-col bg-base-200">
        {/* Simple header - safe area top */}
        <header class="flex items-center justify-between px-4 h-14 shrink-0" style="padding-top: max(0px, env(safe-area-inset-top, 0px))">
          <Link to="/" class="flex items-center gap-2 font-bold text-base">
            <Sparkles size={20} class="text-primary" />
            <span class="gradient-text hidden sm:inline">Truth or Dare</span>
            <span class="gradient-text sm:hidden">ToD</span>
          </Link>

          <div class="flex items-center gap-1">
            <ThemeToggle />

            <Show when={username()}>
              <div class="relative">
                <button
                  class="menu-trigger btn btn-ghost btn-sm min-h-[40px] rounded-xl flex items-center gap-2 px-2"
                  onClick={() => setMenuOpen(!menuOpen())}
                >
                  <div class="w-7 h-7 rounded-full bg-primary text-primary-content flex items-center justify-center text-xs font-bold">
                    {username()[0].toUpperCase()}
                  </div>
                  <span class="text-sm font-medium hidden sm:inline max-w-[80px] truncate">{username()}</span>
                </button>

                <Show when={menuOpen()}>
                  <div class="mobile-menu absolute right-0 top-full mt-2 w-56 bg-base-100 rounded-2xl shadow-xl border border-base-200 p-2 z-50 phase-fade-in">
                    <div class="flex items-center gap-3 px-3 py-2.5 mb-1">
                      <div class="w-9 h-9 rounded-full bg-primary text-primary-content flex items-center justify-center text-sm font-bold shrink-0">
                        {username()[0].toUpperCase()}
                      </div>
                      <div class="min-w-0">
                        <p class="font-semibold text-sm truncate">{username()}</p>
                        <p class="text-xs text-base-content/50">Pemain</p>
                      </div>
                    </div>
                    <hr class="border-base-200 my-1" />
                    <button
                      class="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-base-200 transition-colors text-sm"
                      onClick={() => { setMenuOpen(false); setShowModal(true) }}
                    >
                      <Edit3 size={16} class="text-base-content/60" /> Ganti Nama
                    </button>
                    <button
                      class="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-base-200 transition-colors text-sm text-error"
                      onClick={() => { setMenuOpen(false); handleLogout() }}
                    >
                      <LogOut size={16} /> Logout
                    </button>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </header>

        <main class="flex-1 flex flex-col">
          <Suspense>
            <Transition name="page" mode="outin">
              <Outlet />
            </Transition>
          </Suspense>
        </main>
      </div>

      <UsernameModal show={showModal()} onClose={() => setShowModal(false)} onSave={(n) => setUsername(n)} />
    </ErrorBoundary>
  )
}

export const Route = createRootRouteWithContext()({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
})
