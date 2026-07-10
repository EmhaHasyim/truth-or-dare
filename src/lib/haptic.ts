/**
 * Trigger a subtle haptic feedback vibration on supported devices.
 * Falls back silently on devices without the Vibration API.
 */
export function vibrate(duration = 15) {
  if (typeof navigator !== 'undefined' && navigator && 'vibrate' in navigator) {
    navigator.vibrate(duration)
  }
}
