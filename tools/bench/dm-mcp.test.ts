import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHAT_TOOLS, readDm } from './dm.mjs'
import { duoMcpConfig, ROLES } from './duo.mjs'

/**
 * The chat server a `duo` cell starts, spoken to the way Claude Code speaks to it (T197).
 *
 * This is the test that pays for itself. A `duo` run is real sessions on the boss's subscription,
 * and a stand-in whose `chat_post` silently fails is a run where nobody DMs anybody, every cell
 * looks cheap and quiet, and the report says the terse voice saves nothing. So the server is
 * started as a real process, over real stdio, and both Employees' ends are exercised against one
 * file: Ada posts, Vega reads it, Vega replies in the thread, Ada sees the reply.
 */

const dir = mkdtempSync(join(tmpdir(), 'tinycorp-bench-dm-'))
const dmFile = join(dir, 'dm.jsonl')

/** One Employee's end of the chat, started exactly as `duoMcpConfig` says to start it. */
async function connect(me: string, peer: string): Promise<Client> {
  const { command, args, env } = duoMcpConfig({ me, peer, dmFile }).mcpServers['company']
  const client = new Client({ name: 'bench-test', version: '0.0.0' })
  await client.connect(new StdioClientTransport({ command, args, env: { ...env, PATH: process.env['PATH'] ?? '' } }))
  return client
}

/** A tool's JSON answer, or the error text it refused with. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? ''
  return { isError: result.isError === true, text, json: result.isError ? null : JSON.parse(text) }
}

let ada: Client
let vega: Client

beforeAll(async () => {
  writeFileSync(dmFile, '')
  ada = await connect(ROLES.lead.name, ROLES.helper.name)
  vega = await connect(ROLES.helper.name, ROLES.lead.name)
}, 60_000)

afterAll(async () => {
  await ada?.close()
  await vega?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('the stand-in chat server', () => {
  it('offers the three tools an Employee is told about, described in the app’s own words', async () => {
    const { tools } = await ada.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['chat_post', 'chat_read', 'thread_reply'])
    expect(tools.find((tool) => tool.name === 'chat_post')?.description).toBe(CHAT_TOOLS.chat_post)
  })

  it('carries a DM from one Employee to the other through the file they share', async () => {
    const posted = await call(ada, 'chat_post', {
      channel: `@${ROLES.helper.name}`,
      text: 'where does the comment API live?',
    })
    expect(posted.json).toMatchObject({ id: 1, channel: `@${ROLES.helper.name}` })

    const read = await call(vega, 'chat_read', { channel: `@${ROLES.lead.name}` })
    expect(read.json.messages).toEqual([
      { id: 1, author: ROLES.lead.name, text: 'where does the comment API live?', at: expect.any(String) },
    ])
  })

  it('threads a reply, and the thread comes back to whoever asks for it', async () => {
    const reply = await call(vega, 'thread_reply', { message_id: 1, text: 'api/comments, L12' })
    expect(reply.json).toMatchObject({ id: 2, thread_id: 1 })

    const thread = await call(ada, 'chat_read', { channel: `@${ROLES.helper.name}`, thread_id: 1 })
    expect(thread.json.messages.map((one: { author: string }) => one.author)).toEqual([ROLES.helper.name])
  })

  it('keeps every message on disk, which is what the report counts afterwards', () => {
    const messages = readDm(readFileSync(dmFile, 'utf8'))
    expect(messages.map((one) => one.author)).toEqual([ROLES.lead.name, ROLES.helper.name])
    expect(messages.every((one) => one.channelId === 'dm')).toBe(true)
  })

  it('refuses a message to somebody who is not there, and a DM to yourself, as the app does', async () => {
    expect((await call(ada, 'chat_post', { channel: '@Iris', text: 'hello?' })).text).toMatch(/Iris/)
    expect((await call(ada, 'chat_post', { channel: `@${ROLES.lead.name}`, text: 'hello?' })).text).toMatch(/yourself/)
  })

  it('answers a reply to a message that does not exist with an error, not a new thread', async () => {
    expect((await call(vega, 'thread_reply', { message_id: 404, text: 'x' })).text).toMatch(/404/)
  })
})
