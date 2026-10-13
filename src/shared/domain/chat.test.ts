import { describe, expect, it } from 'vitest'
import { completeMention, dmChannelId, mentionAt, mentionSuggestions, textAddressedToBoss } from './chat'

const people = [
  { id: 'e1', name: 'Ada' },
  { id: 'e2', name: 'Grace Holt' },
  { id: 'e3', name: 'Alan' },
]

describe('Composer @ autocomplete', () => {
  it('finds the mention being typed at the caret', () => {
    expect(mentionAt('hey @Gr', 7)).toEqual({ start: 4, query: 'Gr' })
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionAt('hey @Gr and more', 7)).toEqual({ start: 4, query: 'Gr' })
  })

  it('ignores e-mail addresses and finished mentions', () => {
    expect(mentionAt('mail x@ad', 9)).toBeNull()
    expect(mentionAt('@Ada done', 9)).toBeNull()
    expect(mentionAt('plain text', 10)).toBeNull()
  })

  it('suggests Employees by name prefix, and @channel', () => {
    expect(mentionSuggestions('a', people).map((p) => p.name)).toEqual(['Ada', 'Alan'])
    expect(mentionSuggestions('gr', people).map((p) => p.name)).toEqual(['Grace Holt'])
    expect(mentionSuggestions('ch', people)).toEqual([{ id: 'channel', name: 'channel' }])
    expect(mentionSuggestions('', people)).toHaveLength(4)
  })

  it('replaces the typed mention with the chosen name', () => {
    expect(completeMention('hey @gr, ok', 4, 7, 'Grace Holt')).toEqual({
      text: 'hey @Grace Holt , ok',
      caret: 16,
    })
  })
})

describe('A channel post addressed to the boss', () => {
  const post = (channelId: string, text: string, toBoss = true) =>
    textAddressedToBoss({ channelId, text, toBoss }, people)

  it('names the boss when the Employee says the message is for them', () => {
    expect(post('tech', 'the keys expired, I cannot deploy')).toBe('@boss the keys expired, I cannot deploy')
    expect(post('general', '  TC-14 is merged  ')).toBe('@boss TC-14 is merged')
  })

  it('leaves a post that already names the boss alone', () => {
    expect(post('general', '@boss TC-14 is done')).toBe('@boss TC-14 is done')
    expect(post('tech', 'ping @boss on this')).toBe('ping @boss on this')
  })

  it('leaves a post that was not addressed to the boss alone', () => {
    expect(post('general', '@Ada welcome aboard', false)).toBe('@Ada welcome aboard')
    expect(post('general', 'Welcome, team! First up: checkout.', false)).toBe('Welcome, team! First up: checkout.')
  })

  it('leaves a DM to the boss alone, because it notifies on its own', () => {
    expect(post(dmChannelId('boss', 'e1'), 'blocked on keys')).toBe('blocked on keys')
  })
})
