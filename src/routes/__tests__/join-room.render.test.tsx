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
  getStoredUsername: vi.fn(() => 'Bob'),
  setStoredUsername: vi.fn(),
}))

vi.mock('../../lib/username', () => ({
  getStoredUsername,
  setStoredUsername,
  clearStoredUsername: vi.fn(),
}))

vi.mock('../../lib/player-session', () => ({
  storePlayerSession: vi.fn(),
}))

const { showToast } = vi.hoisted(() => ({
  showToast: vi.fn(),
}))

vi.mock('../../lib/toast', () => ({
  showToast,
  mountToastContainer: vi.fn(),
}))

const { mockGetRooms, mockJoin, mockGetByCode } = vi.hoisted(() => ({
  mockGetRooms: vi.fn(),
  mockJoin: vi.fn(),
  mockGetByCode: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  apiClient: {
    rooms: {
      $get: mockGetRooms,
      ':id': {
        join: { $post: mockJoin },
      },
      code: {
        ':code': { $get: mockGetByCode },
      },
    },
  },
}))

vi.mock('lucide-solid', () => ({
  Search: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-search')
    return el
  },
  Lock: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-lock')
    return el
  },
  Plus: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-plus')
    return el
  },
  RefreshCw: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-refresh')
    return el
  },
  Hash: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-hash')
    return el
  },
}))

vi.mock('../../components/skeleton', () => ({
  SkeletonCardList: () => {
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'skeleton')
    return el
  },
}))

function makeRoom(overrides: any = {}) {
  return {
    id: 'room-1',
    code: 'ABC123',
    name: 'Party Seru',
    hostName: 'Alice',
    maxPlayers: 2,
    players: [{ id: 'p1', name: 'Alice', isHost: true }],
    hasPassword: false,
    status: 'waiting' as const,
    createdAt: Date.now(),
    ...overrides,
  }
}

async function renderJoinRoom() {
  const mod = await import('../join-room')
  const Component = (mod.Route as any).component
  return render(() => <Component />)
}

describe('JoinRoom page', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    getStoredUsername.mockReturnValue('Bob')
    mockGetRooms.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue([]) })
  })

  afterEach(() => {
    cleanup()
  })

  it('should render the join room page with title', async () => {
    const { container } = await renderJoinRoom()
    expect(container.querySelector('h1')?.textContent).toContain('Gabung Room')
  })

  it('should prefill name from stored username', async () => {
    const { container } = await renderJoinRoom()
    await waitFor(() => {
      expect((container.querySelector('#join-name') as HTMLInputElement).value).toBe('Bob')
    })
  })

  it('should fetch and display active rooms on mount', async () => {
    mockGetRooms.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([makeRoom()]),
    })
    const { container } = await renderJoinRoom()

    await waitFor(() => {
      expect(container.textContent).toContain('Party Seru')
      expect(container.textContent).toContain('Alice · 1/2')
    })
  })

  it('should show empty state when no rooms', async () => {
    const { container } = await renderJoinRoom()

    await waitFor(() => {
      expect(container.textContent).toContain('Belum ada room aktif')
    })
  })

  it('should show error when submitting join with empty name', async () => {
    getStoredUsername.mockReturnValue('')
    const { container } = await renderJoinRoom()
    const form = container.querySelector('form')!

    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.textContent).toContain('Masukkan nama kamu')
    })
  })

  it('should show error when submitting join with empty code', async () => {
    const { container } = await renderJoinRoom()
    const nameInput = container.querySelector('#join-name') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Bob' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.textContent).toContain('Masukkan kode room')
    })
  })

  it('should join a room by code successfully', async () => {
    mockGetByCode.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeRoom()),
    })
    mockJoin.mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue(
          makeRoom({ players: [makeRoom().players[0], { id: 'p2', name: 'Bob', isHost: false }] }),
        ),
    })

    const { container } = await renderJoinRoom()
    const nameInput = container.querySelector('#join-name') as HTMLInputElement
    const codeInput = container.querySelector('#join-code') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Bob' } })
    fireEvent.input(codeInput, { target: { value: 'abc123' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockGetByCode).toHaveBeenCalledWith({ param: { code: 'ABC123' } })
      expect(mockJoin).toHaveBeenCalledWith({
        param: { id: 'room-1' },
        json: { playerName: 'Bob', password: undefined },
      })
    })
    expect(setStoredUsername).toHaveBeenCalledWith('Bob')
    expect(showToast).toHaveBeenCalled()
  })

  it('should show room not found when code is invalid', async () => {
    mockGetByCode.mockResolvedValue({ ok: false, json: vi.fn() })

    const { container } = await renderJoinRoom()
    const nameInput = container.querySelector('#join-name') as HTMLInputElement
    const codeInput = container.querySelector('#join-code') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Bob' } })
    fireEvent.input(codeInput, { target: { value: 'ZZZZZZ' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.textContent).toContain('Room tidak ditemukan')
    })
  })

  it('should show password modal when joining a protected room', async () => {
    mockGetRooms.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([makeRoom({ hasPassword: true, name: 'Secret Room' })]),
    })
    const { container } = await renderJoinRoom()

    await waitFor(() => {
      expect(container.textContent).toContain('Secret Room')
    })

    const joinButtons = container.querySelectorAll('button')
    const joinBtn = Array.from(joinButtons).find((b) => b.textContent?.trim() === 'Gabung')
    expect(joinBtn).toBeTruthy()
    fireEvent.click(joinBtn!)

    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
      expect(container.textContent).toContain('Room ini butuh password')
    })
  })

  it('should join with password from the modal', async () => {
    mockGetRooms.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([makeRoom({ hasPassword: true })]),
    })
    mockJoin.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeRoom()),
    })

    const { container } = await renderJoinRoom()

    await waitFor(() => {
      expect(container.textContent).toContain('Party Seru')
    })

    const joinButtons = container.querySelectorAll('button')
    const joinBtn = Array.from(joinButtons).find((b) => b.textContent?.trim() === 'Gabung')
    expect(joinBtn).toBeTruthy()
    fireEvent.click(joinBtn!)

    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
    })

    const pwInput = container.querySelector('dialog input[type="password"]') as HTMLInputElement
    fireEvent.input(pwInput, { target: { value: 'secret123' } })
    const modalForm = container.querySelector('dialog form')!
    fireEvent.submit(modalForm)

    await waitFor(() => {
      expect(mockJoin).toHaveBeenCalledWith({
        param: { id: 'room-1' },
        json: { playerName: 'Bob', password: 'secret123' },
      })
    })
  })

  it('should show error when joining fails', async () => {
    mockGetRooms.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([makeRoom()]),
    })
    mockJoin.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Room penuh' }),
    })

    const { container } = await renderJoinRoom()

    await waitFor(() => {
      expect(container.textContent).toContain('Party Seru')
    })

    const joinButtons = container.querySelectorAll('button')
    const joinBtn = Array.from(joinButtons).find((b) => b.textContent?.trim() === 'Gabung')
    expect(joinBtn).toBeTruthy()
    fireEvent.click(joinBtn!)

    await waitFor(() => {
      expect(container.textContent).toContain('Room penuh')
    })
  })

  it('should show generic error when the join request throws', async () => {
    mockGetRooms.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([makeRoom()]),
    })
    mockJoin.mockRejectedValue(new Error('network down'))

    const { container } = await renderJoinRoom()

    await waitFor(() => {
      expect(container.textContent).toContain('Party Seru')
    })

    const joinButtons = container.querySelectorAll('button')
    const joinBtn = Array.from(joinButtons).find((b) => b.textContent?.trim() === 'Gabung')
    fireEvent.click(joinBtn!)

    await waitFor(() => {
      expect(container.textContent).toContain('Gagal gabung')
    })
  })

  it('should open password modal when joining a protected room by code', async () => {
    mockGetByCode.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeRoom({ hasPassword: true })),
    })

    const { container } = await renderJoinRoom()
    const nameInput = container.querySelector('#join-name') as HTMLInputElement
    const codeInput = container.querySelector('#join-code') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Bob' } })
    fireEvent.input(codeInput, { target: { value: 'ABC123' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
      expect(container.textContent).toContain('Room ini butuh password')
    })
  })

  it('should show error when the code lookup throws', async () => {
    mockGetByCode.mockRejectedValue(new Error('network down'))

    const { container } = await renderJoinRoom()
    const nameInput = container.querySelector('#join-name') as HTMLInputElement
    const codeInput = container.querySelector('#join-code') as HTMLInputElement
    const form = container.querySelector('form')!

    fireEvent.input(nameInput, { target: { value: 'Bob' } })
    fireEvent.input(codeInput, { target: { value: 'ABC123' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(container.textContent).toContain('Gagal cari room')
    })
  })

  it('should silently ignore errors during background polling', async () => {
    mockGetRooms.mockRejectedValue(new Error('boom'))
    vi.useFakeTimers()

    const { container } = await renderJoinRoom()
    await Promise.resolve()
    await Promise.resolve()

    // Polling interval fires at 7000ms — must not crash or show an error
    vi.advanceTimersByTime(7000)
    await Promise.resolve()

    expect(mockGetRooms).toHaveBeenCalled()
    expect(container.textContent).not.toContain('Gagal')
    vi.useRealTimers()
  })
})
