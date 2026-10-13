// Serves the renderer on its own, so `company-memory-capture.html` and `company-memory-states-capture.html` can be
// screenshotted in a browser:
// `npx vite --config src/renderer/src/memory/capture/vite.config.mts`.
import { fileURLToPath } from 'node:url'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  // One state of this page draws the Activity feed, which is built from Tailwind utilities
  // (T210f), so the harness compiles them too.
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify('capture') },
  server: { port: 5186, strictPort: true },
})
