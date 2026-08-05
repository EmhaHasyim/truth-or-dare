// Mem-push secret dari `.dev.vars` ke Worker production secara non-interaktif.
// Dijalankan otomatis sebagai bagian dari `bun run deploy`.
//
// - Binding (DB, ROOM_DO) sudah didefinisikan di wrangler.jsonc dan ter-deploy
//   otomatis — tidak ada yang perlu dilakukan di sini.
// - Setiap key LAIN di `.dev.vars` dianggap secret runtime Worker dan di-push
//   dengan `wrangler secret put` (nilai dialirkan via stdin, tanpa prompt).
// - Key `CLOUDFLARE_*` hanya untuk tooling dev (drizzle.config.ts) dan di-skip.
// - Key yang tidak cocok pola nama variabel (huruf/angka/underscore) ditolak
//   untuk mencegah command injection dan nama secret yang ilegal.
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { parseDevVars } from './dev-vars'

const DEV_VARS_FILE = '.dev.vars'

// Key yang hanya dipakai tooling dev lokal (drizzle-kit) — jangan di-push ke prod.
const SKIP_KEYS = new Set([
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_DATABASE_ID',
  'CLOUDFLARE_D1_TOKEN',
])

// Nama key yang legal untuk `wrangler secret put` (sekali gus mencegah
// command injection karena key ikut di-interpolasi ke shell command).
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

if (!existsSync(DEV_VARS_FILE)) {
  console.error(`✖ ${DEV_VARS_FILE} tidak ditemukan. Buat dulu (salin dari .dev.vars.example).`)
  process.exit(1)
}

const all = parseDevVars(DEV_VARS_FILE)
const toSync = all.filter(({ key }) => !SKIP_KEYS.has(key))

const invalid = toSync.filter(({ key }) => !KEY_PATTERN.test(key))
if (invalid.length > 0) {
  console.error(
    `✖ Nama key tidak valid di ${DEV_VARS_FILE}: ${invalid.map((v) => v.key).join(', ')}.\n` +
      'Key hanya boleh terdiri dari huruf, angka, dan underscore (diawali huruf/underscore).',
  )
  process.exit(1)
}

const empty = toSync.filter(({ value }) => value.length === 0)

if (empty.length > 0) {
  console.warn(`⚠ Lewati (nilai kosong): ${empty.map((v) => v.key).join(', ')}`)
}

const secrets = toSync.filter(({ value }) => value.length > 0)

if (secrets.length === 0) {
  console.log(
    'Tidak ada secret runtime di .dev.vars — binding (DB, ROOM_DO) sudah otomatis dari wrangler.jsonc.',
  )
  process.exit(0)
}

for (const { key, value } of secrets) {
  console.log(`→ Push secret "${key}" ...`)
  // Opsi `input` mengalirkan nilai ke stdin wrangler → non-interaktif.
  execSync(`wrangler secret put ${key}`, {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}

console.log(`✔ ${secrets.length} secret ter-sync ke production.`)
