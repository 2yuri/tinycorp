import type { AttachmentLimits } from '../../../shared/attachments'
import type { Message } from '../../../shared/domain/chat'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import { type CompanyContext, createVoiceSettings, type OpenCompany, type VoiceSettings } from '../../core'
import type { OwnFace } from '../company'
import { type Chat, createChat } from './chat'
import type { ChatFacade, VoiceFacade } from './facade'

/** What the boss's app hands in, and a test leaves out. */
export interface ChatOptions {
  /**
   * What a chat attachment may be (decision 37): how big, and which kinds of file. The design gives
   * the boss no control over either, so this is where a Company's limits are set.
   */
  attachments?: AttachmentLimits
}

/** What chat tells the rest of the app. */
export interface ChatDeps extends ChatOptions {
  /** Somebody posted. Everything that hangs off a post — the office, the Inbox, the log — starts here. */
  posted(entry: OpenCompany, message: Message): void
  /** A topic, a member list or a pin changed: no message, but the views show it (T44). */
  moved(companyId: string): void
  /**
   * A read mark or a deleted channel moved the Inbox without posting. Not the same event as the
   * one above: the rail marks a Company the boss has not read, and nothing else redraws.
   */
  inboxMoved(companyId: string): void
  /**
   * Rows the Inbox shows that chat did not write: a Session stopped in its terminal asking the boss
   * (T165). They are derived from the Sessions every time rather than stored, so a row is there
   * exactly while the ask is and answering in the terminal resolves it.
   */
  asking(companyId: string): BossInboxItem[]
}

/** Chat and the colleague voice, once they are wired. */
export interface ChatFeature {
  /** That Company's chat, made the first time it is asked for. */
  of(entry: OpenCompany): Chat
  chat(companyId: string): Chat
  /** The Company's chat with the asks folded into its Inbox, which is what every reader wants. */
  withAsks(entry: OpenCompany): Chat
  /** That Company's colleague voice. */
  voice(entry: OpenCompany): VoiceSettings
  /** Something changed in any open Company's chat, including an ask appearing or clearing. */
  changed(): void
  facade: OwnFace<ChatFacade> & VoiceFacade
}

/**
 * Wires chat and the one setting that governs how Employees write to each other (T180, T188).
 *
 * One chat per open Company, made the first time it is asked for. Reading a channel and deleting
 * one move the Inbox without posting, so they are wrapped here rather than left to each caller to
 * remember.
 */
export function register(ctx: CompanyContext, deps: ChatDeps): ChatFeature {
  const changed = ctx.listeners()
  const voiceChanged = ctx.listeners()
  const voices = ctx.perCompany((entry) => createVoiceSettings(entry.db, () => voiceChanged.notify()))

  const chats = ctx.perCompany((entry): Chat => {
    const companyId = entry.company.id
    // Reading a channel and deleting one move the Inbox without posting, so the rail hears of it here.
    const read = () => deps.inboxMoved(companyId)
    const created = createChat(
      entry.db,
      (message) => deps.posted(entry, message),
      () => deps.moved(companyId),
      // Attachments live in the Company folder, under the message that carries them (decision 37).
      { folder: entry.company.folder, ...(deps.attachments && { limits: deps.attachments }) },
    )
    return {
      ...created,
      markReadByBoss(channelId) {
        const marked = created.markReadByBoss(channelId)
        if (marked) read()
        return marked
      },
      markAllReadByBoss() {
        const marked = created.markAllReadByBoss()
        if (marked) read()
        return marked
      },
      deleteChannel(channelId) {
        const removal = created.deleteChannel(channelId)
        read()
        return removal
      },
    }
  })

  function withAsks(entry: OpenCompany): Chat {
    const chat = chats.of(entry)
    return { ...chat, bossInbox: () => [...deps.asking(entry.company.id), ...chat.bossInbox()] }
  }

  return {
    of: (entry) => chats.of(entry),
    chat: (companyId) => chats.ofId(companyId),
    withAsks,
    voice: (entry) => voices.of(entry),
    changed: () => changed.notify(),
    facade: {
      chat: () => withAsks(ctx.currentEntry()),
      onChatChange: (listener) => changed.add(listener),
      voice: {
        colleague: () => voices.current().colleagueVoice(),
        setColleague: (voice) => voices.current().setColleagueVoice(voice),
        onChange: (listener) => voiceChanged.add(listener),
      },
    },
  }
}
