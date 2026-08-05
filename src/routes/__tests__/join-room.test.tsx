import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/username', () => ({
  getStoredUsername: vi.fn(() => 'Bob'),
  setStoredUsername: vi.fn(),
  clearStoredUsername: vi.fn(),
}))

vi.mock('../../lib/player-session', () => ({
  storePlayerSession: vi.fn(),
}))

vi.mock('../../lib/toast', () => ({
  showToast: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  apiClient: {
    rooms: {
      $get: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      }),
      ':id': {
        join: {
          $post: vi.fn(),
        },
      },
      code: {
        ':code': {
          $get: vi.fn(),
        },
      },
    },
  },
}))

vi.mock('@tanstack/solid-router', () => ({
  createFileRoute: vi.fn(() => {
    const route = (options: any) => ({ ...options, component: options.component })
    route.component = null
    return route
  }),
  useNavigate: vi.fn(() => vi.fn()),
  useParams: vi.fn(() => ({})),
  useMatch: vi.fn(() => null),
  Outlet: () => null,
  Link: (props: any) => props.children,
}))

vi.mock('lucide-solid', () => ({
  Search: () => null,
  Lock: () => null,
  Plus: () => null,
  RefreshCw: () => null,
  Hash: () => null,
}))

vi.mock('../../components/skeleton', () => ({
  SkeletonCardList: () => null,
}))

describe('JoinRoom page', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('should export Route with component', async () => {
    const mod = await import('../join-room')
    expect(mod.Route).toBeDefined()
    expect((mod.Route as any).component).toBeDefined()
  })

  it('component should be a function', async () => {
    const mod = await import('../join-room')
    expect(typeof (mod.Route as any).component).toBe('function')
  })
})
