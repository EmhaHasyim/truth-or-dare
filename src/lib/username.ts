const STORAGE_KEY = 'truth-or-dare-username'

export function getStoredUsername(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setStoredUsername(name: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    // localStorage unavailable
  }
}

export function clearStoredUsername(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage unavailable
  }
}
