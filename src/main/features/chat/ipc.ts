import type { AttachmentSource } from '../../../shared/attachments'
import type { ChannelSearch } from '../../../shared/channel-extras'
import { chatChannels } from '../../../shared/domain/channels'
import { BOSS, type ChatQuery } from '../../../shared/domain/chat'
import type { Draft } from '../../../shared/drafts'
import { attempt, type IpcHandlerRegistry, requireString } from '../../core'
import type { ChatFacade } from './facade'

export interface ChatIpcOptions {
  ipc: IpcHandlerRegistry
  engine: ChatFacade
  broadcastChanged(): void
}

/** Exposes the current Company's chat to the renderer, which always speaks as the boss. Holds no state. */
export function registerChatIpc({ ipc, engine, broadcastChanged }: ChatIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.onChatChange(broadcastChanged)

  ipc.handle(chatChannels.channels, () => attempt(() => engine.chat().channels()))
  ipc.handle(chatChannels.read, (_event, query) => attempt(() => engine.chat().read(parseQuery(query))))
  ipc.handle(chatChannels.post, (_event, channelId, text, attachments) =>
    attempt(() =>
      engine.chat().post({
        authorId: BOSS,
        channelId: requireString(channelId, 'channel'),
        text: requireString(text, 'message'),
        ...parseSources(attachments),
      }),
    ),
  )
  ipc.handle(chatChannels.reply, (_event, messageId, text, attachments) =>
    attempt(() =>
      engine.chat().reply({
        authorId: BOSS,
        messageId: requireId(messageId, 'message id'),
        text: requireString(text, 'message'),
        ...parseSources(attachments),
      }),
    ),
  )
  ipc.handle(chatChannels.attachment, (_event, id) =>
    attempt(() => engine.chat().openAttachment(requireId(id, 'attachment id'))),
  )
  ipc.handle(chatChannels.attachmentLimits, () => attempt(() => engine.chat().attachmentLimits()))
  ipc.handle(chatChannels.unread, () => attempt(() => engine.chat().bossUnread()))
  ipc.handle(chatChannels.bossInbox, () => attempt(() => engine.chat().bossInbox()))
  ipc.handle(chatChannels.conversations, (_event, employeeId) =>
    attempt(() => engine.chat().employeeConversations(requireString(employeeId, 'employee'))),
  )
  ipc.handle(chatChannels.agentPairs, () => attempt(() => engine.chat().agentPairs()))
  ipc.handle(chatChannels.markAllRead, () =>
    attempt(() => {
      const changed = engine.chat().markAllReadByBoss()
      if (changed) broadcastChanged()
      return changed
    }),
  )
  ipc.handle(chatChannels.channelRemoval, (_event, channelId) =>
    attempt(() => engine.chat().channelRemoval(requireString(channelId, 'channel'))),
  )
  // The boss's own action: nothing in the MCP chat tools deletes a channel (T112).
  ipc.handle(chatChannels.deleteChannel, (_event, channelId) =>
    attempt(() => {
      const removal = engine.chat().deleteChannel(requireString(channelId, 'channel'))
      broadcastChanged()
      return removal
    }),
  )
  // The topic and the member list are the boss's, like deleting a channel: no MCP tool moves them (T44).
  ipc.handle(chatChannels.setTopic, (_event, channelId, topic) =>
    attempt(() =>
      engine.chat().setChannelTopic({
        channelId: requireString(channelId, 'channel'),
        topic: typeof topic === 'string' ? topic : '',
      }),
    ),
  )
  ipc.handle(chatChannels.setMembers, (_event, channelId, memberIds) =>
    attempt(() =>
      engine.chat().setChannelMembers({
        channelId: requireString(channelId, 'channel'),
        memberIds: requireIds(memberIds),
      }),
    ),
  )
  ipc.handle(chatChannels.pin, (_event, messageId, pinned) =>
    attempt(() => {
      const id = requireId(messageId, 'message id')
      if (pinned === false) {
        engine.chat().unpinMessage({ messageId: id })
        return null
      }
      return engine.chat().pinMessage({ messageId: id, byId: BOSS })
    }),
  )
  ipc.handle(chatChannels.pins, (_event, channelId) =>
    attempt(() => engine.chat().pins(requireString(channelId, 'channel'))),
  )
  ipc.handle(chatChannels.search, (_event, query) => attempt(() => engine.chat().searchMessages(parseSearch(query))))
  // The boss's own composer drafts (TI-1): what one holds changes nothing anybody else sees, so
  // only the sidebar's pencil is told, and only when a channel gains or loses one.
  ipc.handle(chatChannels.draft, (_event, key) => attempt(() => engine.chat().draft(requireString(key, 'draft key'))))
  ipc.handle(chatChannels.saveDraft, (_event, key, draft) =>
    attempt(() => drafting(() => engine.chat().saveDraft(requireString(key, 'draft key'), draft as Draft))),
  )
  ipc.handle(chatChannels.clearDraft, (_event, key) =>
    attempt(() => drafting(() => engine.chat().clearDraft(requireString(key, 'draft key')))),
  )
  ipc.handle(chatChannels.draftedChannels, () => attempt(() => engine.chat().draftedChannels()))
  ipc.handle(chatChannels.draftFile, (_event, key, path) =>
    attempt(() => engine.chat().draftFile(requireString(key, 'draft key'), requireString(path, 'file'))),
  )
  ipc.handle(chatChannels.markRead, (_event, channelId) =>
    attempt(() => {
      const changed = engine.chat().markReadByBoss(requireString(channelId, 'channel'))
      if (changed) broadcastChanged()
      return changed
    }),
  )

  /** Runs a draft change, and redraws the sidebar when it moved which channels hold a draft. */
  function drafting(change: () => void): null {
    const before = engine.chat().draftedChannels().sort().join('\n')
    change()
    if (engine.chat().draftedChannels().sort().join('\n') !== before) broadcastChanged()
    return null
  }
}

function parseQuery(value: unknown): ChatQuery {
  if (typeof value !== 'object' || value === null) throw new Error('Missing chat query')
  const query = value as Record<string, unknown>
  return {
    channelId: requireString(query['channelId'], 'channel'),
    ...(query['threadId'] !== undefined && { threadId: requireId(query['threadId'], 'thread id') }),
    ...(query['limit'] !== undefined && { limit: requireId(query['limit'], 'limit') }),
  }
}

function parseSearch(value: unknown): ChannelSearch {
  if (typeof value !== 'object' || value === null) throw new Error('Missing chat query')
  const query = value as Record<string, unknown>
  return {
    channelId: requireString(query['channelId'], 'channel'),
    text: typeof query['text'] === 'string' ? query['text'] : '',
    ...(query['limit'] !== undefined && { limit: requireId(query['limit'], 'limit') }),
  }
}

/**
 * The files the composer picked, as the field to spread into the post. The renderer hands over
 * bytes, never a path: what a drop or a file picker gives it is a browser `File`, and Electron
 * stopped putting a path on one. A composer that picked none says nothing about attachments.
 */
function parseSources(value: unknown): { attachments?: AttachmentSource[] } {
  if (value === undefined || value === null) return {}
  if (!Array.isArray(value)) throw new Error('Missing attachments')
  const sources = value.map((item) => {
    const source = item as Record<string, unknown>
    const name = requireString(source['name'], 'attachment name')
    const data = source['data']
    if (data instanceof Uint8Array) return { name, data }
    if (data instanceof ArrayBuffer) return { name, data: new Uint8Array(data) }
    throw new Error(`Missing the bytes of ${name}`)
  })
  return { attachments: sources }
}

/** A member list from the renderer: strings only, and no `null` slipping through as an id. */
function requireIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Missing members')
  return value.map((id) => requireString(id, 'member'))
}

function requireId(value: unknown, what: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`Missing ${what}`)
  return value as number
}
