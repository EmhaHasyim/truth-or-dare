import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'

vi.mock('@tanstack/solid-router', () => ({
  createFileRoute: vi.fn(() => {
    const route = (options: any) => options
    route.component = null
    return route
  }),
  useNavigate: vi.fn(() => vi.fn()),
  useParams: vi.fn(() => ({})),
  useMatch: vi.fn(() => null),
  Outlet: () => null,
  Link: (props: any) => props.children,
}))

const { getStoredUsername, setStoredUsername } = vi.hoisted(() => ({
  getStoredUsername: vi.fn(() => ''),
  setStoredUsername: vi.fn(),
}))

vi.mock('../../lib/username', () => ({
  getStoredUsername,
  setStoredUsername,
  clearStoredUsername: vi.fn(),
}))

const { showToast } = vi.hoisted(() => ({
  showToast: vi.fn(),
}))

vi.mock('../../lib/toast', () => ({
  showToast,
  mountToastContainer: vi.fn(),
}))

vi.mock('lucide-solid', () => ({
  Sparkles: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-sparkles')
    return el
  },
  Plus: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-plus')
    return el
  },
  Gamepad2: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-gamepad')
    return el
  },
  ArrowRight: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-arrow')
    return el
  },
  LogIn: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-login')
    return el
  },
}))

vi.mock('solid-transition-group', () => ({
  default: (props: any) => props.children,
  Transition: (props: any) => props.children,
}))

async function renderHome() {
  const mod = await import('../index')
  const Component = (mod.Route as any).component
  return render(() => <Component />)
}

describe('Home page (index.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    getStoredUsername.mockReturnValue('')
  })

  afterEach(() => {
    cleanup()
  })

  it('should render the title and subtitle', async () => {
    const { container } = await renderHome()
    expect(container.querySelector('h1')?.textContent).toContain('Truth or Dare')
  })

  it('should show name input form when no username stored', async () => {
    const { container } = await renderHome()
    expect(container.querySelector('input[type="text"]')).toBeTruthy()
  })

  it('should show validation error for special characters in name', async () => {
    const { container } = await renderHome()
    const input = container.querySelector('input[type="text"]') as HTMLInputElement

    fireEvent.input(input, { target: { value: 'Bad<Name>' } })
    // Need a blur to trigger touched state
    fireEvent.blur(input)

    await waitFor(() => {
      expect(container.textContent).toContain('Karakter spesial tidak diizinkan')
    })
  })

  it('should show validation error for name longer than 20 chars', async () => {
    const { container } = await renderHome()
    const input = container.querySelector('input[type="text"]') as HTMLInputElement

    fireEvent.input(input, { target: { value: 'A'.repeat(25) } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(container.textContent).toContain('Maksimal 20 karakter')
    })
  })

  it('should save username and show action buttons on valid submit', async () => {
    vi.useFakeTimers()
    const { container } = await renderHome()
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(input, { target: { value: 'Alice' } })
    fireEvent.submit(form)

    await vi.advanceTimersByTimeAsync(300)

    expect(setStoredUsername).toHaveBeenCalledWith('Alice')
    expect(showToast).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('should show create and join buttons when username is stored', async () => {
    getStoredUsername.mockReturnValue('Alice')
    const { container } = await renderHome()

    await waitFor(() => {
      expect(container.textContent).toContain('Buat Room')
      expect(container.textContent).toContain('Gabung Room')
    })
  })

  it('should show "not you?" button when username exists', async () => {
    getStoredUsername.mockReturnValue('Alice')
    const { container } = await renderHome()

    await waitFor(() => {
      expect(container.textContent).toContain('Bukan Alice?')
    })
  })

  it('should not save an invalid name on submit', async () => {
    const { container } = await renderHome()
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(input, { target: { value: 'Bad<Name>' } })
    fireEvent.submit(form)

    expect(setStoredUsername).not.toHaveBeenCalled()
  })
})
