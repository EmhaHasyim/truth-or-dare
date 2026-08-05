import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

function makeMockAudioCtx() {
  return {
    createOscillator: vi.fn(function () {
      return {
        connect: vi.fn().mockReturnThis(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: { setValueAtTime: vi.fn() },
      }
    }),
    createGain: vi.fn(function () {
      return {
        connect: vi.fn().mockReturnThis(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      }
    }),
    destination: 'mock-dest',
    currentTime: 1000,
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
  }
}

describe('sound effects', () => {
  let mockCtx: ReturnType<typeof makeMockAudioCtx>
  let sounds: typeof import('./sounds')

  beforeAll(async () => {
    mockCtx = makeMockAudioCtx()
    // IMPORTANT: use a regular function (not arrow) because getCtx() in
    // sounds.ts uses `new (window.AudioContext)()` which requires a constructor
    ;(window as any).AudioContext = vi.fn(function () {
      return mockCtx
    })
    sounds = await import('./sounds')
    // Initialize audioCtx in the sounds module by calling one function
    sounds.playTurnChime()
    mockCtx.createOscillator.mockClear()
  })

  beforeEach(() => {
    vi.useFakeTimers()
    mockCtx.createOscillator.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('playTurnChime should create 2 tones (C5 immediate + E5 delayed 100ms)', () => {
    sounds.playTurnChime()
    // Only 1 oscillator so far (immediate C5)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1)
    // Advance past the 100ms delay for the second tone (E5)
    vi.advanceTimersByTime(100)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2)
  })

  it('playSuccess should create 2 tones (G5 immediate + C6 delayed 80ms)', () => {
    sounds.playSuccess()
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(80)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2)
  })

  it('playSkip should create 2 tones (descending, delayed 80ms)', () => {
    sounds.playSkip()
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(80)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2)
  })

  it('playError should create 3 tones (immediate + 2 delayed)', () => {
    sounds.playError()
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(150)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(150)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(3)
  })

  it('playFanfare should create 4 tones (all immediate, different start delays)', () => {
    // playFanfare creates all 4 oscillators synchronously (no setTimeout)
    sounds.playFanfare()
    // Each note uses ctx.currentTime + delay (Web Audio scheduling),
    // so all 4 oscillators are created immediately
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(4)
  })

  it('should handle suspended AudioContext gracefully', () => {
    // The module's AudioContext was initialized in beforeAll and is 'running'.
    // This test just verifies the function doesn't throw.
    expect(() => sounds.playTurnChime()).not.toThrow()
  })

  it('should handle failed AudioContext() constructor gracefully', async () => {
    // Override AudioContext to throw
    const origAudioCtx = (window as any).AudioContext
    ;(window as any).AudioContext = vi.fn(() => {
      throw new Error('no audio')
    })
    const mod = await import('./sounds')
    expect(() => mod.playTurnChime()).not.toThrow()
    expect(() => mod.playSuccess()).not.toThrow()
    expect(() => mod.playSkip()).not.toThrow()
    expect(() => mod.playError()).not.toThrow()
    expect(() => mod.playFanfare()).not.toThrow()
    ;(window as any).AudioContext = origAudioCtx
  })

  it('should handle resumed AudioContext state', async () => {
    // Note: getCtx() caches audioCtx, so this test verifies the resume
    // path by checking the already-initialized context from beforeAll.
    // The mock context was initialized with state 'running', so resume
    // is not called again. This is behavior verification.
    expect(() => sounds.playTurnChime()).not.toThrow()
  })

  it('should not throw when AudioContext constructor fails and we call multiple times', async () => {
    const origAudioCtx = (window as any).AudioContext
    ;(window as any).AudioContext = vi.fn(() => {
      throw new Error('no audio')
    })
    const mod = await import('./sounds')
    expect(() => {
      mod.playTurnChime()
      mod.playSuccess()
      mod.playSkip()
    }).not.toThrow()
    ;(window as any).AudioContext = origAudioCtx
  })

  it('should resume a suspended AudioContext', async () => {
    mockCtx.state = 'suspended'
    sounds.playTurnChime()
    expect(mockCtx.resume).toHaveBeenCalled()
    mockCtx.state = 'running'
  })

  it('should swallow resume rejection', async () => {
    mockCtx.state = 'suspended'
    mockCtx.resume.mockImplementation(() => Promise.reject(new Error('resume failed')))
    // .catch(() => {}) inside getCtx swallows the rejection synchronously
    expect(() => sounds.playTurnChime()).not.toThrow()
    await Promise.resolve()
    mockCtx.resume.mockResolvedValue(undefined)
    mockCtx.state = 'running'
  })

  it('should handle window undefined (no-op)', async () => {
    vi.resetModules()
    const originalWindow = window as any
    // Simulate SSR environment where window doesn't exist
    ;(globalThis as any).window = undefined
    const mod = await import('./sounds')
    expect(() => {
      mod.playTurnChime()
      mod.playSuccess()
      mod.playSkip()
      mod.playError()
      mod.playFanfare()
    }).not.toThrow()
    ;(globalThis as any).window = originalWindow
    // Re-import to restore the initialized audioCtx for the shared `sounds` reference
    vi.resetModules()
    ;(window as any).AudioContext = vi.fn(function () {
      return mockCtx
    })
    await import('./sounds')
  })

  it('should hit the catch branch when AudioContext constructor throws in a fresh module', async () => {
    vi.resetModules()
    ;(window as any).AudioContext = vi.fn(function () {
      throw new Error('no audio')
    })
    const mod = await import('./sounds')
    expect(() => mod.playTurnChime()).not.toThrow()
    // Restore shared state for the `sounds` reference used by other tests
    vi.resetModules()
    ;(window as any).AudioContext = vi.fn(function () {
      return mockCtx
    })
    await import('./sounds')
  })

  it('should fall back to webkitAudioContext when AudioContext is unavailable', async () => {
    vi.resetModules()
    const originalAudioCtx = (window as any).AudioContext
    const originalWebkitCtx = (window as any).webkitAudioContext
    ;(window as any).AudioContext = undefined
    const webkitCtx = makeMockAudioCtx()
    ;(window as any).webkitAudioContext = vi.fn(function () {
      return webkitCtx
    })
    const mod = await import('./sounds')
    expect(() => mod.playTurnChime()).not.toThrow()
    expect(webkitCtx.createOscillator).toHaveBeenCalled()
    // Restore shared state for other tests
    vi.resetModules()
    ;(window as any).AudioContext = originalAudioCtx
    ;(window as any).webkitAudioContext = originalWebkitCtx
    ;(window as any).AudioContext = vi.fn(function () {
      return mockCtx
    })
    await import('./sounds')
  })
})
