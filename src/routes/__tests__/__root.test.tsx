import { describe, it, expect, vi } from 'vitest'

// Mock the actual router properly for __root.tsx which uses createRootRouteWithContext
vi.mock('@tanstack/solid-router', () => ({
  createRootRouteWithContext: vi.fn(() => (options: any) => options),
  createFileRoute: vi.fn(() => {
    const route = (options: any) => ({ ...options, component: options.component })
    route.component = null
    return route
  }),
  Outlet: () => null,
  Link: (props: any) => props.children,
  useNavigate: vi.fn(() => vi.fn()),
  useRouter: vi.fn(() => ({ state: {} })),
}))

vi.mock('lucide-solid', () => ({
  Sparkles: () => null,
  Sun: () => null,
  Moon: () => null,
  LogOut: () => null,
  Edit3: () => null,
}))

vi.mock('../../lib/username', () => ({
  getStoredUsername: vi.fn(() => ''),
  setStoredUsername: vi.fn(),
  clearStoredUsername: vi.fn(),
}))

vi.mock('../../lib/toast', () => ({
  showToast: vi.fn(),
  mountToastContainer: vi.fn(),
}))

vi.mock('solid-transition-group', () => ({
  default: (props: any) => props.children,
  Transition: (props: any) => props.children,
}))

vi.mock('theme-change', () => ({
  themeChange: vi.fn(),
}))

describe('Root page (__root.tsx)', () => {
  it('should export Route with component', async () => {
    const mod = await import('../__root')
    expect(mod.Route).toBeDefined()
    expect((mod.Route as any).component).toBeDefined()
  })

  it('component should be a function', async () => {
    const mod = await import('../__root')
    expect(typeof (mod.Route as any).component).toBe('function')
  })
})
