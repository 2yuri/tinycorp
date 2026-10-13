import { isColleagueVoice } from '../../../shared/colleague-voice'
import { voiceChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { VoiceFacade } from './facade'

export interface VoiceIpcOptions {
  ipc: IpcHandlerRegistry
  engine: VoiceFacade
  broadcastChanged(): void
}

/**
 * How Employees talk to each other, over IPC (T180). Two calls: read the Company's voice and set
 * it. It saves as it changes, like who tests and the round limit — the boss picking a segment is
 * not a draft — so the Tokens tab never waits on Save changes for it.
 */
export function registerVoiceIpc({ ipc, engine, broadcastChanged }: VoiceIpcOptions): void {
  engine.voice.onChange(broadcastChanged)

  ipc.handle(voiceChannels.colleague, () => attempt(() => engine.voice.colleague()))
  ipc.handle(voiceChannels.setColleague, (_event, voice) =>
    attempt(() => {
      if (!isColleagueVoice(voice)) throw new Error(`Unknown colleague voice: ${String(voice)}`)
      return engine.voice.setColleague(voice)
    }),
  )
}
