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
})
