import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/username', () => ({
  getStoredUsername: vi.fn(() => 'Alice'),
}))

vi.mock('../../lib/player-session', () => ({
  getStoredPlayerSession: vi.fn(() => null),
}))

vi.mock('../../lib/ws', () => ({
  getWsUrl: vi.fn((path: string) => `ws://localhost${path}`),
}))

vi.mock('../../lib/confetti', () => ({
  fireConfetti: vi.fn(),
}))

vi.mock('../../lib/haptic', () => ({
  vibrate: vi.fn(),
}))

vi.mock('../../lib/sounds', () => ({
  playTurnChime: vi.fn(),
  playSuccess: vi.fn(),
  playSkip: vi.fn(),
  playError: vi.fn(),
  playFanfare: vi.fn(),
}))

vi.mock('../../lib/toast', () => ({
  showToast: vi.fn(),
}))

vi.mock('@tanstack/solid-router', () => ({
  createFileRoute: vi.fn(() => {
    const route = (options: any) => ({ ...options, component: options.component })
    route.component = null
    return route
  }),
  useNavigate: vi.fn(() => vi.fn()),
  useParams: vi.fn(() => ({ id: 'room-123' })),
  useMatch: vi.fn(() => null),
  Outlet: () => null,
  Link: (props: any) => props.children,
  useSearch: vi.fn(() => ({ playerId: 'p1' })),
}))

vi.mock('lucide-solid', () => ({
  HelpCircle: () => null,
  Flame: () => null,
  Check: () => null,
  SkipForward: () => null,
  LogOut: () => null,
}))

vi.mock('../../constants', () => ({
  TURN_TIMEOUT_MS: 60000,
}))

describe('GamePage (room.$id.game.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('should export Route with component', async () => {
    const mod = await import('../room.$id.game')
    expect(mod.Route).toBeDefined()
    expect((mod.Route as any).component).toBeDefined()
  })

  it('component should be a function', async () => {
    const mod = await import('../room.$id.game')
    expect(typeof (mod.Route as any).component).toBe('function')
  })
})
