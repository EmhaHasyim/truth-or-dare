/**
 * Confetti helper — wraps canvas-confetti for consistent game-over celebrations.
 */
import confetti from 'canvas-confetti'

export function fireConfetti() {
  // Fire from both sides for a grand feel
  const defaults = {
    spread: 70,
    particleCount: 80,
    startVelocity: 35,
    origin: { y: 0.6 },
    disableForReducedMotion: true,
  }

  confetti({ ...defaults, angle: 60, origin: { x: 0, y: 0.6 } })
  confetti({ ...defaults, angle: 120, origin: { x: 1, y: 0.6 } })

  // Second burst after a short delay
  setTimeout(() => {
    confetti({
      ...defaults,
      particleCount: 120,
      spread: 120,
      startVelocity: 45,
      origin: { y: 0.5 },
    })
  }, 300)
}
