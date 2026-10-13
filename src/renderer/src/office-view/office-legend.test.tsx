import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OFFICE_LEGEND } from '../../../shared/office/legend'
import { type SpriteState, STATE_LABEL } from '../../../shared/office/projection'
import { SESSION_STATUSES } from '../../../shared/session'
import { DOT_TONE, OfficeLegend } from './OfficeLegend'

describe('OfficeLegend', () => {
  it('explains every state a sprite can be in, once each', () => {
    const states = OFFICE_LEGEND.map((entry) => entry.state)
    const all: SpriteState[] = [...(Object.keys(STATE_LABEL) as SpriteState[])]

    expect(new Set(states).size).toBe(states.length)
    expect([...states].sort()).toEqual([...all].sort())
    // Every Session status the engine can report has a row.
    expect(SESSION_STATUSES.every((status) => status === 'busy' || states.includes(status))).toBe(true)
  })

  it('renders each state with its label, its meaning and a tone dot', () => {
    const html = renderToStaticMarkup(<OfficeLegend />)

    expect(html).toContain('>Legend</summary>')
    for (const entry of OFFICE_LEGEND) {
      expect(html, entry.state).toContain(`data-state="${entry.state}"`)
      expect(html, entry.state).toContain(DOT_TONE[entry.tone])
    }
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    expect(text).toContain('In a meeting with …')
    expect(text).toContain('Waiting on you')
    expect(text).toContain('an approval of theirs needs your call')
    expect(text).toContain('Blocked')
    expect(text).toContain('Out of budget')
  })

  it('stays closed until it is opened, so it never covers the room', () => {
    expect(renderToStaticMarkup(<OfficeLegend />)).not.toContain('open')
  })
})

describe('the legend panel', () => {
  it('keeps its summary in place so a second click closes it', () => {
    // Column-reverse: the list opens above the summary instead of pushing it up the screen.
    expect(renderToStaticMarkup(<OfficeLegend />)).toContain('flex-col-reverse')
  })
})
