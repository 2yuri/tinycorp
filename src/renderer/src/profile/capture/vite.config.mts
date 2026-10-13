// Serves the renderer on its own, so `profile-capture.html` can be screenshotted in a browser:
// `npx vite --config src/renderer/src/profile/capture/vite.config.mts`.
import { fileURLToPath } from 'node:url'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  // The page is built from Tailwind utilities (T210f), so the harness compiles them too — a harness
  // that renders a screen differently from the app is the drift `design:compare` exists to catch.
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify('0.4.2') },
  server: { port: 5187, strictPort: true },
})
