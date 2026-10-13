import { describe, expect, it } from 'vitest'
import { type ChannelRemoval, canDeleteChannel, deleteChannelBody, deleteChannelTitle } from './channel-removal'
import { dmChannelId } from './domain/chat'

const removal = (over: Partial<ChannelRemoval> = {}): ChannelRemoval => ({
  channelId: 'epic-4-checkout',
  name: 'epic-4-checkout',
  messages: 12,
  epicId: 4,
  ...over,
})

describe('What the boss may delete', () => {
  it('leaves the Company’s own channels, which the instructions name', () => {
    for (const id of ['general', 'tech', 'prs']) {
      expect(canDeleteChannel({ id, kind: 'channel' })).toBe(false)
    }
  })

  it('leaves a DM, which belongs to the two people in it', () => {
    expect(canDeleteChannel({ id: dmChannelId('boss', 'e-ada'), kind: 'dm' })).toBe(false)
  })

  it('offers every other channel, an epic’s included', () => {
    expect(canDeleteChannel({ id: 'epic-4-checkout', kind: 'channel' })).toBe(true)
    expect(canDeleteChannel({ id: 'design', kind: 'channel' })).toBe(true)
  })
})

describe('The confirmation', () => {
  it('names the channel and how many messages go with it', () => {
    expect(deleteChannelTitle(removal())).toBe('Delete #epic-4-checkout?')
    expect(deleteChannelBody(removal())).toContain('#epic-4-checkout')
    expect(deleteChannelBody(removal())).toContain('12 messages')
    expect(deleteChannelBody(removal({ messages: 1 }))).toContain('1 message')
  })

  it('says a channel with nothing in it has no messages yet', () => {
    const body = deleteChannelBody(removal({ messages: 0 }))

    expect(body).toContain('no messages yet')
    expect(body).not.toContain('0 messages')
  })

  it('says the epic keeps going, and only when there is one', () => {
    expect(deleteChannelBody(removal())).toContain('Epic 4 keeps its tickets')
    expect(deleteChannelBody(removal({ epicId: null }))).not.toContain('Epic')
  })

  it('warns that this cannot be undone', () => {
    expect(deleteChannelBody(removal())).toContain('cannot be undone')
  })
})
