import { afterEach, describe, expect, it } from 'vitest'
import type { ColleagueVoice } from '../../../shared/colleague-voice'
import { voiceChannels } from '../../../shared/domain/channels'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { Result } from '../../../shared/domain/result'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerVoiceIpc } from './voice-ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  let broadcasts = 0
  registerVoiceIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async <T>(channel: string, ...args: unknown[]) => (await handlers.get(channel)!(...args)) as Result<T>

  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
  return { engine, invoke, ada, grace, broadcasts: () => broadcasts }
}

describe('The colleague voice over IPC', () => {
  it('reads Terse for a Company that has never been asked', async () => {
    const { invoke } = setup()

    expect(await invoke<ColleagueVoice>(voiceChannels.colleague)).toEqual({ ok: true, value: 'terse' })
  })

  it('round-trips a change, and says so once', async () => {
    const { invoke, broadcasts } = setup()

    expect(await invoke<ColleagueVoice>(voiceChannels.setColleague, 'plain')).toEqual({ ok: true, value: 'plain' })

    expect(await invoke<ColleagueVoice>(voiceChannels.colleague)).toEqual({ ok: true, value: 'plain' })
    expect(broadcasts()).toBe(1)
  })

  it('refuses a voice it does not know, and keeps the saved one', async () => {
    const { invoke } = setup()

    const refusal = await invoke<ColleagueVoice>(voiceChannels.setColleague, 'shouty')

    expect(refusal).toEqual({ ok: false, error: expect.stringContaining('Unknown colleague voice') })
    expect(await invoke<ColleagueVoice>(voiceChannels.colleague)).toEqual({ ok: true, value: 'terse' })
  })

  it('reaches the wake prompts and the instructions, not only the setting', async () => {
    const { engine, invoke, ada, grace } = setup()

    await invoke(voiceChannels.setColleague, 'plain')
    engine.chat().post({ authorId: grace.id, channelId: dmChannelId(grace.id, ada.id), text: 'migration renamed' })

    expect(engine.inbox.list(ada.id)[0]!.prompt).not.toContain('terse')
    expect(engine.voice.colleague()).toBe('plain')
    // And the boss's own DM never carried the terse hint either way.
    engine.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, ada.id), text: 'how is it going?' })
    expect(engine.inbox.list(ada.id).at(-1)!.prompt).toContain('plain words')
  })
})
