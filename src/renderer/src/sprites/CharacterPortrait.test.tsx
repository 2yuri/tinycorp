import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const looks = vi.hoisted(() => ({ value: null as { src: string; width: number; height: number }[] | null }))
vi.mock('./character-looks', () => ({ useCharacterLooks: () => looks.value }))

const { CharacterPortrait } = await import('./CharacterPortrait')

const sheet = [
  { src: 'data:image/png;base64,zero', width: 77, height: 169 },
  { src: 'data:image/png;base64,one', width: 83, height: 169 },
]

beforeEach(() => {
  looks.value = null
})

describe('a pixel character drawn outside the office', () => {
  it('draws the sprite the Employee walks in on, cut from the office sheet', () => {
    looks.value = sheet

    expect(renderToStaticMarkup(<CharacterPortrait sprite={1} />)).toContain(sheet[1]!.src)
  })

  it('wraps round the sheet, so a sprite index past the last one still has a character', () => {
    looks.value = sheet

    expect(renderToStaticMarkup(<CharacterPortrait sprite={2} />)).toContain(sheet[0]!.src)
    expect(renderToStaticMarkup(<CharacterPortrait sprite={-1} />)).toContain(sheet[1]!.src)
  })

  it('takes the face crop from the same frame, so the tile shows the head', () => {
    looks.value = sheet
    const html = renderToStaticMarkup(<CharacterPortrait sprite={0} className="character-portrait--face" />)

    // The caller's class comes last, so its rule lands on top of the portrait's own utilities.
    expect(html).toMatch(/class="[^"]* character-portrait--face"/)
  })

  it('never smooths the pixels, however big the tile it is drawn in', () => {
    looks.value = sheet

    // The one declaration a pixel character cannot lose: `image-rendering: pixelated`. As a
    // stylesheet rule it was unmissable; as a utility it is a class name that has to be there.
    expect(renderToStaticMarkup(<CharacterPortrait sprite={0} />)).toContain('[image-rendering:pixelated]')
  })

  it('stands the fallback in until the sheet is decoded, and keeps the slot without one', () => {
    expect(renderToStaticMarkup(<CharacterPortrait sprite={0} fallback={<span>AB</span>} />)).toBe('<span>AB</span>')
    expect(renderToStaticMarkup(<CharacterPortrait sprite={0} />)).not.toContain('<img')
  })
})
