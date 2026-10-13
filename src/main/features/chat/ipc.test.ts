import { afterEach, describe, expect, it } from 'vitest'
import { chatChannels } from '../../../shared/domain/channels'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerChatIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  let broadcasts = 0
  registerChatIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

describe('Chat IPC: channel extras (T44)', () => {
  it('writes a topic and hands the channel back', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    const result = await invoke(chatChannels.setTopic, '#tech', '  How we build it.  ')

    expect(result).toMatchObject({ ok: true, value: { id: 'tech', topic: 'How we build it.' } })
    expect(await invoke(chatChannels.channels)).toMatchObject({
      ok: true,
      value: [{ id: 'general', topic: '' }, { id: 'tech', topic: 'How we build it.' }, { id: 'prs' }],
    })
  })

  it('sets the members a channel has, and refuses a stranger', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(await invoke(chatChannels.setMembers, 'tech', [ada.id])).toMatchObject({
      ok: true,
      value: { id: 'tech', members: [ada.id] },
    })
    expect(await invoke(chatChannels.setMembers, 'tech', ['nobody'])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not an Employee/),
    })
    expect(await invoke(chatChannels.setMembers, 'tech', 'ada')).toMatchObject({ ok: false })
  })

  it('pins and unpins as the boss, and lists a channel’s pins', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const posted = (await invoke(chatChannels.post, 'tech', 'we use named migrations')) as {
      value: { id: number }
    }

    const pinned = await invoke(chatChannels.pin, posted.value.id, true)

    expect(pinned).toMatchObject({ ok: true, value: { id: posted.value.id, pinnedBy: BOSS } })
    expect(await invoke(chatChannels.pins, 'tech')).toMatchObject({
      ok: true,
      value: [{ id: posted.value.id, text: 'we use named migrations' }],
    })

    expect(await invoke(chatChannels.pin, posted.value.id, false)).toMatchObject({ ok: true, value: null })
    expect(await invoke(chatChannels.pins, 'tech')).toMatchObject({ ok: true, value: [] })
  })

  it('searches a channel’s bodies, newest first', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    await invoke(chatChannels.post, 'tech', 'the migration is named')
    await invoke(chatChannels.post, 'tech', 'no migration yet')
    await invoke(chatChannels.post, 'general', 'migration elsewhere')

    expect(await invoke(chatChannels.search, { channelId: 'tech', text: 'MIGRATION' })).toMatchObject({
      ok: true,
      value: [{ text: 'no migration yet' }, { text: 'the migration is named' }],
    })
    expect(await invoke(chatChannels.search, { channelId: 'tech', text: '  ' })).toEqual({ ok: true, value: [] })
  })

  it('tells the renderer a topic, a member list or a pin changed', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const posted = (await invoke(chatChannels.post, 'tech', 'one')) as { value: { id: number } }
    const before = broadcasts()

    await invoke(chatChannels.setTopic, 'tech', 'How we build it.')
    await invoke(chatChannels.pin, posted.value.id, true)

    expect(broadcasts()).toBe(before + 2)
  })
})

describe('Chat IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(chatChannels.channels)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('posts, replies and reads as the boss', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    const posted = await invoke(chatChannels.post, 'tech', 'hi @Ada')
    const root = (posted as { value: { id: number } }).value.id
    await invoke(chatChannels.reply, root, 'any news?')
    await invoke(chatChannels.post, dmChannelId(BOSS, ada.id), 'psst')

    expect(posted).toMatchObject({ ok: true, value: { authorId: BOSS, mentions: [ada.id] } })
    expect(await invoke(chatChannels.read, { channelId: 'tech' })).toMatchObject({
      ok: true,
      value: [{ id: root, text: 'hi @Ada', replyCount: 1 }],
    })
    expect(await invoke(chatChannels.read, { channelId: 'tech', threadId: root })).toMatchObject({
      ok: true,
      value: [{ text: 'hi @Ada' }, { text: 'any news?', authorId: BOSS }],
    })
    expect(await invoke(chatChannels.channels)).toMatchObject({
      ok: true,
      value: [{ id: 'general' }, { id: 'tech' }, { id: 'prs' }, { id: dmChannelId(BOSS, ada.id), kind: 'dm' }],
    })
  })

  it('broadcasts on new messages and on Company changes', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    await invoke(chatChannels.post, 'general', 'hello')
    engine.createCompany({ folder: onDisk('/work/globex') })

    expect(broadcasts() - before).toBe(2)
  })

  it('rejects malformed input from the renderer', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(chatChannels.post, 42, 'hi')).toMatchObject({ ok: false })
    expect(await invoke(chatChannels.post, 'tech')).toMatchObject({ ok: false })
    expect(await invoke(chatChannels.reply, 'one', 'hi')).toMatchObject({ ok: false })
    expect(await invoke(chatChannels.read, null)).toMatchObject({ ok: false })
    expect(await invoke(chatChannels.read, { channelId: 'tech', threadId: 'x' })).toMatchObject({ ok: false })
  })
})

describe('Chat IPC unread', () => {
  it('reports the boss’s unread messages and clears a channel once read', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const first = engine.chat().post({ authorId: ada.id, channelId: 'tech', text: 'green' })

    // The counts and the read marks travel together: the Inbox's New line is drawn from the mark
    // and the sidebar's bold from the count, and neither is worth a channel of its own (T251).
    expect(await invoke(chatChannels.unread)).toEqual({ ok: true, value: { counts: { tech: 1 }, readMarks: {} } })

    const before = broadcasts()
    expect(await invoke(chatChannels.markRead, 'tech')).toEqual({ ok: true, value: true })
    expect(broadcasts()).toBe(before + 1)
    expect(await invoke(chatChannels.unread)).toEqual({
      ok: true,
      value: { counts: {}, readMarks: { tech: first.id } },
    })
  })

  it('does not broadcast when nothing changed, so a view that marks read on every change settles', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    expect(await invoke(chatChannels.markRead, 'general')).toEqual({ ok: true, value: false })
    expect(broadcasts()).toBe(before)
  })

  it('serves the boss’s Inbox and marks it all read', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss a word?' })

    expect(await invoke(chatChannels.bossInbox)).toMatchObject({
      ok: true,
      value: [{ kind: 'mention', channelId: 'tech', unread: true }],
    })

    const before = broadcasts()
    expect(await invoke(chatChannels.markAllRead)).toEqual({ ok: true, value: true })
    expect(broadcasts()).toBe(before + 1)
    expect(await invoke(chatChannels.bossInbox)).toMatchObject({ ok: true, value: [{ unread: false }] })
    expect(await invoke(chatChannels.markAllRead)).toEqual({ ok: true, value: false })
    expect(broadcasts()).toBe(before + 1)
  })

  it('serves an Employee’s conversations, and rejects a missing Employee', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
    engine.chat().post({ authorId: ada.id, channelId: dmChannelId(ada.id, grace.id), text: 'pairing?' })

    expect(await invoke(chatChannels.conversations, ada.id)).toMatchObject({
      ok: true,
      value: [{ kind: 'dm', counterpartId: grace.id, postable: false, unread: 1 }],
    })
    expect(await invoke(chatChannels.conversations, 42)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('serves the DMs between two Employees for the sidebar', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
    engine.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, ada.id), text: 'morning' })
    engine.chat().post({ authorId: ada.id, channelId: dmChannelId(ada.id, grace.id), text: 'pairing?' })

    expect(await invoke(chatChannels.agentPairs)).toMatchObject({
      ok: true,
      value: [{ channelId: dmChannelId(ada.id, grace.id), members: [ada.id, grace.id].sort(), unread: 1 }],
    })
  })

  it('rejects a missing channel', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(chatChannels.markRead, 42)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('says what deleting a channel takes, deletes it and tells every window (T112)', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const epic = engine.board().createEpic({ title: 'Login' })
    const channelId = `epic-${epic.id}-login`
    engine.chat().post({ authorId: BOSS, channelId, text: 'kick-off' })

    expect(await invoke(chatChannels.channelRemoval, channelId)).toEqual({
      ok: true,
      // Two: the kick-off, and the system line opening the epic's plan (T171).
      value: { channelId, name: channelId, messages: 2, epicId: epic.id },
    })

    const before = broadcasts()
    expect(await invoke(chatChannels.deleteChannel, channelId)).toMatchObject({ ok: true, value: { channelId } })
    expect(broadcasts()).toBe(before + 1)
    expect(await invoke(chatChannels.channels)).toMatchObject({
      ok: true,
      value: [{ id: 'general' }, { id: 'tech' }, { id: 'prs' }],
    })
  })

  it('refuses to delete the Company’s own channels and DMs (T112)', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const before = broadcasts()

    expect(await invoke(chatChannels.deleteChannel, 'general')).toEqual({ ok: false, error: expect.any(String) })
    expect(await invoke(chatChannels.deleteChannel, dmChannelId(BOSS, ada.id))).toEqual({
      ok: false,
      error: expect.any(String),
    })
    expect(broadcasts()).toBe(before)
  })
})

describe('Chat IPC: composer drafts (TI-1)', () => {
  it('keeps, reads and clears a draft as the boss', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(chatChannels.draft, 'channel:tech')).toEqual({ ok: true, value: null })
    await invoke(chatChannels.saveDraft, 'channel:tech', { text: 'half a thought', files: [] })
    expect(await invoke(chatChannels.draft, 'channel:tech')).toEqual({
      ok: true,
      value: { text: 'half a thought', files: [] },
    })
    expect(await invoke(chatChannels.draftedChannels)).toEqual({ ok: true, value: ['tech'] })

    await invoke(chatChannels.clearDraft, 'channel:tech')
    expect(await invoke(chatChannels.draft, 'channel:tech')).toEqual({ ok: true, value: null })
  })

  it('redraws the sidebar only when a channel gains or loses its draft', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    await invoke(chatChannels.saveDraft, 'channel:tech', { text: 'a', files: [] })
    await invoke(chatChannels.saveDraft, 'channel:tech', { text: 'ab', files: [] })
    await invoke(chatChannels.saveDraft, 'desk', { text: 'goal', files: [] })
    expect(broadcasts() - before).toBe(1)

    await invoke(chatChannels.clearDraft, 'channel:tech')
    expect(broadcasts() - before).toBe(2)
  })

  it('refuses a malformed draft and a file the draft does not hold', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(chatChannels.saveDraft, 42, { text: 'x' })).toMatchObject({ ok: false })
    expect(await invoke(chatChannels.saveDraft, 'desk', null)).toMatchObject({ ok: false })
    expect(await invoke(chatChannels.draftFile, 'desk', onDisk('/etc/hosts'))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not in the draft/),
    })
  })
})
