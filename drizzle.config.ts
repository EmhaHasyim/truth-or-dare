import { defineConfig } from 'drizzle-kit'
import { loadDevVarsIntoEnv } from './scripts/dev-vars'

// Sumber nilai yang sama dengan `vite dev`: key di `.dev.vars`
// (lihat .dev.vars.example) otomatis tersedia untuk drizzle-kit juga,
// jadi tidak perlu export manual / file .env terpisah.
loadDevVarsIntoEnv()

// Kredensial Cloudflare D1 WAJIB ada di `.dev.vars`. Semua perintah
// drizzle-kit (generate/studio/push/migrate) butuh ini — `generate` hanya
// butuh driver d1-http terkonfigurasi, sedangkan `studio`/`push`/`migrate`
// benar-benar menyambung ke D1 remote.
//
// Catatan: untuk migrasi D1 LOKAL (Miniflare di .wrangler/state), pakai
// `wrangler d1 migrations apply --local` (script `db:migrate`) — drizzle-kit
// tidak bisa menjangkau DB lokal tersebut, hanya D1 remote.
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const databaseId = process.env.CLOUDFLARE_DATABASE_ID
const token = process.env.CLOUDFLARE_D1_TOKEN

if (!accountId || !databaseId || !token) {
  console.error(
    '✖ Kredensial Cloudflare belum lengkap di .dev.vars.\n' +
      '  Salin .dev.vars.example menjadi .dev.vars, lalu isi:\n' +
      '    CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, CLOUDFLARE_D1_TOKEN',
  )
  process.exit(1)
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId,
    databaseId,
    token,
  },
})
