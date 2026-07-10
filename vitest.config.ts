import { defineConfig } from 'vitest/config'
import solidPlugin from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    solidPlugin({ hot: false }),
    tailwindcss(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '.wrangler'],
  },
  resolve: {
    alias: {
      // cloudflare:workers is only available in Workers runtime, not in vitest
      'cloudflare:workers': '@cloudflare/workers-types',
    },
  },
})
