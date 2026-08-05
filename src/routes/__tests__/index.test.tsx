import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock username helpers
vi.mock('../lib/username', () => ({
  getStoredUsername: vi.fn(() => ''),
  setStoredUsername: vi.fn(),
  clearStoredUsername: vi.fn(),
}))

// Mock toast
vi.mock('../lib/toast', () => ({
  showToast: vi.fn(),
}))

// Mock lucide-solid icons
vi.mock('lucide-solid', () => ({
  Sparkles: () => null,
  Plus: () => null,
  Gamepad2: () => null,
  ArrowRight: () => null,
  LogIn: () => null,
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

// Mock solid-transition-group
vi.mock('solid-transition-group', () => ({
  default: (props: any) => props.children,
  Transition: (props: any) => props.children,
}))

describe('Home page (index.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should export Route with component', async () => {
    const mod = await import('../index')
    expect(mod.Route).toBeDefined()
    expect((mod.Route as any).component).toBeDefined()
  })

  it('component should be a function', async () => {
    const mod = await import('../index')
    expect(typeof (mod.Route as any).component).toBe('function')
  })
})
