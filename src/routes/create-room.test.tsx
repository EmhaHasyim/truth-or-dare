import { describe, it, expect, vi } from 'vitest'

// Mock the API client
vi.mock(
  '../api/client',
  () =>
    ({
      apiClient: {
        rooms: {
          $post: vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
              id: 'room-123',
              code: 'ABC123',
              name: 'Test Room',
              hostName: 'Alice',
              players: [{ id: 'p1', name: 'Alice', isHost: true }],
            }),
          }),
        },
      },
    }) as any,
)

// Mock lucide-solid icons
vi.mock('lucide-solid', () => ({
  Plus: () => null,
  Sparkles: () => null,
  Shield: () => null,
  Lock: () => null,
}))

// Mock username helpers
vi.mock('../lib/username', () => ({
  getStoredUsername: vi.fn(() => 'Alice'),
  setStoredUsername: vi.fn(),
}))

// Mock player-session
vi.mock('../lib/player-session', () => ({
  storePlayerSession: vi.fn(),
}))

// Mock password
vi.mock('../lib/password', () => ({
  isValidPassword: vi.fn(() => true),
}))

// Mock TanStack Router
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

describe('CreateRoom page', () => {
  it('should export Route with component', async () => {
    const mod = await import('./create-room')
    expect(mod.Route).toBeDefined()
    expect((mod.Route as any).component).toBeDefined()
  })

  it('component should be a function', async () => {
    const mod = await import('./create-room')
    expect(typeof (mod.Route as any).component).toBe('function')
  })
})
