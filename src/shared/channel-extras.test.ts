import { describe, expect, it } from 'vitest'
import {
  isNamedChannel,
  normalizeSearch,
  normalizeTopic,
  pinIconLabel,
  pinnedLabel,
  searchLabel,
  searchSnippet,
  TOPIC_MAX,
} from './channel-extras'

describe('A topic as it is stored', () => {
  it('trims it and collapses the runs of space a paste brings', () => {
    expect(normalizeTopic('  How we   build\nit.  ')).toBe('How we build it.')
  })

  it('cuts one that would not fit the header subtitle', () => {
    const topic = normalizeTopic('x'.repeat(TOPIC_MAX + 50))

    expect(topic).toHaveLength(TOPIC_MAX)
  })

  it('takes anything that is not a string for no topic at all', () => {
    expect(normalizeTopic(undefined)).toBe('')
    expect(normalizeTopic(42)).toBe('')
  })
})

describe('The search text', () => {
  it('is trimmed, and empty when there is nothing to look for', () => {
    expect(normalizeSearch('  migration ')).toBe('migration')
    expect(normalizeSearch('   ')).toBe('')
    expect(normalizeSearch(null)).toBe('')
  })
})

describe('What the panels say', () => {
  it('counts the pins in words', () => {
    expect(pinnedLabel(0)).toBe('No pinned messages')
    expect(pinnedLabel(1)).toBe('1 pinned message')
    expect(pinnedLabel(4)).toBe('4 pinned messages')
  })

  it('carries the pin count on the header icon', () => {
    expect(pinIconLabel(0)).toBe('Pinned messages')
    expect(pinIconLabel(3)).toBe('Pinned messages (3)')
  })

  it('names what was looked for', () => {
    expect(searchLabel(0, '  ')).toBe('Search this channel')
    expect(searchLabel(0, 'index')).toBe('No message matches “index”')
    expect(searchLabel(1, 'index')).toBe('1 message matches “index”')
    expect(searchLabel(3, 'index')).toBe('3 messages match “index”')
  })
})

describe('A result line', () => {
  it('puts the match in the middle, whatever the case it was written in', () => {
    expect(searchSnippet('The Migration is named', 'migration')).toEqual({
      before: 'The ',
      match: 'Migration',
      after: ' is named',
    })
  })

  it('cuts a long body either side and says it was cut', () => {
    const snippet = searchSnippet(`${'a'.repeat(100)} needle ${'b'.repeat(100)}`, 'needle')

    expect(snippet.before.startsWith('…')).toBe(true)
    expect(snippet.match).toBe('needle')
    expect(snippet.after.endsWith('…')).toBe(true)
  })

  it('gives back a body with no match whole', () => {
    expect(searchSnippet('nothing here', 'needle')).toEqual({ before: 'nothing here', match: '', after: '' })
  })
})

describe('Which channels the boss may set a topic and members on', () => {
  it('is every named channel, and never a DM', () => {
    expect(isNamedChannel('general')).toBe(true)
    expect(isNamedChannel('epic-4-checkout')).toBe(true)
    expect(isNamedChannel('dm:boss:e-ada')).toBe(false)
  })
})
