/**
 * Game sound effects using Web Audio API — no audio files needed.
 * Generates tones/chimes programmatically.
 */

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    } catch {
      return null
    }
  }
  // Resume if suspended (autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.08,
  delay = 0
) {
  const ctx = getCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay)
  gain.gain.setValueAtTime(volume, ctx.currentTime + delay)
  gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + delay + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime + delay)
  osc.stop(ctx.currentTime + delay + duration)
}

/** Pleasant chime when receiving a turn */
export function playTurnChime() {
  playTone(523.25, 0.2, 'sine', 0.06)   // C5
  setTimeout(() => playTone(659.25, 0.3, 'sine', 0.06), 100) // E5
}

/** Short click/success sound for completing a turn */
export function playSuccess() {
  playTone(783.99, 0.15, 'sine', 0.05)  // G5
  setTimeout(() => playTone(1046.5, 0.25, 'sine', 0.05), 80) // C6
}

/** Soft swoosh for skipping */
export function playSkip() {
  playTone(350, 0.15, 'triangle', 0.04)
  setTimeout(() => playTone(250, 0.25, 'triangle', 0.04), 80)
}

/** Alert beep for errors */
export function playError() {
  playTone(440, 0.15, 'square', 0.03)
  setTimeout(() => playTone(380, 0.15, 'square', 0.03), 150)
  setTimeout(() => playTone(440, 0.2, 'square', 0.03), 300)
}

/** Celebratory fanfare for game over */
export function playFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    playTone(freq, 0.3, 'sine', 0.06, i * 0.12)
  })
}
