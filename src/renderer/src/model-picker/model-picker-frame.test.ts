import { describe, expect, it } from 'vitest'
import menuSource from '../ui/kit/Menu.tsx?raw'
import tailwindCss from '../ui/tailwind.css?raw'
import tokensCss from '../ui/tokens.css?raw'
import pickerSource from './ModelPicker.tsx?raw'

/**
 * MODEL and EFFORT against their frame (`CLSj9`, T150). The design audit found the open catalogue's
 * outline scrolling away with its rows, and the chip, the EFFORT track, the rows and two lines of
 * type each a few pixels off the frame — every one of them drawn the other way with no test
 * watching.
 *
 * The measurements used to be read out of `model-picker.css`. They are class lists on the component
 * now (T210f), so they are read out of the component — and a number in one of them is a number of
 * pixels only because the spacing step is the pixel, which is the first thing this file pins.
 * `ui/tailwind.test.ts` is what says each of these classes compiles to a rule at all.
 */

/** The component's named class lists, each by the name it is declared under. */
const LISTS = new Map(
  [...pickerSource.matchAll(/^const ([A-Z][A-Z0-9_]*) =\s*(?:'([^']*)'|"([^"]*)"|String\.raw`([^`]*)`)/gm)].map(
    ([, name, single, double, raw]) => [name ?? '', single ?? double ?? raw ?? ''],
  ),
)

function list(name: string): string {
  const found = LISTS.get(name)
  expect(found, name).toBeTypeOf('string')
  return found ?? ''
}

describe('the pixel', () => {
  it('is the spacing step, so `h-19` in a class list is 19px on the screen', () => {
    expect(tailwindCss).toMatch(/--spacing:\s*1px/)
  })
})

describe('the open catalogue', () => {
  it('scrolls, so its edge must be one that stays on the card', () => {
    expect(list('MENU')).toContain('overflow-auto')
    // An absolute pseudo-element inside a scroller scrolls with the content: the top edge vanished
    // and the bottom one was drawn across the last group. The kit draws it as the box's own
    // outline instead, which is on the element and cannot scroll away from it (T216).
    expect(menuSource).not.toMatch(/\bafter:|before:/)
    const menu = /^const MENU =\s*\n?\s*'([^']*)'/m.exec(menuSource)?.[1] ?? ''
    expect(menu).toContain('outline-1')
    expect(menu).toContain('outline-border')
    expect(menu).toContain('-outline-offset-1')
  })

  it('draws the frame’s 32px rows: 8px, a 16px line, 8px', () => {
    const row = list('ROW')
    expect(row).toContain('py-8')
    expect(row).toContain('pr-10')
    // `text-13-5` is 13.5px on a 16px line: the scale's own leading is the frame's here.
    expect(row).toContain('text-13-5')
    expect(tokensCss).toContain('--type-13-5-leading: 16px')
    // The ticked row carries the other half of the padding; the plain one keeps its indent.
    expect(list('CURRENT_ROW')).toContain('pl-10')
  })
})

describe('the closed field', () => {
  it('draws the provider chip 19px tall, not 24', () => {
    expect(list('CHIP')).toContain('h-19')
  })

  it('sets the line under a field that cannot start at the frame’s 11px', () => {
    expect(pickerSource).toContain('text-11 text-destructive')
    expect(tokensCss).toContain('--type-11: 11px')
  })
})

describe('EFFORT', () => {
  it('is a 34px track: 2px around a 28px level inside its 1px stroke', () => {
    const track = list('TRACK')
    expect(track).toContain('h-34')
    expect(track).toContain('p-2')
    expect(track).toContain('border border-input')
    expect(list('LEVEL')).toContain('h-28')
  })

  it('sets the levels in the frame’s 11.5px mono', () => {
    const level = list('LEVEL')
    expect(level).toContain('font-code')
    expect(level).toContain('text-11-5')
  })

  it('keeps the note for a model with no level in the track’s own box', () => {
    expect(list('NOTE')).toContain('h-34')
  })
})
