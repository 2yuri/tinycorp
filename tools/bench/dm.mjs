/**
 * The DM thread two Employees share in a `duo` cell (T197): what the stand-in chat server says
 * about itself, what one message is on disk, and how much prose the thread ended up carrying.
 *
 * Both halves of a cell read this file — `dm-mcp.mjs`, the server Claude Code starts per Employee,
 * and `duo.mjs`, the harness that wakes each of them with what the other said — so the two cannot
 * disagree about the format, and neither of them holds a copy of the app's words.
 *
 * Every sentence in {@link CHAT_TOOLS} is word for word from `src/main/features/chat/tools.ts`, and
 * `duo.test.ts` fails when one of them is not there any more. Sentences about things this stand-in
 * does not have — attachments, pins, a topic, the real Company's channels — are left out rather
 * than reworded: an Employee must not be told about a parameter that is not on the tool, and a
 * paraphrase of the app is a measurement of something the app does not send.
 */

/** The audience rule the two writing tools carry, from `VOICE_HELP` in the app. */
const VOICE_HELP =
  'Voice: a DM to a colleague follows the Company’s setting for Employees (terse by default: ' +
  'fragments, no filler, code and errors exact). Anywhere the boss reads — a channel, a thread, a DM ' +
  'to the boss — is plain words in full sentences.'

/**
 * Each tool's description, in the pieces the app's own is built from. Every piece is one contiguous
 * run of words from `chat-tools.ts`, which is what lets `duo.test.ts` look each of them up there
 * rather than take the whole description on trust.
 */
export const CHAT_TOOL_PARTS = {
  chat_post: [
    'Post a message to a Company channel or DM. Mention people with @Name, everyone with @channel.',
    // The boss's own sentence stays out: a `duo` cell is two Employees and a DM, with no boss to address.
    'Write like a colleague: the point first, no bullet lists or headings, and longer than a few ' +
      'sentences belongs in the ticket.',
    VOICE_HELP,
  ],
  chat_read: ['Read recent messages of a channel or DM, oldest first. With thread_id, read that thread instead.'],
  thread_reply: ['Reply in the thread of a message. Replies to a reply go to the same thread.', VOICE_HELP],
}

/** What the Employee reads about each tool, and about the one argument every tool takes. */
export const CHAT_TOOLS = {
  channelHelp: '"@Name" (an Employee) or "@boss" for a direct message.',
  ...Object.fromEntries(Object.entries(CHAT_TOOL_PARTS).map(([name, parts]) => [name, parts.join(' ')])),
}

/** The one channel a `duo` cell has: the DM between its two Employees. */
export const DM_CHANNEL = 'dm'

/**
 * `@Vega` or `#tech` → a channel id. The DM is the only channel with anyone in it, and a channel
 * an Employee invents is kept under its own name rather than refused, so the report can say it
 * posted somewhere nobody reads instead of the cell failing on it.
 */
export function resolveChannel(where, { me, peer }) {
  const address = where.trim()
  if (!address.startsWith('@')) return address.replace(/^#/, '')
  const name = address.slice(1).toLowerCase()
  if (name === me.toLowerCase()) throw new Error('You cannot DM yourself')
  if (name === peer.toLowerCase()) return DM_CHANNEL
  throw new Error(`Nobody is called ${address}`)
}

/** One message, as the file keeps it. */
export function dmRecord({ id, author, channelId, text, threadId = null, at = new Date().toISOString() }) {
  return { id, author, channelId, text, threadId, at }
}

/** The thread, read. A half-written last line is dropped rather than guessed at. */
export function readDm(text) {
  const messages = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      messages.push(JSON.parse(line))
    } catch {
      // The server was still flushing.
    }
  }
  return messages
}

/** One message as the Employee reading the channel sees it, in the shape the app's `view` returns. */
export function viewMessage(message) {
  return {
    id: message.id,
    author: message.author,
    text: message.text,
    ...(message.threadId !== null && { thread_id: message.threadId }),
    at: message.at,
  }
}

/**
 * How much prose the thread carried, per author and in all — the number the terse voice exists to
 * move, and the one a cold one-ticket bench could not produce.
 *
 * `estTokens` is characters ÷ 4, the same rough conversion RTK's own `gain` uses, and it is an
 * estimate: it is printed beside the words and the characters so nobody has to take it on faith.
 * Every word here is paid twice, once by the Employee that wrote it and once by the one woken with
 * it, so the report doubles it where it compares the two arms.
 */
export function dmTraffic(messages) {
  const count = (list) => {
    const chars = list.reduce((sum, message) => sum + message.text.length, 0)
    return {
      messages: list.length,
      chars,
      words: list.reduce((sum, message) => sum + message.text.split(/\s+/).filter(Boolean).length, 0),
      estTokens: Math.round(chars / 4),
    }
  }
  const authors = [...new Set(messages.map((message) => message.author))].sort()
  return {
    ...count(messages),
    elsewhere: messages.filter((message) => message.channelId !== DM_CHANNEL).length,
    byAuthor: Object.fromEntries(
      authors.map((author) => [author, count(messages.filter((message) => message.author === author))]),
    ),
  }
}
