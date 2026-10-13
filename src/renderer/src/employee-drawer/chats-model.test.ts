import { describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { EmployeeConversation } from '../../../shared/employee-chats'
import { conversationRows, readAlong, selectedConversation, unreadTotal } from './chats-model'

const person = (id: string, name: string, title: string) =>
  ({ id, name, title, sprite: 1, capabilities: [] }) as unknown as Employee
const nova = person('nova', 'Nova', 'Tech Lead')
const vega = person('vega', 'Vega', 'Frontend')
const employees = [nova, vega]

function conversation(fields: Partial<EmployeeConversation> = {}): EmployeeConversation {
  return {
    channelId: dmChannelId(nova.id, vega.id),
    kind: 'dm',
    name: '',
    members: [nova.id, vega.id],
    counterpartId: vega.id,
    last: { id: 9, authorId: vega.id, text: 'Pushing the locale guard now.', createdAt: '2026-09-17T09:47:00' },
    unread: 2,
    postable: false,
    ...fields,
  }
}

describe('the drawer’s conversations list', () => {
  it('shows a teammate’s DM as their name, role tag, last message and time', () => {
    expect(conversationRows([conversation()], employees)).toEqual([
      {
        channelId: dmChannelId(nova.id, vega.id),
        title: 'Vega',
        role: 'FRONTEND',
        avatarId: vega.id,
        preview: 'Pushing the locale guard now.',
        time: '09:47',
        unread: true,
      },
    ])
  })

  it('shows the boss’s own DM as You · BOSS', () => {
    const withBoss = conversation({
      channelId: dmChannelId(BOSS, nova.id),
      members: [BOSS, nova.id],
      counterpartId: BOSS,
      last: { id: 4, authorId: BOSS, text: 'Nice work.', createdAt: '2026-09-17T09:12:00' },
      unread: 0,
      postable: true,
    })

    expect(conversationRows([withBoss], employees)[0]).toMatchObject({
      title: 'You',
      role: 'BOSS',
      avatarId: BOSS,
      preview: 'Nice work.',
      unread: false,
    })
  })

  it('names the author on a channel, where several people speak, and draws no avatar', () => {
    const channel = conversation({
      channelId: 'ep-usage-invoices',
      kind: 'channel',
      name: 'ep-usage-invoices',
      members: [],
      counterpartId: null,
      last: { id: 7, authorId: vega.id, text: 'can you confirm the tiers?', createdAt: '2026-09-17T09:20:00' },
    })

    expect(conversationRows([channel], employees)[0]).toMatchObject({
      title: '#ep-usage-invoices',
      role: '',
      avatarId: null,
      preview: 'Vega: can you confirm the tiers?',
    })
  })

  it('counts every unread message for the tab badge', () => {
    expect(unreadTotal([conversation(), conversation({ channelId: 'tech', unread: 0 })])).toBe(2)
  })

  it('opens on the newest conversation until one is picked', () => {
    const newest = conversation()
    const older = conversation({ channelId: 'tech' })

    expect(selectedConversation([newest, older], null)).toBe(newest)
    expect(selectedConversation([newest, older], 'tech')).toBe(older)
    // A conversation that is gone falls back to the newest rather than showing nothing.
    expect(selectedConversation([newest, older], 'vanished')).toBe(newest)
    expect(selectedConversation([], null)).toBeNull()
  })
})

describe('the drawer’s read-along pane', () => {
  it('reads a DM between two Employees as theirs, and refuses the composer', () => {
    expect(readAlong(conversation(), nova, employees)).toEqual({
      title: 'Nova and Vega',
      note: 'You can read along',
      banner: 'Their conversation. DM Nova to join in.',
    })
  })

  it('lets the boss post in their own DM', () => {
    const withBoss = conversation({ counterpartId: BOSS, members: [BOSS, nova.id], postable: true })

    expect(readAlong(withBoss, nova, employees)).toEqual({ title: 'Nova and you', note: '', banner: null })
  })

  it('titles a channel by its name and lets the boss post', () => {
    const channel = conversation({ kind: 'channel', name: 'tech', counterpartId: null, postable: true })

    expect(readAlong(channel, nova, employees)).toEqual({ title: '#tech', note: '', banner: null })
  })
})
