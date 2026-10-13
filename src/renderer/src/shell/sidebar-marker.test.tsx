import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { accentFor } from '../ui'

let Marker: typeof import('./Sidebar').Marker

beforeAll(async () => {
  // The sidebar reads the preload API when it loads; a marker never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { company: {}, companies: {} } }
  ;({ Marker } = await import('./Sidebar'))
})

describe('a sidebar DM row', () => {
  it('draws the Employee’s character on their accent, the same one chat gives them', () => {
    const html = renderToStaticMarkup(
      <Marker marker={{ kind: 'avatar', name: 'Ada Byron', employeeId: 'e-ada', sprite: 2 }} />,
    )

    expect(html).toContain(`data-accent="${accentFor('e-ada')}"`)
    expect(html).toContain('--ui-avatar-size:20px')
    expect(html).toContain('AB')
  })

  it('leaves the other markers alone', () => {
    expect(renderToStaticMarkup(<Marker marker={{ kind: 'hash' }} />)).toContain('data-ui="Hash"')
    expect(renderToStaticMarkup(<Marker marker={{ kind: 'dot' }} />)).toContain('data-ui="Dot"')
  })
})
