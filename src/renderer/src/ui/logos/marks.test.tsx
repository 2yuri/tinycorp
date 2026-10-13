import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MCP_PRESETS } from '../../../../shared/catalogue/mcp-presets'
import { PROVIDER_CATALOGUE } from '../../../../shared/domain/providers'
import { PresetMark } from './PresetMark'
import { ProviderMark } from './ProviderMark'

/**
 * What a mark falls back to, which is the half nobody sees until a Provider lands without a logo.
 *
 * A logo is drawn as an `<img>` of the vendored file; everything else — a Provider whose product
 * has no logo this repo may ship, a preset whose service neither icon set carries, and an id from
 * outside the catalogue — is an inline `<svg>` from the icon set, never an `<img>` with a `src`
 * that does not resolve.
 */

const withLogo = PROVIDER_CATALOGUE.filter((entry) => entry.logo)
const withPresetLogo = MCP_PRESETS.filter((preset) => preset.logo)
const noPresetLogo = MCP_PRESETS.filter((preset) => !preset.logo)

describe('A Provider mark', () => {
  it('is the vendored logo, as an img, for a Provider whose entry names one', () => {
    const html = renderToStaticMarkup(<ProviderMark provider={withLogo[0]?.id ?? ''} size={15} />)
    expect(html).toContain('<img')
    // Vite decides whether a small file is emitted beside the bundle or inlined as a `data:` URI;
    // either way it is the vendored SVG, untouched, behind a `src` — never markup in the page.
    expect(html).toMatch(/src="[^"]*svg/)
    expect(html).toContain('width="15"')
  })

  it('is the generic mark for a Provider the catalogue does not know', () => {
    const html = renderToStaticMarkup(<ProviderMark provider="a-product-nobody-hired" size={15} />)
    expect(html).toContain('<svg')
    expect(html).not.toContain('<img')
  })
})

describe('A preset mark', () => {
  it('is the vendored logo, as an img, for a preset whose entry names one', () => {
    const [preset] = withPresetLogo
    const html = preset ? renderToStaticMarkup(<PresetMark preset={preset} size={14} />) : ''
    expect(html).toContain('<img')
  })

  it('is the generic mark for a service neither icon set carries', () => {
    const [preset] = noPresetLogo
    const html = preset ? renderToStaticMarkup(<PresetMark preset={preset} size={14} />) : ''
    expect(html).toContain('<svg')
    expect(html).not.toContain('<img')
  })
})

describe('The catalogues', () => {
  it('have one of each, so neither case above can pass by finding nothing', () => {
    expect(withLogo.length).toBeGreaterThan(0)
    expect(withPresetLogo.length).toBeGreaterThan(0)
    expect(noPresetLogo.length).toBeGreaterThan(0)
  })
})
