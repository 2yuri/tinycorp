import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LogoIcon, LogoMark } from './Logo'

describe('Logo', () => {
  it('draws the Pen building artwork, 34px as the icon and 160px as the mark', () => {
    const icon = renderToStaticMarkup(<LogoIcon />)
    const mark = renderToStaticMarkup(<LogoMark />)

    expect(icon).toMatch(/^<svg[^>]*width="34" height="34" viewBox="0 0 160 160"/)
    expect(mark).toMatch(/^<svg[^>]*width="160" height="160" viewBox="0 0 160 160"/)
    for (const html of [icon, mark]) {
      expect(html.match(/<path /g)).toHaveLength(65)
      for (const fill of ['#BBCAD4', '#43667C', '#FFD18E', '#5BCD63', '#0B243E']) expect(html).toContain(fill)
      expect(html).toContain('aria-hidden="true"')
    }
  })
})
