import { describe, expect, it } from 'vitest'
import { BOSS, dmChannelId, type Message } from '../../../shared/domain/chat'
import { assignTask } from './assign-task'

function fakePost() {
  const posted: Message[] = []
  const post = async (channelId: string, text: string) => {
    const message: Message = {
      id: posted.length + 1,
      kind: 'post',
      channelId,
      threadId: null,
      authorId: BOSS,
      text,
      mentions: [],
      mentionsChannel: false,
      replyCount: 0,
      createdAt: new Date(0).toISOString(),
    }
    posted.push(message)
    return { ok: true as const, value: message }
  }
  return { posted, post }
}

describe('assignTask', () => {
  it('DMs the task from the boss to the Employee who answers them', async () => {
    const { posted, post } = fakePost()
    await assignTask(post, 'pm', '  Ship the billing dashboard  ')
    expect(posted.map((m) => [m.channelId, m.text])).toEqual([[dmChannelId(BOSS, 'pm'), 'Ship the billing dashboard']])
  })

  it('posts nothing when the Company has nobody to answer', async () => {
    const { posted, post } = fakePost()
    expect(await assignTask(post, null, 'Do it')).toBeNull()
    expect(posted).toEqual([])
  })

  it('posts nothing for blank text', async () => {
    const { posted, post } = fakePost()
    expect(await assignTask(post, 'pm', '   ')).toBeNull()
    expect(posted).toEqual([])
  })
})
