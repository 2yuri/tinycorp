import { readFileSync } from 'node:fs'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    // Tailwind is on trial on one screen (T206); `ui/tailwind.css` is the whole of its setup.
    plugins: [react(), tailwind()],
    // The Launcher's footer shows it.
    define: { __APP_VERSION__: JSON.stringify(version) },
  },
})
