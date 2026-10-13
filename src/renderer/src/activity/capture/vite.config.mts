// Serves the renderer on its own, so `activity-capture.html` can be screenshotted in a browser:
// `npx vite --config src/renderer/src/activity/capture/vite.config.mts`.
import { fileURLToPath } from 'node:url'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  // The feed and its rail are built from Tailwind utilities (T210f), so the harness compiles them
  // too — a harness that renders a screen differently from the app is the drift `design:compare`
  // exists to catch.
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify('capture') },
  server: { port: 5186, strictPort: true },
})
