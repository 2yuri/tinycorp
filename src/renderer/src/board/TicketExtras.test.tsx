import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { labelColor, normalizeLabels } from '../../../shared/ticket-extras'
import { BaseBranchField, DOT_INK, EpicColorField, LabelsField, PriorityField } from './TicketExtras'

const noop = () => {}
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('Ticket extras fields', () => {
  it('render the priority select with every priority, the flag toned by the value', () => {
    const html = renderToStaticMarkup(<PriorityField value="high" onChange={noop} />)
    expect(textOf(html)).toBe('Priority Low Normal High Urgent')
    expect(html).toContain('text-status-warning-foreground')
    expect(html).toMatch(/<option value="high" selected="">High<\/option>/)
  })

  it('render the base branch input with the repo default as placeholder', () => {
    const html = renderToStaticMarkup(<BaseBranchField value="" onChange={noop} />)
    expect(textOf(html)).toContain('Base branch')
    expect(html).toContain('placeholder="Repo default"')
  })

  it('render label chips with their dots and an Add label pill', () => {
    const html = renderToStaticMarkup(<LabelsField value={['bug', 'checkout']} onChange={noop} />)
    expect(textOf(html)).toBe('Labels bug checkout Add label')
    // The dot takes the label's own colour, which is a token now rather than a modifier.
    expect(html).toContain(DOT_INK[labelColor('bug')])
    expect(html).toContain('aria-label="Remove label bug"')
  })

  it('render one swatch per epic colour, the chosen one checked', () => {
    const html = renderToStaticMarkup(<EpicColorField value="green" onChange={noop} />)
    expect(html.match(/type="radio"/g)).toHaveLength(6)
    expect(html).toMatch(/aria-label="green"[^>]*checked=""/)
  })
})

describe('Label helpers', () => {
  it('give a label the same colour whatever its case, spread over the palette', () => {
    expect(labelColor('Bug')).toBe(labelColor('bug'))
    const colours = new Set(['bug', 'checkout', 'p1', 'regression', 'p0', 'feature'].map(labelColor))
    expect(colours.size).toBeGreaterThanOrEqual(4)
  })

  it('trim labels and drop blanks and case duplicates', () => {
    expect(normalizeLabels([' bug ', 'BUG', '', 'needs  review'])).toEqual(['bug', 'needs review'])
  })
})
