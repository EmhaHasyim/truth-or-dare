import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import solidPlugin from 'vite-plugin-solid'

// Solid plugin is needed in tests too for .tsx file imports
const isTest = process.env.VITEST === 'true'

export default defineConfig({
  plugins: [!isTest && devtools(), tailwindcss(), !isTest && cloudflare(), solidPlugin()].filter(
    Boolean,
  ),
  server: {
    port: 3000,
  },
})
