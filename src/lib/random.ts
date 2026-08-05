/**
 * Cryptographically secure uniform random integer in [0, maxExclusive).
 *
 * Uses rejection sampling over Uint32Array to avoid modulo bias, matching the
 * approach previously inlined in `rooms.ts` and `shuffle.ts`.
 */
export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('randomInt: maxExclusive must be > 0')
  if (maxExclusive === 1) return 0

  const MAX_UINT32 = 4294967296 // 2^32
  const maxValid = Math.floor(MAX_UINT32 / maxExclusive) * maxExclusive
  let rand: number
  do {
    rand = crypto.getRandomValues(new Uint32Array(1))[0]
  } while (rand >= maxValid)
  return rand % maxExclusive
}
