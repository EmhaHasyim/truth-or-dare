import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'

// Mock the router hooks FIRST
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

const { setStoredUsername, getStoredUsername } = vi.hoisted(() => ({
  setStoredUsername: vi.fn(),
  getStoredUsername: vi.fn(() => ''),
}))

vi.mock('../../lib/username', () => ({
  getStoredUsername,
  setStoredUsername,
  clearStoredUsername: vi.fn(),
}))

const { storePlayerSession } = vi.hoisted(() => ({
  storePlayerSession: vi.fn(),
}))

vi.mock('../../lib/player-session', () => ({
  storePlayerSession,
}))

const { isValidPassword } = vi.hoisted(() => ({
  isValidPassword: vi.fn((pw: string) => pw.length >= 8),
}))

vi.mock('../../lib/password', () => ({
  isValidPassword,
}))

const { mockPost } = vi.hoisted(() => ({
  mockPost: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  apiClient: {
    rooms: {
      $post: mockPost,
    },
  },
}))

vi.mock('../../lib/toast', () => ({
  showToast: vi.fn(),
  mountToastContainer: vi.fn(),
}))

vi.mock('lucide-solid', () => ({
  Plus: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-plus')
    return el
  },
  Sparkles: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-sparkles')
    return el
  },
  Shield: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-shield')
    return el
  },
  Lock: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-lock')
    return el
  },
}))

async function renderCreateRoom() {
  const mod = await import('../create-room')
  const Component = (mod.Route as any).component
  return render(() => <Component />)
}

describe('CreateRoom component', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    getStoredUsername.mockReturnValue('')
  })

  afterEach(() => {
    cleanup()
  })

  it('should render the create room page with form fields', async () => {
    const { container } = await renderCreateRoom()

    expect(container.querySelector('#create-name')).toBeTruthy()
    expect(container.querySelector('#create-room-name')).toBeTruthy()
    expect(container.querySelector('#create-password')).toBeTruthy()
    expect(container.querySelector('h1')?.textContent).toContain('Buat Room')
  })

  it('should show error when submitting empty name', async () => {
    const { container } = await renderCreateRoom()
    const form = container.querySelector('form')!

    fireEvent.submit(form)

    expect(container.textContent).toContain('Masukkan nama kamu')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('should show error when submitting name but empty room name', async () => {
    const { container } = await renderCreateRoom()
    const nameInput = container.querySelector('#create-name') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Alice' } })
    fireEvent.submit(form)

    expect(container.textContent).toContain('Masukkan nama room')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('should show password validation hint for short password', async () => {
    isValidPassword.mockReturnValue(false)
    const { container } = await renderCreateRoom()
    const pwInput = container.querySelector('#create-password') as HTMLInputElement

    fireEvent.input(pwInput, { target: { value: 'short' } })

    expect(container.textContent).toContain('Password minimal 8 karakter')
    isValidPassword.mockReturnValue(true)
  })

  it('should prefill name from stored username on mount', async () => {
    getStoredUsername.mockReturnValue('StoredAlice')
    const { container } = await renderCreateRoom()

    await waitFor(() => {
      expect((container.querySelector('#create-name') as HTMLInputElement).value).toBe(
        'StoredAlice',
      )
    })
  })

  it('should submit form and create room successfully', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'room-123',
        code: 'ABC123',
        name: 'Test Room',
        hostName: 'Alice',
        players: [{ id: 'p1', name: 'Alice', isHost: true }],
      }),
    })

    const { container } = await renderCreateRoom()
    const nameInput = container.querySelector('#create-name') as HTMLInputElement
    const roomInput = container.querySelector('#create-room-name') as HTMLInputElement
    const pwInput = container.querySelector('#create-password') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Alice' } })
    fireEvent.input(roomInput, { target: { value: 'Party Seru' } })
    fireEvent.input(pwInput, { target: { value: 'secret123' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith({
        json: {
          name: 'Party Seru',
          hostName: 'Alice',
          password: 'secret123',
        },
      })
    })
    await waitFor(() => {
      expect(setStoredUsername).toHaveBeenCalledWith('Alice')
    })
    expect(storePlayerSession).toHaveBeenCalledWith('room-123', {
      playerId: 'p1',
      playerName: 'Alice',
    })
  })

  it('should show error when create room API fails', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Kode room bentrok' }),
    })

    const { container } = await renderCreateRoom()
    const nameInput = container.querySelector('#create-name') as HTMLInputElement
    const roomInput = container.querySelector('#create-room-name') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Alice' } })
    fireEvent.input(roomInput, { target: { value: 'Party' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.textContent).toContain('Kode room bentrok')
    })
  })

  it('should show generic error when API throws', async () => {
    mockPost.mockRejectedValue(new Error('network down'))

    const { container } = await renderCreateRoom()
    const nameInput = container.querySelector('#create-name') as HTMLInputElement
    const roomInput = container.querySelector('#create-room-name') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Alice' } })
    fireEvent.input(roomInput, { target: { value: 'Party' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.textContent).toContain('Gagal buat room')
    })
  })

  it('should fall back to generic message when API error body is not a string', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 12345 }),
    })

    const { container } = await renderCreateRoom()
    const nameInput = container.querySelector('#create-name') as HTMLInputElement
    const roomInput = container.querySelector('#create-room-name') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Alice' } })
    fireEvent.input(roomInput, { target: { value: 'Party' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.textContent).toContain('Gagal buat room')
    })
  })

  it('should omit password when empty', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'room-123',
        code: 'ABC123',
        name: 'Test',
        hostName: 'Alice',
        players: [{ id: 'p1', name: 'Alice', isHost: true }],
      }),
    })

    const { container } = await renderCreateRoom()
    const nameInput = container.querySelector('#create-name') as HTMLInputElement
    const roomInput = container.querySelector('#create-room-name') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Alice' } })
    fireEvent.input(roomInput, { target: { value: 'Party' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith({
        json: { name: 'Party', hostName: 'Alice', password: undefined },
      })
    })
  })
})
