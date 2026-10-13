import { describe, expect, it } from 'vitest'
import { BOSS, type Channel, dmChannelId, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import type { ChatData } from './chat-view'
import { type ConversationParts, conversationOf } from './conversation'

const vega = { id: 'e-vega', name: 'Vega' } as Employee
const DM = dmChannelId(BOSS, vega.id)

const data = { employees: [vega], approvals: new Map(), board: null, code: [], repos: [], reviews: [] } as ChatData

function message(id: number, channelId: string, threadId: number | null = null): Message {
  return {
    id,
    kind: 'post',
    channelId,
    threadId,
    authorId: vega.id,
    text: `m${id}`,
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: '2026-09-17T09:00:00',
  }
}

function item(fields: Partial<BossInboxItem> & Pick<BossInboxItem, 'kind' | 'channelId' | 'messageId'>): BossInboxItem {
  return {
    id: `m${fields.messageId}`,
    threadId: fields.messageId,
    fromId: vega.id,
    text: '',
    createdAt: '2026-09-17T09:00:00',
    unread: true,
    approvalId: null,
    planId: null,
    testRunId: null,
    ...fields,
  }
}

const channels: Channel[] = [
  { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
  { id: DM, kind: 'dm', name: '', members: [BOSS, vega.id], topic: '' },
]

function parts(fields: Partial<ConversationParts> = {}): ConversationParts {
  return { history: [], thread: [], channels, readMark: 0, ...fields }
}

describe('the conversation an Inbox row opens', () => {
  it('is the DM’s whole history, not the one message the row is about', () => {
    const history = [message(1, DM), message(2, DM), message(3, DM)]
    const conversation = conversationOf(
      item({ kind: 'dm', channelId: DM, messageId: 2 }),
      // The engine answers a thread read for a message with no replies with the root alone.
      parts({ history, thread: [message(2, DM)] }),
      data,
    )

    expect(conversation.messages).toEqual(history)
    expect(conversation.inThread).toBe(false)
    expect(conversation.messageId).toBe(2)
    expect(conversation.title).toBe('Vega')
    expect(conversation.origin).toBe('Direct message · the whole conversation')
    expect(conversation.placeholder).toBe('Message Vega…')
  })

  it('answers a DM as a message in it, never as a reply to the one row', () => {
    const conversation = conversationOf(
      item({ kind: 'dm', channelId: DM, messageId: 2 }),
      parts({ history: [message(2, DM)], thread: [message(2, DM)] }),
      data,
    )

    expect(conversation.rootId).toBeNull()
    expect(conversation.channelId).toBe(DM)
    expect(conversation.draftKey).toBe(`channel:${DM}`)
  })

  it('is the channel’s history for a mention nobody has answered', () => {
    const history = [message(1, 'general'), message(2, 'general')]
    const conversation = conversationOf(
      item({ kind: 'mention', channelId: 'general', messageId: 2 }),
      parts({ history, thread: [message(2, 'general')] }),
      data,
    )

    expect(conversation.messages).toEqual(history)
    expect(conversation.title).toBe('#general')
    expect(conversation.origin).toBe('#general · the whole conversation')
    expect(conversation.rootId).toBeNull()
  })

  it('is the thread, from its root, once the message has replies', () => {
    const thread = [message(2, 'general'), message(5, 'general', 2)]
    const conversation = conversationOf(
      item({ kind: 'mention', channelId: 'general', messageId: 2 }),
      parts({ history: [message(1, 'general'), message(2, 'general')], thread }),
      data,
    )

    expect(conversation.messages).toEqual(thread)
    expect(conversation.inThread).toBe(true)
    expect(conversation.rootId).toBe(2)
    expect(conversation.title).toBe('Thread in #general')
    expect(conversation.origin).toBe('#general · the whole thread')
    expect(conversation.placeholder).toBe('Reply in thread…')
    expect(conversation.draftKey).toBe('thread:2')
  })

  it('is the thread for a reply, and highlights the reply rather than the root', () => {
    const thread = [message(2, 'general'), message(5, 'general', 2)]
    const conversation = conversationOf(
      item({ kind: 'thread', channelId: 'general', messageId: 5, threadId: 2 }),
      parts({ thread }),
      data,
    )

    expect(conversation.inThread).toBe(true)
    expect(conversation.messageId).toBe(5)
    expect(conversation.rootId).toBe(2)
  })

  it('puts the New line before the first message past the read mark', () => {
    const conversation = conversationOf(
      item({ kind: 'dm', channelId: DM, messageId: 4 }),
      parts({ history: [message(1, DM), message(2, DM), message(3, DM), message(4, DM)], readMark: 2 }),
      data,
    )

    expect(conversation.firstUnreadId).toBe(3)
  })

  it('draws no New line when the boss had read the whole conversation', () => {
    const conversation = conversationOf(
      item({ kind: 'dm', channelId: DM, messageId: 2 }),
      parts({ history: [message(1, DM), message(2, DM)], readMark: 2 }),
      data,
    )

    expect(conversation.firstUnreadId).toBe(0)
  })
})
