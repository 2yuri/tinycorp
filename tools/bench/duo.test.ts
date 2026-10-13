import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { armOf, armSystemPrompt } from './arms.mjs'
import {
  CHAT_TOOL_PARTS,
  CHAT_TOOLS,
  DM_CHANNEL,
  dmRecord,
  dmTraffic,
  readDm,
  resolveChannel,
  viewMessage,
} from './dm.mjs'
import {
  DUO_MAX_DELIVERIES,
  duoMcpConfig,
  duoUnits,
  nextDelivery,
  peerOf,
  ROLES,
  rolePrompt,
  VOICE_HINT,
  wakePrompt,
} from './duo.mjs'
import { readTasks } from './plan.mjs'

/**
 * The two-Employee shape of `pnpm bench:tokens` (T197).
 *
 * The tests that matter here are the ones about faithfulness. The arm is a claim about TinyCorp's
 * own colleague voice, so every sentence the bench puts in front of an Employee — the voice clause
 * in a wake prompt, the description on `chat_post` — has to be the sentence the app puts there. A
 * paraphrase would produce a percentage for words the app does not send, which is the same kind of
 * lie as a contaminated baseline: plausible, quotable, and about nothing.
 */

const REPO = join(import.meta.dirname, '..', '..')

/**
 * A repo source file with its string concatenation joined back up and its `\uXXXX` escapes resolved,
 * so a sentence written across four lines of TypeScript can be looked up as the sentence it is.
 * Quotes and backticks both, because the app breaks a description over both.
 */
function source(...where: string[]): string {
  return readFileSync(join(REPO, ...where), 'utf8')
    .replace(/['`]\s*\+\s*\n?\s*['`]/g, '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
}

const tasks = readTasks()
const task = tasks.find((one) => one.id === 'edit-comment')
if (!task) throw new Error('the duo round needs the edit-comment ticket')

describe('the wake prompt', () => {
  const message = { id: 7, text: 'auth.ts L40–88 — which hook owns the cache?' }

  it('is the app’s own inboxPrompt shape for a DM', () => {
    const prompt = wakePrompt({ from: 'Ada', message, voice: 'terse' })
    expect(prompt.startsWith('[company] DM from Ada in @Ada: ')).toBe(true)
    expect(prompt).toContain(JSON.stringify(message.text))
    expect(prompt).toContain('(message 7)')
    expect(prompt).toContain('Reply through the company MCP server: chat_post to "@Ada", or thread_reply to message 7.')
    expect(prompt).toContain('Never answer in plain text.')
  })

  it('carries the sentences inbox.ts writes, word for word', () => {
    const inbox = source('src', 'main', 'features', 'inbox', 'inbox.ts')
    expect(inbox).toContain('Reply through the company MCP server: ')
    expect(inbox).toContain('Never answer in plain text.')
    expect(inbox).toContain('[company] ')
  })

  it('names the voice for that one message, as the engine does and never the model', () => {
    expect(wakePrompt({ from: 'Ada', message, voice: 'terse' })).toContain(VOICE_HINT.terse)
    expect(wakePrompt({ from: 'Ada', message, voice: 'plain' })).toContain(VOICE_HINT.plain)
  })

  it('quotes the voice clause word for word from colleague-voice.ts, which is what is being measured', () => {
    const voice = source('src', 'shared', 'colleague-voice.ts')
    for (const hint of Object.values(VOICE_HINT)) {
      expect(voice, `the bench sends a voice clause the app no longer says: ${hint}`).toContain(hint)
    }
  })
})

describe('the two roles', () => {
  it('are two people, each with the other as their peer', () => {
    expect(peerOf('lead')).toBe(ROLES.helper)
    expect(peerOf('helper')).toBe(ROLES.lead)
    expect(ROLES.lead.name).not.toBe(ROLES.helper.name)
  })

  it('tell the lead to DM the colleague twice, which is what makes the thread the same length per arm', () => {
    const lead = rolePrompt('lead', { task })
    expect(lead).toContain(`1. Before you write code, DM ${ROLES.helper.name}`)
    expect(lead).toContain(`2. When the change is ready, DM ${ROLES.helper.name}`)
  })

  it('tell the colleague not to write files, because both Employees share one checkout', () => {
    const helper = rolePrompt('helper', { task })
    expect(helper).toMatch(/do not create, edit or delete a file/)
    expect(helper).toContain(task.prompt)
  })

  it('say the same thing in both arms: the only difference between them is the voice section', () => {
    const plain = armOf('dm-plain')
    const terse = armOf('dm-terse')
    if (!plain || !terse) throw new Error('the duo arms are missing')
    for (const role of ['lead', 'helper']) {
      const mine = rolePrompt(role, { task })
      expect(`${armSystemPrompt(terse)}\n\n${mine}`).toContain(mine)
      expect(`${armSystemPrompt(plain)}\n\n${mine}`).toContain(mine)
    }
  })

  it('tells both of them to answer through MCP and never in the terminal', () => {
    for (const role of ['lead', 'helper']) {
      expect(rolePrompt(role, { task })).toContain('Never answer in plain text: nobody reads your terminal.')
    }
  })
})

describe('the chat tools the stand-in offers', () => {
  it('describes each one in the app’s own words, so the Employee reads what it reads in TinyCorp', () => {
    const app = source('src', 'main', 'features', 'chat', 'tools.ts')
    for (const [name, parts] of Object.entries(CHAT_TOOL_PARTS)) {
      for (const part of parts) {
        expect(app, `${name} is described in words chat-tools.ts does not use: ${part}`).toContain(part)
        expect(CHAT_TOOLS[name as keyof typeof CHAT_TOOLS]).toContain(part)
      }
    }
  })

  it('carries the audience rule both writing tools carry in the app', () => {
    expect(CHAT_TOOLS.chat_post).toContain('Voice: a DM to a colleague follows')
    expect(CHAT_TOOLS.thread_reply).toContain('Voice: a DM to a colleague follows')
    expect(CHAT_TOOLS.chat_post).toBe(CHAT_TOOLS.chat_post.trim())
  })

  it('offers no parameter the stand-in does not have', () => {
    for (const text of Object.values(CHAT_TOOLS)) {
      expect(text).not.toContain('attachments')
      expect(text).not.toContain('pinned')
    }
  })
})

describe('the DM channel', () => {
  it('reads @peer as the one DM there is, and refuses a DM to yourself as the app does', () => {
    expect(resolveChannel('@Vega', { me: 'Ada', peer: 'Vega' })).toBe(DM_CHANNEL)
    expect(resolveChannel('@vega', { me: 'Ada', peer: 'Vega' })).toBe(DM_CHANNEL)
    expect(() => resolveChannel('@Ada', { me: 'Ada', peer: 'Vega' })).toThrow(/yourself/)
    expect(() => resolveChannel('@Iris', { me: 'Ada', peer: 'Vega' })).toThrow(/Iris/)
  })

  it('keeps a channel an Employee invented under its own name, so the report can say it posted there', () => {
    expect(resolveChannel('#tech', { me: 'Ada', peer: 'Vega' })).toBe('tech')
  })

  it('round-trips a message through the file the two servers share', () => {
    const one = dmRecord({ id: 1, author: 'Ada', channelId: DM_CHANNEL, text: 'hi' })
    const [read] = readDm(`${JSON.stringify(one)}\n\n`)
    expect(read).toEqual(one)
    expect(viewMessage(one)).toEqual({ id: 1, author: 'Ada', text: 'hi', at: one.at })
    expect(viewMessage({ ...one, threadId: 1 })).toMatchObject({ thread_id: 1 })
  })

  it('drops a half-written line rather than failing the cell it was measuring', () => {
    expect(readDm('{"id":1}\n{"id":')).toEqual([{ id: 1 }])
  })
})

describe('what the thread came to', () => {
  const messages = [
    dmRecord({ id: 1, author: 'Ada', channelId: DM_CHANNEL, text: 'where does the comment API live' }),
    dmRecord({ id: 2, author: 'Vega', channelId: DM_CHANNEL, text: 'api/comments' }),
    dmRecord({ id: 3, author: 'Ada', channelId: 'tech', text: 'anyone about?' }),
  ]

  it('counts characters, words and an estimate in tokens, per author and in all', () => {
    const traffic = dmTraffic(messages)
    expect(traffic.messages).toBe(3)
    expect(traffic.chars).toBe(messages.reduce((sum, one) => sum + one.text.length, 0))
    expect(traffic.estTokens).toBe(Math.round(traffic.chars / 4))
    expect(traffic.byAuthor['Vega']).toEqual({ messages: 1, chars: 12, words: 1, estTokens: 3 })
    expect(traffic.byAuthor['Ada']?.messages).toBe(2)
  })

  it('says how many went somewhere that is not the DM, rather than dropping them', () => {
    expect(dmTraffic(messages).elsewhere).toBe(1)
  })

  it('is all zeroes for a thread nobody wrote in, which is a result and not a missing cell', () => {
    expect(dmTraffic([])).toMatchObject({ messages: 0, chars: 0, words: 0, estTokens: 0, byAuthor: {} })
  })
})

describe('the turn taking', () => {
  const messages = [
    { channelId: 'tech', id: 1, text: 'x', author: 'Ada' },
    { channelId: DM_CHANNEL, id: 2, text: 'y', author: 'Ada' },
    { channelId: DM_CHANNEL, id: 3, text: 'z', author: 'Vega' },
  ]

  it('delivers the DMs in order and skips what was posted elsewhere', () => {
    const first = nextDelivery(messages, 0)
    expect(first?.message.id).toBe(2)
    const second = nextDelivery(messages, first?.cursor ?? 0)
    expect(second?.message.id).toBe(3)
    expect(nextDelivery(messages, second?.cursor ?? 0)).toBeNull()
  })

  it('has a ceiling, because every wake is a real session turn on the boss’s subscription', () => {
    expect(DUO_MAX_DELIVERIES).toBeGreaterThan(2)
    expect(DUO_MAX_DELIVERIES).toBeLessThanOrEqual(6)
  })
})

describe('the chat server a duo cell starts', () => {
  it('is this repo’s dm-mcp.mjs, under the name the app registers its own server under', () => {
    const config = duoMcpConfig({ me: 'Ada', peer: 'Vega', dmFile: '/tmp/dm.jsonl' })
    expect(Object.keys(config.mcpServers)).toEqual(['company'])
    expect(config.mcpServers['company'].command).toBe(process.execPath)
    expect(config.mcpServers['company'].args[0]?.endsWith('dm-mcp.mjs')).toBe(true)
    expect(config.mcpServers['company'].env).toEqual({
      BENCH_DM_ME: 'Ada',
      BENCH_DM_PEER: 'Vega',
      BENCH_DM_FILE: '/tmp/dm.jsonl',
    })
  })
})

describe('the duo units', () => {
  it('are tickets from the same folder the solo mode reads, and say which one is missing', () => {
    expect(duoUnits(tasks).map((one) => one.id)).toEqual(['edit-comment'])
    expect(() => duoUnits(tasks, ['nope'])).toThrow(/nope/)
  })
})
