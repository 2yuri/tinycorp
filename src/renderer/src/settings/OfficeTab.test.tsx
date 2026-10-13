import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { isSelectable, ROOMS, roomDesks, roomOf } from '../../../shared/office/rooms'
import { ART_PICKED, OfficeTab, officeTabSubtitle, switchNote } from './OfficeTab'

const render = (props: Partial<Parameters<typeof OfficeTab>[0]> = {}) =>
  renderToStaticMarkup(
    <OfficeTab companyName="Tiny Corp" slug="night-studio" savedSlug="night-studio" onPick={() => {}} {...props} />,
  )

describe('Company settings › Office', () => {
  it('previews the room with what it has over the painting', () => {
    const html = render()
    const nightStudio = roomOf('night-studio')

    expect(html).toContain(`url(./${nightStudio.art})`)
    expect(html).toContain('In use now')
    expect(html).toContain(`${roomDesks(nightStudio.geometry!).total} desks`)
    expect(html).toContain('Meeting room')
    expect(html).toContain('Coffee area')
  })

  it('states the room, its description, its four facts and its palette', () => {
    const html = render()
    const { facts, palette, description } = roomOf('night-studio')

    expect(html).toContain('Night Studio')
    expect(html).toContain(description)
    expect(html).toContain('Desks</dt>')
    expect(html).toContain(facts!.desks)
    expect(html).toContain(facts!.rooms)
    expect(html).toContain(facts!.lightMode)
    expect(html).toContain(facts!.floorSpace)
    for (const swatch of palette) expect(html).toContain(`background:${swatch}`)
  })

  it('offers every room, with the picked one ticked', () => {
    const html = render()

    for (const room of ROOMS) expect(html, room.slug).toContain(room.name)
    // One room is ticked, and it is the one whose thumbnail wears the picked 2px edge.
    expect([...html.matchAll(/checked=""/g)]).toHaveLength(1)
    const option = html.slice(html.lastIndexOf('<label', html.indexOf('checked=""')), html.indexOf('</label>'))
    expect(option).toContain(ART_PICKED)
  })

  it('offers every room of the picker, none of them dimmed any more (T91)', () => {
    const html = render()

    expect(ROOMS.every(isSelectable)).toBe(true)
    expect([...html.matchAll(/Coming soon/g)]).toHaveLength(0)
    expect([...html.matchAll(/disabled=""/g)]).toHaveLength(0)
    for (const room of ROOMS) expect(html, room.slug).toContain(room.name)
  })

  it('lets Night Shift be picked and states its own facts (T85)', () => {
    const html = render({ slug: 'night-shift' })
    const nightShift = roomOf('night-shift')

    expect(isSelectable(nightShift)).toBe(true)
    expect(html).toContain(`url(./${nightShift.art})`)
    expect(html).toContain(`${roomDesks(nightShift.geometry!).total} desks`)
    expect(html).toContain(nightShift.facts!.desks)
    expect(html).toContain(nightShift.facts!.floorSpace)
    const option = html.split('<button').find((part) => part.includes('Night Shift'))!
    expect(option).not.toContain('disabled')
    expect(option).not.toContain('Coming soon')
  })

  it('shows the room the boss just picked while the one in use keeps the chip', () => {
    const html = render({ slug: 'night-studio', savedSlug: 'night-studio' })
    // Only the saved room wears `In use now`; a picked-but-unsaved room does not.
    expect([...html.matchAll(/In use now/g)]).toHaveLength(1)
  })

  it('says what switching does, and does not do, to the team', () => {
    expect(render()).toContain(switchNote('Tiny Corp'))
    expect(switchNote('Tiny Corp')).toBe(
      'Everyone in Tiny Corp sees this room. It swaps on their next office load — Sessions keep running.',
    )
  })

  it('titles the page after the room, as the frame does', () => {
    expect(officeTabSubtitle('Tiny Corp')).toBe(
      'The room every Employee in Tiny Corp works in — and the desks they sit at.',
    )
  })
})
