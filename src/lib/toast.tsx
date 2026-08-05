import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  message: string
  type: ToastType
}

let nextId = 0
const [toasts, setToasts] = createSignal<Toast[]>([])

export function showToast(message: string, type: ToastType = 'info', duration = 3000) {
  const id = ++nextId
  setToasts((prev) => [...prev, { id, message, type }])
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, duration)
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-success/10 text-success border-success/20',
  error: 'bg-error/10 text-error border-error/20',
  info: 'bg-info/10 text-info border-info/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
}

const typeIcons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
}

function ToastContainer() {
  return (
    <div
      class="fixed z-[9999] flex flex-col gap-2 pointer-events-none max-w-xs w-full px-4"
      style="bottom: max(1.25rem, env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%);"
    >
      {toasts().map((toast) => (
        <div
          class={`border rounded-2xl px-4 py-3 pointer-events-auto animate-slide-up-toast flex items-center gap-2.5 shadow-lg ${typeStyles[toast.type]}`}
        >
          <span class="text-base font-bold shrink-0">{typeIcons[toast.type]}</span>
          <span class="text-sm font-medium">{toast.message}</span>
        </div>
      ))}
    </div>
  )
}

export function mountToastContainer() {
  if (document.getElementById('toast-container')) return
  const container = document.createElement('div')
  container.id = 'toast-container'
  document.body.appendChild(container)
  const dispose = render(() => <ToastContainer />, container)
  return () => {
    dispose()
    container.remove()
  }
}
