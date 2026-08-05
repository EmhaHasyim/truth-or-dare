import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'

// ── WebSocket mock ──
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: any) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    this.readyState = MockWebSocket.OPEN
    MockWebSocket.instances.push(this)
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

const { mockLoaderData } = vi.hoisted(() => ({
  // Returns an accessor function: useLoaderData() -> accessor -> data
  mockLoaderData: vi.fn(() => () => null as any),
}))

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/solid-router', () => ({
  createFileRoute: vi.fn(() => {
    const route = (options: any) => ({ ...options, useLoaderData: mockLoaderData })
    route.useLoaderData = mockLoaderData
    route.component = null
    return route
  }),
  useNavigate: vi.fn(() => navigate),
  useParams: vi.fn(() => () => ({ id: 'room-123' })),
  useMatch: vi.fn(() => () => null),
  useSearch: vi.fn(() => () => ({ playerId: 'p1' })),
  Outlet: () => null,
  Link: (props: any) => props.children,
}))

const { getStoredUsername } = vi.hoisted(() => ({
  getStoredUsername: vi.fn(() => 'Alice'),
}))

vi.mock('../../lib/username', () => ({
  getStoredUsername,
  setStoredUsername: vi.fn(),
  clearStoredUsername: vi.fn(),
}))

const { getStoredPlayerSession } = vi.hoisted(() => ({
  getStoredPlayerSession: vi.fn(() => null as any),
}))

vi.mock('../../lib/player-session', () => ({
  getStoredPlayerSession,
  storePlayerSession: vi.fn(),
}))

vi.mock('../../lib/ws', () => ({
  getWsUrl: vi.fn((path: string) => `ws://localhost${path}`),
}))

const { showToast } = vi.hoisted(() => ({
  showToast: vi.fn(),
}))

vi.mock('../../lib/toast', () => ({
  showToast,
  mountToastContainer: vi.fn(),
}))

vi.mock('../../lib/confetti', () => ({
  fireConfetti: vi.fn(),
}))

vi.mock('../../lib/haptic', () => ({
  vibrate: vi.fn(),
}))

const { playTurnChime, playSuccess, playSkip, playFanfare } = vi.hoisted(() => ({
  playTurnChime: vi.fn(),
  playSuccess: vi.fn(),
  playSkip: vi.fn(),
  playFanfare: vi.fn(),
}))

vi.mock('../../lib/sounds', () => ({
  playTurnChime,
  playSuccess,
  playSkip,
  playError: vi.fn(),
  playFanfare,
}))

const { mockGetRoom } = vi.hoisted(() => ({
  mockGetRoom: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  apiClient: {
    rooms: {
      ':id': {
        $get: mockGetRoom,
      },
    },
  },
}))

vi.mock('../../types/ws-validation', () => ({
  serverMessageSchema: {
    safeParse: vi.fn((data: any) => ({ success: true, data })),
  },
}))

vi.mock('lucide-solid', () => ({
  Users: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-users')
    return el
  },
  Copy: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-copy')
    return el
  },
  Share2: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-share')
    return el
  },
  Play: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-play')
    return el
  },
  ArrowLeft: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-back')
    return el
  },
  Crown: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-crown')
    return el
  },
  HelpCircle: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-help')
    return el
  },
  Flame: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-flame')
    return el
  },
  Check: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-check')
    return el
  },
  SkipForward: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-skip')
    return el
  },
  LogOut: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-logout')
    return el
  },
  Flag: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-flag')
    return el
  },
  Gamepad2: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-gamepad')
    return el
  },
  RefreshCw: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-refresh')
    return el
  },
  Sparkles: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-sparkles')
    return el
  },
  X: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-x')
    return el
  },
}))

vi.mock('../../components/skeleton', () => ({
  SkeletonPlayerList: () => {
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'skeleton-players')
    return el
  },
}))

vi.mock('../../constants', () => ({
  TURN_TIMEOUT_MS: 60000,
  MAX_RECONNECT_ATTEMPTS: 5,
  WS_RECONNECT_DELAY: 2000,
}))

function makeRoom() {
  return {
    id: 'room-123',
    code: 'ABC123',
    name: 'Test Room',
    hostName: 'Alice',
    maxPlayers: 2,
    players: [{ id: 'p1', name: 'Alice', isHost: true }],
    hasPassword: false,
    status: 'waiting' as const,
    createdAt: Date.now(),
  }
}

async function renderRoomLobby() {
  MockWebSocket.instances = []
  const mod = await import('../room.$id')
  const Component = (mod.Route as any).component
  return render(() => <Component />)
}

async function renderGamePage() {
  MockWebSocket.instances = []
  const mod = await import('../room.$id.game')
  const Component = (mod.Route as any).component
  return render(() => <Component />)
}

function wsMessage(ws: MockWebSocket, data: any) {
  ws.onmessage?.({ data: JSON.stringify(data) })
}

describe('Room lobby (room.$id.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
    MockWebSocket.instances = []
    getStoredUsername.mockReturnValue('Alice')
    getStoredPlayerSession.mockReturnValue(null)
    mockLoaderData.mockReturnValue(() => makeRoom())
    mockGetRoom.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(makeRoom()) })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should render room code and name', async () => {
    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(container.textContent).toContain('Test Room')
      expect(container.textContent).toContain('AB-C1-23')
    })
  })

  it('should connect to WebSocket with playerId from room listing', async () => {
    await renderRoomLobby()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    expect(MockWebSocket.instances[0].url).toContain('/ws/room-123')
    expect(MockWebSocket.instances[0].url).toContain('name=Alice')
    expect(MockWebSocket.instances[0].url).toContain('playerId=p1')
  })

  it('should update player list on room_state message', async () => {
    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Bob')
    })
  })

  it('should show "Mulai Game" button for host with 2+ players', async () => {
    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Mulai Game')
    })

    const startBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Mulai Game'),
    )
    fireEvent.click(startBtn!)
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'start_game' }))
  })

  it('should show error message on server error', async () => {
    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    wsMessage(ws, { type: 'error', message: 'Room sudah penuh' })

    await waitFor(() => {
      expect(container.textContent).toContain('Room sudah penuh')
    })
  })

  it('should copy room code when copy button clicked', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true })

    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(container.textContent).toContain('Salin Kode')
    })

    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Salin Kode'),
    )
    fireEvent.click(copyBtn!)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('ABC123')
    })
    expect(showToast).toHaveBeenCalled()
  })

  it('should show room not found when loader returns error', async () => {
    mockLoaderData.mockReturnValue(() => null)
    mockGetRoom.mockResolvedValue({ ok: false, json: vi.fn() })

    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(container.textContent).toContain('Room Tidak Ditemukan')
    })
  })

  it('should navigate home when no username is stored', async () => {
    getStoredUsername.mockReturnValue(null as any)
    await renderRoomLobby()

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('should reset reconnect state on socket open', async () => {
    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]
    ws.onopen?.()
    // Should not show any reconnect banner after a successful open
    expect(container.textContent).not.toContain('Menyambung kembali')
  })

  it('should load the room via the route loader', async () => {
    const mod = await import('../room.$id')
    const room = await (mod.Route as any).loader({ params: { id: 'room-123' } })
    expect(room?.id).toBe('room-123')
  })

  it('should return null from the route loader when the room fetch fails', async () => {
    mockGetRoom.mockResolvedValue({ ok: false, json: vi.fn() })
    const mod = await import('../room.$id')
    const room = await (mod.Route as any).loader({ params: { id: 'room-123' } })
    expect(room).toBeNull()
  })

  it('should refetch room when loader data is null and fetch succeeds', async () => {
    mockLoaderData.mockReturnValue(() => null)
    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(container.textContent).toContain('Test Room')
    })
    expect(mockGetRoom).toHaveBeenCalled()
  })

  it('should show error when refetch throws', async () => {
    mockLoaderData.mockReturnValue(() => null)
    mockGetRoom.mockRejectedValue(new Error('network down'))

    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(container.textContent).toContain('Gagal muat room')
    })
  })

  it('should update players on player_joined and player_left', async () => {
    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, {
      type: 'player_joined',
      playerId: 'p3',
      playerName: 'Carol',
      isHost: false,
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
        { id: 'p3', name: 'Carol', isHost: false },
      ],
    })
    await waitFor(() => {
      expect(container.textContent).toContain('Carol')
    })

    wsMessage(ws, {
      type: 'player_left',
      playerId: 'p3',
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    })
    await waitFor(() => {
      expect(container.textContent).not.toContain('Carol')
    })
  })

  it('should navigate to game when game_started arrives', async () => {
    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    })
    await waitFor(() => {
      expect(container.textContent).toContain('Bob')
    })

    wsMessage(ws, {
      type: 'game_started',
      gameId: 'g1',
      playerOrder: ['p1', 'p2'],
      currentPlayerIndex: 0,
      round: 1,
    })

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/room/$id/game',
        params: { id: 'room-123' },
        search: { playerId: 'p1' },
      })
    })
  })

  it('should show skeleton while players list is empty', async () => {
    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(container.querySelector('[data-testid="skeleton-players"]')).toBeTruthy()
    })
  })

  it('should show "Butuh 2 pemain" disabled start button with <2 players', async () => {
    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]
    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [{ id: 'p1', name: 'Alice', isHost: true }],
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Butuh 2 pemain')
    })
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Butuh 2 pemain'),
    )
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('should use stored session playerId when user not in room listing', async () => {
    getStoredUsername.mockReturnValue('Bob')
    getStoredPlayerSession.mockReturnValue({ playerId: 'p2', playerName: 'Bob' })
    const room = makeRoom()
    room.players = [{ id: 'p1', name: 'Alice', isHost: true }]
    mockLoaderData.mockReturnValue(() => room)

    await renderRoomLobby()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    expect(MockWebSocket.instances[0].url).toContain('playerId=p2')
  })

  it('should show waiting-for-host view for non-host', async () => {
    getStoredUsername.mockReturnValue('Bob')
    const room = makeRoom()
    room.players = [
      { id: 'p1', name: 'Alice', isHost: true },
      { id: 'p2', name: 'Bob', isHost: false },
    ]
    mockLoaderData.mockReturnValue(() => room)

    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(container.textContent).toContain('Menunggu host mulai')
    })
  })

  it('should render non-6-char room code as-is (no formatting)', async () => {
    const room = makeRoom()
    room.code = 'ABC12'
    mockLoaderData.mockReturnValue(() => room)

    const { container } = await renderRoomLobby()

    await waitFor(() => {
      expect(container.textContent).toContain('ABC12')
    })
    expect(container.textContent).not.toContain('AB-C1-2')
  })

  it('should copy room link when share button clicked', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true })

    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(container.textContent).toContain('Salin Link')
    })

    const shareBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Salin Link'),
    )
    fireEvent.click(shareBtn!)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(window.location.href)
    })
    expect(showToast).toHaveBeenCalled()
  })

  it('should open WhatsApp share link', async () => {
    const openSpy = vi.fn()
    window.open = openSpy

    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(container.textContent).toContain('WhatsApp')
    })

    const waBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('WhatsApp'),
    )
    fireEvent.click(waBtn!)

    expect(openSpy).toHaveBeenCalled()
    expect(String(openSpy.mock.calls[0][0])).toContain('wa.me')
    expect(String(openSpy.mock.calls[0][0])).toContain('ABC123')
  })

  it('should show reconnect banner and reconnect after delay', async () => {
    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    vi.useFakeTimers()
    ws.onclose?.()
    await Promise.resolve()
    expect(container.textContent).toContain('Menyambung kembali')

    vi.advanceTimersByTime(2000)
    expect(MockWebSocket.instances.length).toBe(2)
    vi.useRealTimers()
  })

  it('should show connection error after max reconnect attempts', async () => {
    const { container } = await renderRoomLobby()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    vi.useFakeTimers()
    // Trigger MAX_RECONNECT_ATTEMPTS (5) closes with reconnects in between
    for (let i = 0; i < 5; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      ws.onclose?.()
      vi.advanceTimersByTime(2000)
    }

    // One more close: reconnectCount is now >= MAX_RECONNECT_ATTEMPTS
    const last = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    last.onclose?.()
    await Promise.resolve()
    expect(container.textContent).toContain('Koneksi terputus. Refresh halaman untuk mencoba lagi.')
    vi.useRealTimers()
  })
})

describe('Game page (room.$id.game.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
    MockWebSocket.instances = []
    getStoredUsername.mockReturnValue('Alice')
    getStoredPlayerSession.mockReturnValue({ playerId: 'p1', playerName: 'Alice' })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should render connecting state initially', async () => {
    const { container } = await renderGamePage()
    expect(container.textContent).toContain('Menghubungkan ke game...')
  })

  it('should show waiting_turn phase after room_state', async () => {
    const { container } = await renderGamePage()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    ws.onopen?.()
    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    })

    await waitFor(() => {
      expect(container.textContent).toContain('sedang giliran')
    })
  })

  it('should show question and Selesai button when it is my turn', async () => {
    const { container } = await renderGamePage()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    wsMessage(ws, {
      type: 'turn_question',
      playerId: 'p1',
      playerName: 'Alice',
      questionType: 'truth',
      question: 'Apa warna favoritmu?',
      questionId: 'q1',
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Apa warna favoritmu?')
      expect(container.textContent).toContain('Selesai')
    })

    const doneBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Selesai'),
    )
    fireEvent.click(doneBtn!)
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'turn_done', status: 'completed' }))
  })

  it('should show waiting for other player when not my turn', async () => {
    const { container } = await renderGamePage()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    wsMessage(ws, {
      type: 'turn_question',
      playerId: 'p2',
      playerName: 'Bob',
      questionType: 'truth',
      question: 'Apa hal memalukanmu?',
      questionId: 'q2',
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Menunggu Bob menjawab')
    })
  })

  it('should show turn result and skip button works', async () => {
    const { container } = await renderGamePage()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    wsMessage(ws, {
      type: 'turn_question',
      playerId: 'p1',
      playerName: 'Alice',
      questionType: 'truth',
      question: 'Q?',
      questionId: 'q1',
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Selesai')
    })

    const skipBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Skip'),
    )
    fireEvent.click(skipBtn!)
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'turn_done', status: 'skipped' }))

    wsMessage(ws, {
      type: 'turn_result',
      playerId: 'p1',
      playerName: 'Alice',
      status: 'skipped',
      questionType: 'truth',
      nextPlayerId: 'p2',
      nextPlayerName: 'Bob',
      round: 1,
    })

    await waitFor(() => {
      expect(container.textContent).toContain('melewati')
    })
  })

  it('should show game over screen on game_ended', async () => {
    const { container } = await renderGamePage()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    wsMessage(ws, { type: 'game_ended' })

    await waitFor(() => {
      expect(container.textContent).toContain('Game Selesai!')
    })
    expect(playFanfare).toHaveBeenCalled()
  })

  it('should trigger reconnect on socket close and show connecting state', async () => {
    const { container } = await renderGamePage()

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const ws = MockWebSocket.instances[0]
    ws.onclose?.()

    await waitFor(() => {
      expect(container.textContent).toContain('Menyambung')
    })
  })

  it('should navigate home when no username is stored', async () => {
    getStoredUsername.mockReturnValue(null as any)
    await renderGamePage()

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('should handle game_started with known player name', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    })
    wsMessage(ws, {
      type: 'game_started',
      gameId: 'g1',
      playerOrder: ['p1', 'p2'],
      currentPlayerIndex: 0,
      round: 1,
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Alice')
      expect(container.textContent).toContain('sedang giliran')
    })
  })

  it('should handle waiting_for_choice message', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, { type: 'waiting_for_choice', playerId: 'p2', playerName: 'Bob' })

    await waitFor(() => {
      expect(container.textContent).toContain('Bob')
      expect(container.textContent).toContain('sedang giliran')
    })
  })

  it('should show completed turn result and play success sound', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, {
      type: 'turn_result',
      playerId: 'p1',
      playerName: 'Alice',
      status: 'completed',
      questionType: 'truth',
      nextPlayerId: 'p2',
      nextPlayerName: 'Bob',
      round: 2,
    })

    await waitFor(() => {
      expect(container.textContent).toContain('menjawab pertanyaan!')
    })
    expect(playSuccess).toHaveBeenCalled()
  })

  it('should update players on player_joined in game page', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, {
      type: 'player_joined',
      playerId: 'p3',
      playerName: 'Carol',
      isHost: false,
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
        { id: 'p3', name: 'Carol', isHost: false },
      ],
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Carol')
    })
  })

  it('should allow host to end the game via modal', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [
        { id: 'p1', name: 'Alice', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="icon-flag"]')).toBeTruthy()
    })

    const flagBtn = container
      .querySelector('[data-testid="icon-flag"]')
      ?.closest('button') as HTMLButtonElement
    fireEvent.click(flagBtn)
    expect(container.textContent).toContain('Akhiri Game?')

    const confirmBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Akhiri Game') && !b.textContent?.includes('Akhiri Game?'),
    )
    fireEvent.click(confirmBtn!)

    await waitFor(() => {
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'end_game' }))
    })
  })

  it('should allow leaving the game via modal', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    const leaveBtn = container
      .querySelector('[data-testid="icon-logout"]')
      ?.closest('button') as HTMLButtonElement
    fireEvent.click(leaveBtn)
    expect(container.textContent).toContain('Tinggalkan Game?')

    const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ya, Keluar'),
    )
    fireEvent.click(confirmBtn!)

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('should show connect timeout error after 8s', async () => {
    vi.useFakeTimers()
    const { container } = await renderGamePage()
    await Promise.resolve()
    expect(MockWebSocket.instances.length).toBe(1)

    vi.advanceTimersByTime(8000)
    await Promise.resolve()
    expect(container.textContent).toContain('Server game tidak merespon')
    vi.useRealTimers()
  })

  it('should show connection error after max reconnect attempts', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    vi.useFakeTimers()
    for (let i = 0; i < 5; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      ws.onclose?.()
      vi.advanceTimersByTime(2000)
    }

    const last = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    last.onclose?.()
    await Promise.resolve()
    expect(container.textContent).toContain('Koneksi terputus. Refresh halaman untuk mencoba lagi.')
    vi.useRealTimers()
  })

  it('should fill current turn name from room_state when it was unknown', async () => {
    const { container } = await renderGamePage()
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    const ws = MockWebSocket.instances[0]

    // game_started with a player id we haven't seen yet — name stays empty
    wsMessage(ws, {
      type: 'game_started',
      gameId: 'g1',
      playerOrder: ['p9', 'p1'],
      currentPlayerIndex: 0,
      round: 1,
    })

    // A later room_state carries the players list, filling in the missing name
    wsMessage(ws, {
      type: 'room_state',
      playerId: 'p1',
      players: [
        { id: 'p9', name: 'Zed', isHost: false },
        { id: 'p1', name: 'Alice', isHost: true },
      ],
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Zed')
    })
  })

  it('should return to waiting phase after turn result delay', async () => {
    vi.useFakeTimers()
    const { container } = await renderGamePage()
    await Promise.resolve()
    expect(MockWebSocket.instances.length).toBe(1)
    const ws = MockWebSocket.instances[0]

    wsMessage(ws, {
      type: 'turn_result',
      playerId: 'p1',
      playerName: 'Alice',
      status: 'completed',
      questionType: 'truth',
      nextPlayerId: 'p2',
      nextPlayerName: 'Bob',
      round: 1,
    })
    await Promise.resolve()
    expect(container.textContent).toContain('menjawab pertanyaan!')

    vi.advanceTimersByTime(2800)
    await Promise.resolve()
    expect(container.textContent).toContain('sedang giliran')
    vi.useRealTimers()
  })
})
