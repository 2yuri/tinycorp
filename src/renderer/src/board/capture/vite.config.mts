// Serves the renderer on its own, so `board-capture.html` can be screenshotted in a browser:
// `npx vite --config src/renderer/src/board/capture/vite.config.mts`.
import { fileURLToPath } from 'node:url'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  // The window's own frame is built from Tailwind utilities (T210f), and every harness draws some
  // of it, so each compiles them too — a harness that renders a screen differently from the app is
  // the drift `design:compare` exists to catch.
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify('capture') },
  server: { port: 5190, strictPort: true },
})
