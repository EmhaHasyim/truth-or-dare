// Password hashing using the Web Crypto API (PBKDF2 + SHA-256).
// This is significantly faster than bcryptjs in Cloudflare Workers
// and avoids CPU limit issues.

const SALT_LENGTH = 16 // 128-bit salt
const KEY_LENGTH = 32 // 256-bit derived key
const ITERATIONS = 100_000
const HASH = 'SHA-256'

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

async function deriveKey(password: string, salt: ArrayBuffer): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const passwordBuffer = enc.encode(password)

  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: HASH,
    },
    baseKey,
    KEY_LENGTH * 8 // bits
  )
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Invalid password')
  }

  const maxLength = 128
  if (password.length > maxLength) {
    throw new Error('Password too long')
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const derivedKey = await deriveKey(password, saltBytes.buffer)

  // Store as salt_hex:derived_key_hex
  return `${bufferToHex(saltBytes.buffer)}:${bufferToHex(derivedKey)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || !stored) return false

  try {
    const colonIndex = stored.indexOf(':')
    if (colonIndex === -1) return false

    const saltHex = stored.slice(0, colonIndex)
    const expectedHex = stored.slice(colonIndex + 1)

    // Validate hex strings
    if (saltHex.length !== SALT_LENGTH * 2 || expectedHex.length !== KEY_LENGTH * 2) return false
    if (!/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(expectedHex)) return false

    const salt = hexToBuffer(saltHex)
    const derivedKey = await deriveKey(password, salt)
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