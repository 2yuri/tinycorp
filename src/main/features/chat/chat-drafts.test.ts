import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, removeFolder } from '../../core/testing'

const engines: CompanyEngine[] = []
const folders: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) removeFolder(folder)
})

function setup() {
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const desktop = mkdtempSync(join(tmpdir(), 'tinycorp-drafts-'))
  folders.push(desktop)
  /** A file on disk, the way a picked or dropped one is. */
  function file(name: string, contents: string): { path: string; name: string; size: number } {
    const path = join(desktop, name)
    writeFileSync(path, contents)
    return { path, name, size: Buffer.byteLength(contents) }
  }
  return { engine, chat: engine.chat(), ada, file }
}

describe('the boss’s composer drafts', () => {
  it('keeps text per channel, DM, thread and Your Desk, each apart', () => {
    const { chat, ada } = setup()
    const root = chat.post({ authorId: ada.id, channelId: 'tech', text: 'migrations are green' })
    const dm = dmChannelId(BOSS, ada.id)

    chat.saveDraft('channel:tech', { text: 'about the migration', files: [] })
    chat.saveDraft(`channel:${dm}`, { text: 'got a minute?', files: [] })
    chat.saveDraft(`thread:${root.id}`, { text: 'nice', files: [] })
    chat.saveDraft('desk', { text: 'ship drafts', files: [] })

    expect(chat.draft('channel:tech')).toEqual({ text: 'about the migration', files: [] })
    expect(chat.draft(`channel:${dm}`)).toEqual({ text: 'got a minute?', files: [] })
    expect(chat.draft(`thread:${root.id}`)).toEqual({ text: 'nice', files: [] })
    expect(chat.draft('desk')).toEqual({ text: 'ship drafts', files: [] })
    expect(chat.draft('channel:general')).toBeNull()
  })

  it('replaces a draft, and deletes it once it is empty or cleared', () => {
    const { chat } = setup()
    chat.saveDraft('channel:tech', { text: 'one', files: [] })
    chat.saveDraft('channel:tech', { text: 'one two', files: [] })
    expect(chat.draft('channel:tech')?.text).toBe('one two')

    chat.saveDraft('channel:tech', { text: '   ', files: [] })
    expect(chat.draft('channel:tech')).toBeNull()

    chat.saveDraft('desk', { text: 'goal', files: [] })
    chat.clearDraft('desk')
    expect(chat.draft('desk')).toBeNull()
  })

  it('keeps a file by its path, and leaves out one deleted or moved since', () => {
    const { chat, file } = setup()
    const log = file('run.log', 'two failures')
    const shot = file('shot.png', 'png bytes')
    chat.saveDraft('channel:tech', { text: 'see these', files: [log, shot] })

    rmSync(shot.path)
    expect(chat.draft('channel:tech')).toEqual({ text: 'see these', files: [log] })

    // A folder where the file was is not the file.
    mkdirSync(shot.path)
    rmSync(log.path)
    expect(chat.draft('channel:tech')).toEqual({ text: 'see these', files: [] })
  })

  it('reports the size a kept file has now', () => {
    const { chat, file } = setup()
    const log = file('run.log', 'one')
    chat.saveDraft('desk', { text: '', files: [log] })
    writeFileSync(log.path, 'one two three')

    expect(chat.draft('desk')?.files[0]?.size).toBe(13)
  })

  it('reads a draft file for sending, and only one the draft holds', () => {
    const { chat, file } = setup()
    const log = file('run.log', 'two failures')
    const other = file('secret.txt', 'not attached')
    chat.saveDraft('channel:tech', { text: '', files: [log] })

    const source = chat.draftFile('channel:tech', log.path)
    expect(source.name).toBe('run.log')
    expect(new TextDecoder().decode(source.data)).toBe('two failures')
    expect(() => chat.draftFile('channel:tech', other.path)).toThrow('not in the draft')
    expect(() => chat.draftFile('desk', log.path)).toThrow('not in the draft')

    rmSync(log.path)
    expect(() => chat.draftFile('channel:tech', log.path)).toThrow('no longer where it was attached from')
  })

  it('reads a draft file only through the checks a send runs', () => {
    const { chat, file } = setup()
    // Nothing stops the renderer naming a path of its own in a draft, and `chat:post` refuses a
    // path from the renderer on purpose. So what comes back out here is only what a message could
    // have carried: a kind that may be attached, inside the size limit, both of them the store's own.
    const secret = file('id_rsa', 'a private key')
    chat.saveDraft('desk', { text: '', files: [secret] })

    expect(() => chat.draftFile('desk', secret.path)).toThrow('not a kind of file you can attach')
  })

  it('lists the channels and DMs holding a draft, not threads or Your Desk', () => {
    const { chat, ada } = setup()
    const root = chat.post({ authorId: ada.id, channelId: 'tech', text: 'hi' })
    const dm = dmChannelId(BOSS, ada.id)
    chat.saveDraft('channel:general', { text: 'a', files: [] })
    chat.saveDraft(`channel:${dm}`, { text: 'b', files: [] })
    chat.saveDraft(`thread:${root.id}`, { text: 'c', files: [] })
    chat.saveDraft('desk', { text: 'd', files: [] })

    expect(chat.draftedChannels().sort()).toEqual([dm, 'general'].sort())
  })

  it('goes with the channel it was written in, threads included', () => {
    const { engine, chat, ada } = setup()
    const epic = engine.board().createEpic({ title: 'Login' })
    const channelId = `epic-${epic.id}-login`
    const root = chat.post({ authorId: ada.id, channelId, text: 'how far along?' })
    chat.saveDraft(`channel:${channelId}`, { text: 'half a thought', files: [] })
    chat.saveDraft(`thread:${root.id}`, { text: 'reply', files: [] })
    chat.saveDraft('channel:tech', { text: 'stays', files: [] })

    chat.deleteChannel(channelId)

    expect(chat.draft(`channel:${channelId}`)).toBeNull()
    expect(chat.draft(`thread:${root.id}`)).toBeNull()
    expect(chat.draft('channel:tech')?.text).toBe('stays')
  })

  it('refuses a key, a path or a size it cannot keep', () => {
    const { chat } = setup()
    expect(() => chat.saveDraft('lobby', { text: 'x', files: [] })).toThrow('Missing draft key')
    expect(() => chat.saveDraft('thread:0', { text: 'x', files: [] })).toThrow('Missing draft key')
    expect(() => chat.saveDraft('desk', { text: 'x', files: [{ path: 'run.log', name: 'run.log', size: 1 }] })).toThrow(
      'full path',
    )
    expect(() => chat.saveDraft('desk', { text: 'x'.repeat(100_001), files: [] })).toThrow('too long')
  })
})
