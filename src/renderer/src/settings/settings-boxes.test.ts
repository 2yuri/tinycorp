import { describe, expect, it } from 'vitest'
import { SEGMENTED_TRACK, SETTINGS_CARD_TIGHT, SETTINGS_CARD_TITLE } from '../ui'
import { SAMPLE } from './ColleagueVoiceCard'
import { CHIP_BASE as ENV_CHIP, SIDE as ENV_SIDE } from './EnvironmentsTab'
import { FACT_LABEL as OFFICE_FACT_LABEL } from './OfficeTab'
import { FIELD, FIELD_HINTED, LABEL } from './settings-classes'
import { MODE, FIELD as TESTING_FIELD, REPOS as TESTING_REPOS } from './TestingSetting'
import { RULE as ROUTING_RULE } from './UsageRoutingTab'

/**
 * The boxes the Company settings frames measure, read off the class lists.
 *
 * Twelve pairs of the design audit sat over its floor for one reason, found once per tab: a line
 * of text left on the font's own metrics is as tall as the font says, and the frame draws it as
 * tall as Pen says. One pixel per label, and a column of six ends six pixels below the frame's
 * with every band inside it looking right (T203b). The numbers below are the frames' own.
 *
 * Until T210b these were parsed out of six stylesheets. They are utilities now, so the test reads
 * the lists — and a size written without a line height is the same bug in the new spelling: a bare
 * `text-11` takes the type scale's line, which is not always the frame's.
 */

function utilities(list: string): string[] {
  return list.split(/\s+/).filter(Boolean)
}

/** Every `text-*` utility in a list, with the line height it names after the slash. */
function sizes(list: string): string[] {
  return utilities(list).filter((utility) => /^(\[[^\]]*\]:)*text-\d/.test(utility))
}

/** The all-caps labels these tabs draw: the shared one, and the Office tab's own. */
const ALL_CAPS = [
  ['the settings label', LABEL],
  ['the Office tab\u2019s fact label', OFFICE_FACT_LABEL],
] as const

describe('every all-caps label in Company settings', () => {
  it.each(ALL_CAPS)('says how tall its box is \u2014 %s', (_, list) => {
    // A size on its own takes the scale's line height, which is a pixel out at 11 and at 9.5.
    for (const size of sizes(list)) expect(size, list).toMatch(/\//)
    expect(utilities(list)).toContain('uppercase')
  })

  it('sets the settings frames\u2019 own 11/700 in a 13px box', () => {
    expect(utilities(LABEL)).toEqual(expect.arrayContaining(['text-11/13', 'font-bold', 'tracking-[0.5px]']))
  })

  it('sets the Office tab\u2019s own fact label in the 11px box `V0brJM` draws it in', () => {
    // `V0brJM` sets it at 9.5 with a full pixel of tracking, in its own 11px box.
    expect(utilities(OFFICE_FACT_LABEL)).toEqual(expect.arrayContaining(['text-9-5/11', 'tracking-[1px]']))
  })
})

describe('the boxes the frames measure around a card', () => {
  it('sets the card title in the 17px box every settings frame draws it in', () => {
    // `QgXdU`, `bB6VX`, `L0glbm`, `uApL8` and `zpvHQ` agree, and T192 read 16 off one of them.
    expect(utilities(SETTINGS_CARD_TITLE)).toContain('text-14/17')
  })

  it('keeps 12 between the rows of the one card the General frames draw tighter', () => {
    expect(utilities(SETTINGS_CARD_TIGHT)).toContain('gap-12')
  })

  it('sets the rule beside a Provider\u2019s sign-ins in the 14px box its head is drawn in', () => {
    // `pNdrM` is 14 tall and `MmGYv` stacks its rows 10 under it; on the font's own line the head
    // is 15 and every Provider under it in the Accounts card starts a pixel low.
    expect(utilities(ROUTING_RULE)).toContain('text-11-5/14')
  })

  it('draws the hint under a field on the frame\u2019s line, not the kit\u2019s one-liner', () => {
    expect(FIELD_HINTED).toContain('[&_[data-slot=field-helper]]:text-11/16')
    expect(utilities(FIELD)).toContain('gap-6')
  })
})

describe('the controls the tabs draw for themselves', () => {
  it('gives every segmented track the frame\u2019s 32px and its 26px option', () => {
    // A stroke, 2px of padding, the option, 2px, the stroke: `pEeli`, `tnLRY`, `n9mrNv`, `K8zYH4`.
    // The kit's own track since T213; the routing tab and the Memory list bring their frames'.
    expect(utilities(SEGMENTED_TRACK)).toEqual(expect.arrayContaining(['h-32', 'p-2']))
    expect(utilities(MODE)).toContain('h-26')
    expect(utilities(ENV_CHIP)).toContain('h-28')
  })

  it('measures a sample message\u2019s 12px from its outer edge, so it wraps where the frame wraps', () => {
    // At `12px 14px` inside a 1px stroke the text box was 6px narrower than `L0glbm`'s and the
    // second sample wrapped a word early in all four Tokens states.
    expect(utilities(SAMPLE)).toEqual(expect.arrayContaining(['p-11', 'border', 'border-border']))
  })

  it('groups Who tests and Per repo as the frame groups them, not as five card rows', () => {
    expect(utilities(TESTING_FIELD)).toContain('gap-6')
    expect(utilities(TESTING_REPOS)).toContain('gap-8')
  })

  it('keeps the Environments side panel 16 apart, as the frame\u2019s column is', () => {
    expect(utilities(ENV_SIDE)).toContain('gap-16')
  })
})
