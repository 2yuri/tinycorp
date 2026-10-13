import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { CHAT_TOOLS, dmRecord, readDm, resolveChannel, viewMessage } from './dm.mjs'

/**
 * The chat an Employee has in a `duo` cell of `pnpm bench:tokens` (T197): `chat_post`, `chat_read`
 * and `thread_reply` over stdio, registered under the same server name the app registers its
 * Company server under, so the tool an Employee calls is spelled `mcp__company__chat_post` here
 * exactly as it is in TinyCorp.
 *
 * It is a stand-in and not the real thing: the real one is `src/main/features/chat/tools.ts`, and it
 * needs a Company folder, a SQLite database, an Electron main process and two live Employee
 * sessions to wake. What the bench needs from it is what the Employee reads and writes — the tool
 * names, the descriptions those tools carry, and a durable thread both sessions can see — so those
 * are copied word for word from the app (`dm.mjs` holds them, and a test keeps them in step) and
 * the storage is one JSONL file. Nothing about the voice being measured lives in the difference.
 *
 * Started by Claude Code itself, one process per Employee, with `BENCH_DM_ME`, `BENCH_DM_PEER` and
 * `BENCH_DM_FILE` in its environment. It is an entry point, so it is a line in `knip.json`.
 */

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; dm-mcp.mjs is started by the bench, not by hand`)
  return value
}

const me = env('BENCH_DM_ME')
const peer = env('BENCH_DM_PEER')
const file = env('BENCH_DM_FILE')

/** Every message so far. The file is the whole state; two Employees never write at the same time. */
function all() {
  return existsSync(file) ? readDm(readFileSync(file, 'utf8')) : []
}

/** Appends one message and answers with what the app answers: its id and the channel it landed in. */
function post({ channel, text, threadId = null }) {
  const messages = all()
  const record = dmRecord({
    id: messages.length + 1,
    author: me,
    channelId: resolveChannel(channel, { me, peer }),
    text,
    threadId,
  })
  appendFileSync(file, `${JSON.stringify(record)}\n`)
  return record
}

/** A tool's JSON result, or its error message as a tool error — the app's own `run` (chat-tools.ts). */
function run(action) {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(action()) }] }
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
  }
}

const server = new McpServer({ name: 'company', version: '0.0.0' })

server.registerTool(
  'chat_post',
  {
    description: CHAT_TOOLS.chat_post,
    inputSchema: {
      channel: z.string().describe(CHAT_TOOLS.channelHelp),
      text: z.string().describe('The message.'),
    },
  },
  ({ channel, text }) =>
    run(() => {
      const message = post({ channel, text })
      return { id: message.id, channel: `@${peer}` }
    }),
)

server.registerTool(
  'chat_read',
  {
    description: CHAT_TOOLS.chat_read,
    inputSchema: {
      channel: z.string().describe(CHAT_TOOLS.channelHelp),
      thread_id: z.number().int().optional().describe('The id of a thread’s first message.'),
      limit: z.number().int().min(1).max(200).optional().describe('How many messages, default 50.'),
    },
  },
  ({ channel, thread_id, limit }) =>
    run(() => {
      const channelId = resolveChannel(channel, { me, peer })
      const here = all().filter(
        (message) => message.channelId === channelId && (thread_id === undefined || message.threadId === thread_id),
      )
      return {
        channel: channelId === 'dm' ? `@${peer}` : `#${channelId}`,
        messages: here.slice(-(limit ?? 50)).map(viewMessage),
      }
    }),
)

server.registerTool(
  'thread_reply',
  {
    description: CHAT_TOOLS.thread_reply,
    inputSchema: {
      message_id: z.number().int().describe('Any message of the thread.'),
      text: z.string().describe('The reply.'),
    },
  },
  ({ message_id, text }) =>
    run(() => {
      const messages = all()
      const root = messages.find((message) => message.id === message_id)
      if (!root) throw new Error(`There is no message ${message_id}`)
      const reply = post({
        channel: root.channelId === 'dm' ? `@${peer}` : `#${root.channelId}`,
        text,
        threadId: root.threadId ?? root.id,
      })
      return { id: reply.id, thread_id: reply.threadId, channel: `@${peer}` }
    }),
)

await server.connect(new StdioServerTransport())
