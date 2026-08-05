import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('../../lib/username', () => ({
  getStoredUsername: vi.fn(() => 'Alice'),
  setStoredUsername: vi.fn(),
  clearStoredUsername: vi.fn(),
}))

vi.mock('../../lib/player-session', () => ({
  getStoredPlayerSession: vi.fn(() => null),
  storePlayerSession: vi.fn(),
}))

vi.mock('../../lib/ws', () => ({
  getWsUrl: vi.fn((path: string) => `ws://localhost${path}`),
}))

vi.mock('../../lib/toast', () => ({
  showToast: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  apiClient: {
    rooms: {
      ':id': {
        $get: vi.fn(),
      },
    },
  },
}))

vi.mock('@tanstack/solid-router', () => ({
  createFileRoute: vi.fn(() => {
    const route = (options: any) => ({ ...options, component: options.component })
    route.component = null
    route.useLoaderData = vi.fn(() => null)
    return route
  }),
  useNavigate: vi.fn(() => vi.fn()),
  useParams: vi.fn(() => ({ id: 'room-123' })),
  useMatch: vi.fn(() => null),
  Outlet: () => null,
  Link: (props: any) => props.children,
}))

vi.mock('lucide-solid', () => ({
  Users: () => null,
  Copy: () => null,
  Share2: () => null,
  Play: () => null,
  ArrowLeft: () => null,
  Crown: () => null,
}))

vi.mock('../../components/skeleton', () => ({
  SkeletonPlayerList: () => null,
}))

vi.mock('../../types/ws-validation', () => ({
  serverMessageSchema: {
    safeParse: vi.fn(() => ({
      success: true,
      data: { type: 'room_state', playerId: 'p1', players: [] },
    })),
  },
}))

describe('RoomPage (room.$id.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('should export Route with component', async () => {
    const mod = await import('../room.$id')
    expect(mod.Route).toBeDefined()
    expect((mod.Route as any).component).toBeDefined()
  })

  it('component should be a function', async () => {
    const mod = await import('../room.$id')
    expect(typeof (mod.Route as any).component).toBe('function')
  })
})
