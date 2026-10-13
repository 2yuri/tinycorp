import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { AttachmentSource } from '../../../shared/attachments'
import type { PinnedMessage } from '../../../shared/channel-extras'
import { BOSS, dmChannelId, dmMembers, type Message, textAddressedToBoss } from '../../../shared/domain/chat'
import { isInsideFolder, run } from '../../core'
import type { McpCaller } from '../../core/engine'

const ATTACHMENTS_HELP =
  'Absolute paths of files to attach, e.g. a screenshot or a failing run’s log. Each must be inside ' +
  'the Company folder or one of your worktrees, and it is copied into the Company, so a worktree ' +
  'that goes away does not take it with it.'

/**
 * The audience rule, in the two tools that write a message (T180). The prompt that woke the
 * Employee already named the voice for that one message; this is the standing rule, for a message
 * it writes without being woken.
 */
const VOICE_HELP =
  'Voice: a DM to a colleague follows the Company\u2019s setting for Employees (terse by default: ' +
  'fragments, no filler, code and errors exact). Anywhere the boss reads \u2014 a channel, a thread, a DM ' +
  'to the boss \u2014 is plain words in full sentences.'

const CHANNEL_HELP =
  'Where: "#general" (the boss: goals and Company-wide news), "#tech" (working things out with colleagues), ' +
  '"#prs" (pull requests only: a review wanted, a PR ready, checks red), "#ep-…" (that epic), ' +
  'or "@Name" (an Employee) or "@boss" for a direct message.'

const TO_HELP =
  'Set to "boss" when the message is for the boss: they are @mentioned for you, and the mention is what ' +
  'notifies them — without it they are never told. A message for a colleague names them with @Name in the ' +
  'text instead.'

/** `chat_post`, `chat_read`, `thread_reply` and `chat_pin`, acting as the calling Employee. */
export function registerChatTools(server: McpServer, { employee, chat, company, code }: McpCaller): void {
  const nameOf = (id: string) =>
    id === BOSS ? BOSS : (chat.people().find((p) => p.id === id)?.name ?? 'former employee')

  /** `#tech` or `@Name` → a channel id the chat understands. */
  function resolve(where: string): string {
    const address = where.trim()
    if (!address.startsWith('@')) return address.replace(/^#/, '')
    const name = address.slice(1).toLowerCase()
    const other = name === BOSS ? BOSS : chat.people().find((p) => p.name.toLowerCase() === name)?.id
    if (!other) throw new Error(`Nobody is called ${address}`)
    if (other === employee.id) throw new Error('You cannot DM yourself')
    return dmChannelId(employee.id, other)
  }

  /**
   * The files an Employee named, refused unless each is somewhere the Company owns: its folder, or
   * a worktree of one of its tickets. Nothing else on this Mac may be copied into the Company.
   *
   * It answers the field to spread into the post, so a call that named no file says nothing about
   * attachments rather than posting an `attachments` that is there and undefined.
   */
  function attach(paths: string[] | undefined): { attachments?: AttachmentSource[] } {
    if (!paths || paths.length === 0) return {}
    const places = [company.folder, ...code.list().flatMap((c) => c.worktrees.map((w) => w.path))]
    const sources = paths.map((path) => {
      if (!places.some((place) => isInsideFolder(path, place))) {
        throw new Error(
          `${path} is outside the Company. Attach a file from ${company.folder} or from one of your worktrees.`,
        )
      }
      return { path }
    })
    return { attachments: sources }
  }

  /** How a channel id is written back to the Employee. */
  function label(channelId: string): string {
    const members = dmMembers(channelId)
    if (!members) return `#${channelId}`
    const other = members.find((m) => m !== employee.id) ?? employee.id
    return `@${nameOf(other)}`
  }

  function view(message: Message, pinnedIds: Set<number> = new Set()) {
    return {
      ...(pinnedIds.has(message.id) && { pinned: true }),
      id: message.id,
      author: nameOf(message.authorId),
      text: message.text,
      ...(message.threadId !== null && { thread_id: message.threadId }),
      mentions: [...message.mentions.map(nameOf), ...(message.mentionsChannel ? ['channel'] : [])],
      ...(message.threadId === null && { replies: message.replyCount }),
      ...attachedView(message),
      at: message.createdAt,
    }
  }

  /** The files a message carries, each with the path to read it at. Nothing when it carries none. */
  function attachedView(message: Message) {
    const held = message.attachments ?? []
    if (held.length === 0) return {}
    return {
      attachments: held.map((a) => ({ name: a.name, path: chat.attachmentPath(a.id), size: a.size })),
    }
  }

  /** A pinned message, with who pinned it: the channel reads it as a decision, not as chatter. */
  function pinView(pin: PinnedMessage) {
    return { ...view(pin), pinned_by: nameOf(pin.pinnedBy), pinned_at: pin.pinnedAt }
  }

  server.registerTool(
    'chat_post',
    {
      description:
        'Post a message to a Company channel or DM. Mention people with @Name, everyone with @channel. ' +
        'Speaking to the boss? Pass to: "boss" — in a channel, nothing reaches them without the mention. ' +
        'Write like a colleague: the point first, no bullet lists or headings, and longer than a few ' +
        `sentences belongs in the ticket. ${VOICE_HELP} Attach files with attachments: a screenshot ` +
        'shows what a paragraph would describe.',
      inputSchema: {
        channel: z.string().describe(CHANNEL_HELP),
        text: z.string().describe('The message.'),
        attachments: z.array(z.string()).optional().describe(ATTACHMENTS_HELP),
        target_id: z
          .number()
          .int()
          .optional()
          .describe('The target this message announces: its card, with epics and tickets, shows under the message.'),
        to: z.enum([BOSS]).optional().describe(TO_HELP),
      },
    },
    ({ channel, text, attachments, target_id, to }) =>
      run(() => {
        const channelId = resolve(channel)
        const message = chat.post({
          authorId: employee.id,
          channelId,
          text: textAddressedToBoss({ channelId, text, toBoss: to === BOSS }, chat.people()),
          ...attach(attachments),
          ...(target_id !== undefined && { targetId: target_id }),
        })
        return { id: message.id, channel: label(message.channelId), ...attachedView(message) }
      }),
  )

  server.registerTool(
    'chat_read',
    {
      description:
        'Read recent messages of a channel or DM, oldest first. With thread_id, read that thread instead. ' +
        'The channel’s topic and its pinned messages come with it: read them before you answer, they are ' +
        'what the channel decided. A message that carries files lists them with the path to read each at.',
      inputSchema: {
        channel: z.string().describe(CHANNEL_HELP),
        thread_id: z.number().int().optional().describe('The id of a thread’s first message.'),
        limit: z.number().int().min(1).max(200).optional().describe('How many messages, default 50.'),
      },
    },
    ({ channel, thread_id, limit }) =>
      run(() => {
        const channelId = resolve(channel)
        const messages = chat.read({
          channelId,
          ...(thread_id !== undefined && { threadId: thread_id }),
          ...(limit !== undefined && { limit }),
        })
        const { topic } = chat.channels().find((c) => c.id === channelId) ?? { topic: '' }
        const pins = chat.pins(channelId)
        const pinnedIds = new Set(pins.map((p) => p.id))
        return {
          channel: label(channelId),
          ...(topic && { topic }),
          ...(pins.length > 0 && { pinned: pins.map(pinView) }),
          messages: messages.map((message) => view(message, pinnedIds)),
        }
      }),
  )

  server.registerTool(
    'chat_pin',
    {
      description:
        'Pin a message so the whole channel keeps it: a decision, the plan, the link everyone asks for. ' +
        'Pinned messages come back with every chat_read of that channel. Pass pinned: false to unpin one.',
      inputSchema: {
        message_id: z.number().int().describe('The message to pin.'),
        pinned: z.boolean().optional().describe('False unpins it. Default true.'),
      },
    },
    ({ message_id, pinned }) =>
      run(() => {
        const message =
          pinned === false
            ? chat.unpinMessage({ messageId: message_id })
            : chat.pinMessage({ messageId: message_id, byId: employee.id })
        return {
          id: message.id,
          channel: label(message.channelId),
          pinned: pinned !== false,
          pins: chat.pins(message.channelId).length,
        }
      }),
  )

  server.registerTool(
    'thread_reply',
    {
      description:
        'Reply in the thread of a message. Replies to a reply go to the same thread. Takes the same ' +
        `attachments as chat_post. ${VOICE_HELP}`,
      inputSchema: {
        message_id: z.number().int().describe('Any message of the thread.'),
        text: z.string().describe('The reply.'),
        attachments: z.array(z.string()).optional().describe(ATTACHMENTS_HELP),
      },
    },
    ({ message_id, text, attachments }) =>
      run(() => {
        const reply = chat.reply({
          authorId: employee.id,
          messageId: message_id,
          text,
          ...attach(attachments),
        })
        return {
          id: reply.id,
          thread_id: reply.threadId,
          channel: label(reply.channelId),
          ...attachedView(reply),
        }
      }),
  )
}
