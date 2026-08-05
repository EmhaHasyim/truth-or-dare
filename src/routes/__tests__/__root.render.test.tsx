import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'

const { Outlet } = vi.hoisted(() => ({ Outlet: vi.fn(() => null) }))

vi.mock('@tanstack/solid-router', () => ({
  createRootRouteWithContext: vi.fn(() => (options: any) => options),
  createFileRoute: vi.fn(() => {
    const route = (options: any) => options
    route.component = null
    return route
  }),
  Outlet,
  Link: (props: any) => props.children,
  useNavigate: vi.fn(() => vi.fn()),
  useRouter: vi.fn(() => ({ state: {} })),
}))

const { getStoredUsername, setStoredUsername, clearStoredUsername } = vi.hoisted(() => ({
  getStoredUsername: vi.fn(() => 'Alice'),
  setStoredUsername: vi.fn(),
  clearStoredUsername: vi.fn(),
}))

vi.mock('../../lib/username', () => ({
  getStoredUsername,
  setStoredUsername,
  clearStoredUsername,
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
  Sun: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-sun')
    return el
  },
  Moon: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-moon')
    return el
  },
  LogOut: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-logout')
    return el
  },
  Edit3: (_props: any) => {
    const el = document.createElement('span')
    el.setAttribute('data-testid', 'icon-edit')
    return el
  },
}))

vi.mock('solid-transition-group', () => ({
  default: (props: any) => props.children,
  Transition: (props: any) => props.children,
}))

const { themeChange } = vi.hoisted(() => ({
  themeChange: vi.fn(),
}))

vi.mock('theme-change', () => ({
  themeChange,
}))

async function renderRoot() {
  const mod = await import('../__root')
  const Component = (mod.Route as any).component
  return render(() => <Component />)
}

describe('Root component (__root.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    getStoredUsername.mockReturnValue('Alice')
  })

  afterEach(() => {
    cleanup()
  })

  it('should render the header with logo', async () => {
    const { container } = await renderRoot()
    await waitFor(() => {
      expect(container.querySelector('header')).toBeTruthy()
      expect(container.textContent).toContain('Truth or Dare')
    })
  })

  it('should show username menu when username exists', async () => {
    const { container } = await renderRoot()
    await waitFor(() => {
      expect(container.textContent).toContain('Alice')
    })
  })

  it('should open the username menu on click', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)

    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
      expect(container.textContent).toContain('Ganti Nama')
      expect(container.textContent).toContain('Logout')
    })
  })

  it('should open username modal from menu', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)

    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
    })

    const editBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ganti Nama'),
    )
    fireEvent.click(editBtn!)

    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
      expect(container.textContent).toContain('Ganti Nama')
    })
  })

  it('should save new username from modal', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)

    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
    })

    const editBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ganti Nama'),
    )
    fireEvent.click(editBtn!)

    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
    })

    const input = container.querySelector('dialog input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'BobBaru' } })
    const modalForm = container.querySelector('dialog form')!
    fireEvent.submit(modalForm)

    await waitFor(() => {
      expect(setStoredUsername).toHaveBeenCalledWith('BobBaru')
    })
    expect(showToast).toHaveBeenCalledWith('Nama berhasil diubah!', 'success')
  })

  it('should logout and clear username', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)

    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
    })

    const logoutBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Logout'),
    )
    fireEvent.click(logoutBtn!)

    await waitFor(() => {
      expect(clearStoredUsername).toHaveBeenCalled()
    })
    expect(showToast).toHaveBeenCalledWith('Berhasil logout', 'info')
  })

  it('should toggle theme on theme button click', async () => {
    document.documentElement.setAttribute('data-theme', 'cupcake')
    const { container } = await renderRoot()

    const themeBtn = container.querySelector('[aria-label="Toggle theme"]') as HTMLButtonElement
    fireEvent.click(themeBtn)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('should detect dark theme on mount', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { container } = await renderRoot()

    await waitFor(() => {
      const moonIcon = container.querySelector('[data-testid="icon-moon"]')
      expect(moonIcon).toBeTruthy()
    })
  })

  it('should render Outlet content', async () => {
    const { container } = await renderRoot()
    expect(container.querySelector('main')).toBeTruthy()
  })

  it('should render the 404 not-found page', async () => {
    const mod = await import('../__root')
    const NotFound = (mod.Route as any).notFoundComponent
    const { container } = render(() => <NotFound />)

    expect(container.textContent).toContain('Halaman Tidak Ditemukan')
  })

  it('should render error fallback when a child component throws', async () => {
    Outlet.mockImplementation(() => {
      throw new Error('boom')
    })
    try {
      const { container } = await renderRoot()
      await waitFor(() => {
        expect(container.textContent).toContain('Terjadi Kesalahan')
      })
    } finally {
      Outlet.mockImplementation(() => null)
    }
  })

  it('should close the mobile menu when clicking outside', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)
    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
    })

    fireEvent.click(document.body)

    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeFalsy()
    })
  })

  it('should not save an empty username from the modal', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)
    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
    })

    const editBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ganti Nama'),
    )
    fireEvent.click(editBtn!)
    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
    })

    const modalForm = container.querySelector('dialog form')!
    fireEvent.submit(modalForm)

    expect(setStoredUsername).not.toHaveBeenCalled()
  })

  it('should reject usernames with special characters from the modal', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)
    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
    })

    const editBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ganti Nama'),
    )
    fireEvent.click(editBtn!)
    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
    })

    const input = container.querySelector('dialog input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'Evil<script>' } })
    const modalForm = container.querySelector('dialog form')!
    fireEvent.submit(modalForm)

    expect(setStoredUsername).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(container.textContent).toContain('Karakter spesial tidak diizinkan')
    })
  })

  it('should reject usernames longer than 20 chars from the modal', async () => {
    const { container } = await renderRoot()

    const menuBtn = container.querySelector('.menu-trigger') as HTMLButtonElement
    fireEvent.click(menuBtn)
    await waitFor(() => {
      expect(container.querySelector('.mobile-menu')).toBeTruthy()
    })

    const editBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ganti Nama'),
    )
    fireEvent.click(editBtn!)
    await waitFor(() => {
      expect(container.querySelector('dialog')?.classList.contains('modal-open')).toBe(true)
    })

    const input = container.querySelector('dialog input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'A'.repeat(21) } })
    const modalForm = container.querySelector('dialog form')!
    fireEvent.submit(modalForm)

    expect(setStoredUsername).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(container.textContent).toContain('Maksimal 20 karakter')
    })
  })

  it('should toggle theme back to light when currently dark', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { container } = await renderRoot()

    const themeBtn = container.querySelector('[aria-label="Toggle theme"]') as HTMLButtonElement
    fireEvent.click(themeBtn)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('cupcake')
    })
    expect(localStorage.getItem('theme')).toBe('cupcake')
  })
})
