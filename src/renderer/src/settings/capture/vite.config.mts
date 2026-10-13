// Serves the renderer on its own, so `settings-capture.html` can be screenshotted in a browser:
// `npx vite --config src/renderer/src/settings/capture/vite.config.mts`.
import { fileURLToPath } from 'node:url'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  // A harness that renders a screen differently from the app is the drift `design:compare` exists
  // to catch, so every harness that draws a migrated screen compiles the utilities too. The
  // migration adds one of these per harness, and a harness that is missing it draws a screen with
  // no CSS at all rather than failing — which is how `your-profile` moved under T210b.
  // The Add-ons tab is built from Tailwind utilities (T206), so the harness compiles them too —
  // a harness that renders a screen differently from the app is the drift `design:compare` exists
  // to catch. The Memory, drawer and Files harnesses compile it for the same reason since T210e;
  // the profile one does not, because nothing it draws is on utilities yet.
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify('capture') },
  server: { port: 5185, strictPort: true },
})
