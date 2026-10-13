import { describe, expect, it } from 'vitest'
import {
  completeHash,
  epicChannelName,
  epicIdOfChannel,
  hashAt,
  hashSegments,
  hashSuggestions,
  parseTicketRefs,
} from './ticket-refs'

const tickets = [
  { id: 3, title: 'Magic link login' },
  { id: 12, title: 'Login page' },
  { id: 120, title: 'Billing' },
]
const channels = ['general', 'tech', 'prs', 'epic-4-login']

describe('Ticket references', () => {
  it('finds each reference once, in order, in both forms', () => {
    expect(parseTicketRefs('#12 blocks #3, see #12 again', 'TC')).toEqual([12, 3])
    expect(parseTicketRefs('(#7).', 'TC')).toEqual([7])
    expect(parseTicketRefs('TC-142 blocks #3 and TC-142 again', 'TC')).toEqual([142, 3])
    expect(parseTicketRefs('(TC-7), #TC-8.', 'TC')).toEqual([7, 8])
  })

  it('reads the key without regard to case, and only its own Company\u2019s', () => {
    expect(parseTicketRefs('tc-142 and TC-9', 'TC')).toEqual([142, 9])
    expect(parseTicketRefs('ZE-142 is another Company\u2019s', 'TC')).toEqual([])
  })

  it('ignores channels, anchors and numbers glued to words', () => {
    expect(parseTicketRefs('#tech a#12 #12b #0 issue#4 #12-foo, but #12.', 'TC')).toEqual([12])
    expect(parseTicketRefs('no refs', 'TC')).toEqual([])
    expect(parseTicketRefs('aTC-142 TC-142b ticket-tc-142-login TC-0', 'TC')).toEqual([])
  })

  it('splits text into plain parts, ticket links and channel links', () => {
    expect(hashSegments('see #12 in #tech and #nope, #99', channels, 'TC')).toEqual([
      { text: 'see ' },
      { text: '#12', ticketId: 12 },
      { text: ' in ' },
      { text: '#tech', channelId: 'tech' },
      { text: ' and #nope, ' },
      { text: '#99', ticketId: 99 },
    ])
    expect(hashSegments('TC-142 needs #tech', channels, 'TC')).toEqual([
      { text: 'TC-142', ticketId: 142 },
      { text: ' needs ' },
      { text: '#tech', channelId: 'tech' },
    ])
    expect(hashSegments('#epic-4-login.', channels, 'TC')).toEqual([
      { text: '#epic-4-login', channelId: 'epic-4-login' },
      { text: '.' },
    ])
  })

  it('names an epic channel after its id and title', () => {
    expect(epicChannelName({ id: 4, title: 'Magic-link Login!' })).toBe('epic-4-magic-link-login')
    expect(epicChannelName({ id: 5, title: '🚀' })).toBe('epic-5')
    expect(epicChannelName({ id: 6, title: 'a'.repeat(80) })).toBe(`epic-6-${'a'.repeat(32)}`)
  })

  it('reads the epic back out of the channel name, and only out of one', () => {
    expect(epicIdOfChannel(epicChannelName({ id: 4, title: 'Magic-link Login!' }))).toBe(4)
    expect(epicIdOfChannel(epicChannelName({ id: 5, title: '🚀' }))).toBe(5)
    expect(epicIdOfChannel('general')).toBeNull()
    expect(epicIdOfChannel('epics-and-more')).toBeNull()
    expect(epicIdOfChannel('epic-0-nothing')).toBeNull()
  })
})

describe('Composer # autocomplete', () => {
  it('finds the # being typed at the caret', () => {
    expect(hashAt('see #1', 6)).toEqual({ start: 4, query: '1' })
    expect(hashAt('#', 1)).toEqual({ start: 0, query: '' })
    expect(hashAt('see #te and more', 7)).toEqual({ start: 4, query: 'te' })
    expect(hashAt('a#1', 3)).toBeNull()
    expect(hashAt('#12 done', 8)).toBeNull()
  })

  it('suggests tickets by id or title, then channels by name', () => {
    expect(hashSuggestions('12', tickets, channels, 'TC')).toEqual([
      { kind: 'ticket', value: '12', insert: 'TC-12', label: 'Login page' },
      { kind: 'ticket', value: '120', insert: 'TC-120', label: 'Billing' },
    ])
    expect(hashSuggestions('log', tickets, channels, 'TC').map((s) => s.value)).toEqual(['3', '12'])
    expect(hashSuggestions('e', tickets, channels, 'TC')).toEqual([
      { kind: 'channel', value: 'epic-4-login', insert: '#epic-4-login', label: 'epic-4-login' },
    ])
    expect(hashSuggestions('', tickets, channels, 'TC')).toHaveLength(7)
  })

  it('finds a ticket by the display id being typed', () => {
    expect(hashSuggestions('tc-1', tickets, channels, 'TC').map((s) => s.insert)).toEqual(['TC-12', 'TC-120'])
  })

  it('replaces the typed reference with the chosen one, as the display id', () => {
    expect(completeHash('see #1, ok', 4, 6, 'TC-12')).toEqual({ text: 'see TC-12 , ok', caret: 10 })
  })
})
