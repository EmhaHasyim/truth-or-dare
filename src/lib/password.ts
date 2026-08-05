// Password hashing using the Web Crypto API (PBKDF2 + SHA-256).
// This is significantly faster than bcryptjs in Cloudflare Workers
// and avoids CPU limit issues (crypto.subtle is not counted against the
// Worker CPU time limit).

const SALT_LENGTH = 16 // 128-bit salt
const KEY_LENGTH = 32 // 256-bit derived key
/**
 * Iterations used for NEW hashes. crypto.subtle PBKDF2 runs on BoringSSL and
 * is not subject to the Workers CPU-time limit, so a strong work factor is
 * affordable (OWASP recommends ≥600k for PBKDF2-SHA256; 100k is a sensible
 * balance on Workers).
 */
const ITERATIONS = 100_000
/** Iterations used by hashes created before the work-factor bump (kept so old room passwords still verify). */
const LEGACY_ITERATIONS = 2_000
const HASH = 'SHA-256'
/** Hash format: pbkdf2-sha256$<iterations>$<salt_hex>$<key_hex> */
const HASH_PREFIX = 'pbkdf2-sha256'
const NEW_FORMAT = /^pbkdf2-sha256\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes.buffer
}

/**
 * Constant-time comparison of two strings to prevent timing side-channel attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function deriveKey(
  password: string,
  salt: ArrayBuffer,
  iterations: number,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const passwordBuffer = enc.encode(password)

  const baseKey = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, [
    'deriveBits',
  ])

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: HASH,
    },
    baseKey,
    KEY_LENGTH * 8, // bits
  )
}

/**
 * Hash a password. The `iterations` parameter is only used by tests to
 * generate legacy-format hashes; callers always use the default.
 */
export async function hashPassword(
  password: string,
  iterations: number = ITERATIONS,
): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Invalid password')
  }

  const maxLength = 128
  if (password.length > maxLength) {
    throw new Error('Password too long')
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const derivedKey = await deriveKey(password, saltBytes.buffer, iterations)

  return `${HASH_PREFIX}$${iterations}$${bufferToHex(saltBytes.buffer)}$${bufferToHex(derivedKey)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || !stored) return false

  try {
    let saltHex: string
    let expectedHex: string
    let iterations: number

    const match = stored.match(NEW_FORMAT)
    if (match) {
      iterations = Number(match[1])
      if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false
      saltHex = match[2]
      expectedHex = match[3]
    } else {
      // Legacy format (pre-bump): "salt_hex:key_hex" derived with LEGACY_ITERATIONS.
      const colonIndex = stored.indexOf(':')
      if (colonIndex === -1) return false
      saltHex = stored.slice(0, colonIndex)
      expectedHex = stored.slice(colonIndex + 1)
      if (saltHex.length !== SALT_LENGTH * 2 || expectedHex.length !== KEY_LENGTH * 2) return false
      if (!/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(expectedHex)) return false
      iterations = LEGACY_ITERATIONS
    }

    const salt = hexToBuffer(saltHex)
    const derivedKey = await deriveKey(password, salt, iterations)
    const actualHex = bufferToHex(derivedKey)

    return timingSafeEqual(actualHex, expectedHex)
  } catch {
    return false
  }
}

export function isValidPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return false

  const minLength = 8
  const maxLength = 128

  if (password.length < minLength || password.length > maxLength) return false

  return true
}
