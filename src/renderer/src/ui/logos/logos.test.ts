import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MCP_PRESETS } from '../../../../shared/catalogue/mcp-presets'
import { PROVIDER_CATALOGUE } from '../../../../shared/domain/providers'
import { logoUrl, vendoredLogos } from './logo-assets'

/**
 * Every logo this repo ships is one somebody asked for, and every logo somebody asked for is here.
 *
 * Two ways to be wrong, and neither shows up on a screen you happen to open. A catalogue entry
 * that names a file nobody vendored draws its generic mark instead, quietly, for the one Provider
 * or the one preset nobody looked at again. A file nobody names sits in the bundle and in the
 * licence notice, and is a logo this repo distributes for no reason — which is the half of it that
 * `docs/brand-logos.md` is actually about.
 *
 * So the folder is read from disk and the catalogues are read from `shared`, and the two sets have
 * to be the same set. {@link vendoredLogos} is read as well, because that is the bundler's answer
 * rather than the filesystem's: a file that is on disk and not in the glob would draw nothing.
 */

const FOLDER = import.meta.dirname

/** What is really in the folder, by file name without the extension. */
function onDisk(): string[] {
  return readdirSync(FOLDER)
    .filter((name) => name.endsWith('.svg'))
    .map((name) => name.replace(/\.svg$/, ''))
    .sort()
}

/** Every logo any catalogue names, once. */
function named(): string[] {
  return [
    ...new Set([
      ...PROVIDER_CATALOGUE.flatMap((entry) => (entry.logo ? [entry.logo] : [])),
      ...MCP_PRESETS.flatMap((preset) => (preset.logo ? [preset.logo] : [])),
    ]),
  ].sort()
}

describe('The vendored logos', () => {
  it('are exactly the ones a Provider or a preset asks for', () => {
    expect(onDisk()).toEqual(named())
  })

  it('are all reachable through the bundler, not just present on disk', () => {
    expect(vendoredLogos()).toEqual(onDisk())
  })

  it('each answer with a URL when asked for by the name the catalogue gave', () => {
    for (const name of named()) expect(logoUrl(name), `${name}.svg`).toBeTruthy()
  })

  it('answer with nothing for a name no file carries, so a mark stands in rather than a broken image', () => {
    expect(logoUrl('a-product-nobody-vendored')).toBeNull()
    expect(logoUrl(null)).toBeNull()
    expect(logoUrl(undefined)).toBeNull()
  })

  it('are the two colours a mark comes in, and nothing in between', () => {
    // `Logo.tsx` reads the `-color` suffix to decide whether to invert a mark under the dark
    // theme, so a file's name has to really say which variant it is. A colour file carries at
    // least one colour of its own; a monochrome one carries none — it is black, or it asks for
    // `currentColor`, which in an `<img>` is black.
    for (const name of onDisk()) {
      const svg = readFileSync(join(FOLDER, `${name}.svg`), 'utf8')
      const coloured = /fill="(?!none|currentColor|#000)/i.test(svg) || svg.includes('linearGradient')
      expect(coloured, `${name}.svg`).toBe(name.endsWith('-color'))
    }
  })

  it('has something to look for, so the check cannot pass by finding nothing', () => {
    expect(named().length).toBeGreaterThan(5)
    expect(onDisk().filter((name) => name.endsWith('-color')).length).toBeGreaterThan(0)
    expect(onDisk().filter((name) => !name.endsWith('-color')).length).toBeGreaterThan(0)
  })
})
