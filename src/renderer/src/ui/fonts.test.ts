import interCss from '@fontsource-variable/inter/index.css?raw'
import monoCss from '@fontsource-variable/jetbrains-mono/index.css?raw'
import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import fontsSource from './fonts.ts?raw'
import tailwindCss from './tailwind.css?raw'

describe('fonts', () => {
  it('bundles Inter and JetBrains Mono from local variable font files', () => {
    expect(fontsSource).toContain("import '@fontsource-variable/inter")
    expect(fontsSource).toContain("import '@fontsource-variable/jetbrains-mono")
    // Not in the sheet every component imports: a page that draws no text loads no face (T216).
    expect(tailwindCss).not.toContain('@fontsource')
    for (const css of [interCss, monoCss]) {
      const sources = [...css.matchAll(/url\(([^)]+)\)/g)].map(([, url]) => url!)
      expect(sources.length).toBeGreaterThan(0)
      for (const url of sources) expect(url).toMatch(/^\.\/files\/.+\.woff2$/)
    }
    expect(interCss).toContain("font-family: 'Inter Variable'")
    expect(monoCss).toContain("font-family: 'JetBrains Mono Variable'")
  })

  it('sets the app font families from the tokens', () => {
    expect(tailwindCss).toMatch(/font-family:\s*var\(--font-primary\)/)
    expect(tailwindCss).toMatch(/code,[^{]*\{[^}]*font-family:\s*var\(--font-mono\)/)
  })

  it('never loads fonts from the network and keeps the CSP same-origin', () => {
    expect(tailwindCss).not.toMatch(/https?:/)
    expect(indexHtml).not.toMatch(/fonts\.googleapis|fonts\.gstatic/)
    expect(indexHtml).toContain("default-src 'self'")
  })

  it('lets the bundled fonts load, files and inlined ones alike', () => {
    // Vite inlines a subset small enough to fit under its limit — JetBrains Mono's Cyrillic is one
    // — as a `data:` URL, and leaves the rest as files beside the stylesheet. Without `font-src`
    // the packaged app falls back to `default-src 'self'`, which takes the files and blocks the
    // inlined one: `Loading the font 'data:font/woff2;base64,…' violates … "default-src 'self'"`,
    // read off the built app's console. The directive is declared, so neither is blocked.
    expect(indexHtml).toContain("font-src 'self' data:")
  })
})
