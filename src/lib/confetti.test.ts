import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('canvas-confetti', () => ({ default: vi.fn() }))

describe('fireConfetti', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should not throw when called', async () => {
    const { fireConfetti } = await import('./confetti')
    expect(() => fireConfetti()).not.toThrow()
  })

  it('should call confetti twice immediately (left + right burst)', async () => {
    const confettiModule = await import('canvas-confetti')
    const confetti = confettiModule.default as ReturnType<typeof vi.fn>
    confetti.mockClear()

    const { fireConfetti } = await import('./confetti')
    fireConfetti()
    // Two immediate burst calls (left angle + right angle)
    expect(confetti).toHaveBeenCalledTimes(2)
  })

  it('should fire a third burst after 300ms delay', async () => {
    const confettiModule = await import('canvas-confetti')
    const confetti = confettiModule.default as ReturnType<typeof vi.fn>
    confetti.mockClear()

    const { fireConfetti } = await import('./confetti')
    fireConfetti()
    // Two immediate bursts
    expect(confetti).toHaveBeenCalledTimes(2)

    // Advance past the 300ms delay for the third burst
    vi.advanceTimersByTime(300)
    // Third burst fires (1 more call = 3 total)
    expect(confetti).toHaveBeenCalledTimes(3)
  })
})
