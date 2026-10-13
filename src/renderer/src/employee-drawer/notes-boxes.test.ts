import { describe, expect, it } from 'vitest'
import panel from './NotesPanel.tsx?raw'

/**
 * The boxes the drawer's Memory tab draws, read off the class lists the tab writes (frame `x40RJd`).
 *
 * This read `memory.css` until T210e moved the tab onto utilities. A stylesheet said
 * `font-size: 12px; line-height: 15px`; a class list says `text-12/15`, and the modifier after the
 * slash is the box — so the same twelve pairs are pinned, against the same frame, and the sweep at
 * the end still refuses a size with no box.
 *
 * T203b found the same bug once per Company settings tab: a line of text left on
 * `line-height: normal` is as tall as the font says, and the frame draws it as tall as Pen says.
 * One pixel per label, and a column of six ends six pixels below the frame's with every band
 * inside it looking right. This tab is a column of eleven, so the rule holds here too — and the
 * cheapest way to keep it is to refuse a text rule that does not say how tall its line is.
 */

interface List {
  name: string
  classes: string
}

/** Every module-level class list in the tab, by the name the component gives it. */
const LISTS: List[] = [...panel.matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]*) =\s*(?:'|String\.raw`)([^'`]*)/gm)].map(
  ([, name = '', classes = '']) => ({ name, classes }),
)

function body(name: string): string {
  const list = LISTS.find((candidate) => candidate.name === name)
  if (!list) throw new Error(`NotesPanel.tsx has no class list called ${name}`)
  return list.classes
}

/** `text-12-5/18` as the pair it stands for: 12.5px of type on an 18px line. */
function box(name: string): { size: number; line: number } {
  const found = /text-(\d+(?:-\d)?)\/(\d+)\b/.exec(body(name))
  if (!found) throw new Error(`${name} does not say both its font size and its line box`)
  return { size: Number((found[1] ?? '').replace('-', '.')), line: Number(found[2]) }
}

/**
 * The rules that draw text in this tab, and the box the frame gives each of them.
 *
 * Every pair here is the frame's own, read out of the Pen document rather than off its export
 * (T204): a line box measured by eye off a 1x PNG is right to about two pixels, and eleven of them
 * in a column is how this tab came to score 7.5% with every band in it looking about right.
 */
const BOXES: Record<string, { size: number; line: number }> = {
  METER_TITLE: { size: 12, line: 15 },
  METER_COUNT: { size: 11.5, line: 14 },
  METER_NOTE: { size: 11, line: 16 },
  SECTION: { size: 10.5, line: 13 },
  WHEN: { size: 11, line: 15 },
  TEXT: { size: 12.5, line: 18 },
  BADGE: { size: 12, line: 15 },
  NODE_RANGE: { size: 11, line: 15 },
  NODE_DAYS: { size: 11, line: 13 },
  NODE_TEXT: { size: 12, line: 17 },
  DUE: { size: 11, line: 13 },
  COUNT: { size: 11, line: 13 },
}

describe('The Memory tab’s text', () => {
  it('draws every line in the box the frame gives it, and none on `normal`', () => {
    for (const [name, wanted] of Object.entries(BOXES)) {
      expect(box(name), name).toEqual(wanted)
    }
  })

  /**
   * The rule the list above is a list of. A new label added without a line box is a pixel the next
   * auditor spends an afternoon on, so the check is on every rule rather than on the ones we
   * happened to write down.
   */
  it('leaves no rule with a font size and no line box', () => {
    // `text-11` takes the type scale's own leading and `text-11/[normal]` asks for the thing the
    // frame disagrees with. In this tab neither is ever right.
    const loose = LISTS.filter((list) => /text-\d+(?:-\d)?(?![\d-])(?!\/\d)/.test(list.classes)).map(
      (list) => list.name,
    )

    expect(loose, 'these lists size their text and leave its line box to the font').toEqual([])
  })

  /** The notes are the tab's own words; the summaries under them are half a point smaller. */
  it('draws a summary a size under the notes above it, which is how the frame fits one in two lines', () => {
    expect(box('NODE_TEXT').size).toBeLessThan(box('TEXT').size)
  })

  /**
   * The meter's count is the one line in this tab that was set in the mono face, and it is the one
   * the frame sets in the primary face: `≈` is not in JetBrains Mono, so the count the boss read
   * said `= 3.1k of 4k tokens` — a different claim from the one the sentence makes.
   */
  it('sets the meter’s count in the face the rest of the tab is set in', () => {
    expect(body('METER_COUNT')).not.toMatch(/font-code/)
    expect(body('WHEN')).toMatch(/font-code/)
  })
})
