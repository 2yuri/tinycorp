import { describe, expect, it } from 'vitest'
import { changedSettings, staleLine } from './spawn-settings'

const NOW = { colleagueVoice: 'plain', notesBudget: 4000, buildStyle: 'standard', caveman: 'off', sandbox: 'off' }
const person = (name: string, busy = false) => ({ employeeId: name.toLowerCase(), name, busy, settings: [] })

describe('what a Session baked in', () => {
  it('names only the settings that moved', () => {
    expect(changedSettings({ ...NOW, colleagueVoice: 'terse' }, NOW)).toEqual(['colleagueVoice'])
    expect(changedSettings({ ...NOW, caveman: 'ultra' }, NOW)).toEqual(['caveman'])
    expect(changedSettings(NOW, NOW)).toEqual([])
    expect(
      changedSettings(
        { colleagueVoice: 'terse', notesBudget: 8000, buildStyle: 'lean', caveman: 'full', sandbox: 'on' },
        NOW,
      ),
    ).toEqual(['colleagueVoice', 'notesBudget', 'buildStyle', 'caveman', 'sandbox'])
  })
})

describe('who is still on the old setting', () => {
  it('says nothing when nobody is', () => {
    expect(staleLine([])).toBe('')
  })

  it('separates who a restart reaches now from who has to finish a turn first', () => {
    expect(staleLine([person('Ada'), person('Iris'), person('Vega', true)])).toBe(
      'Still on the old setting: Ada and Iris. Vega gets it when its turn ends.',
    )
  })

  it('writes one busy Employee and several the way a sentence does', () => {
    expect(staleLine([person('Vega', true), person('Iris', true)])).toBe('Vega and Iris get it when their turns end.')
    expect(staleLine([person('Ada')])).toBe('Still on the old setting: Ada.')
  })
})
