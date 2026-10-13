import { describe, expect, it } from 'vitest'
import type { Arm } from './arms.mjs'
import { ARMS, armOf, armSystemPrompt } from './arms.mjs'
import {
  cellEnv,
  claudeArgs,
  hooksFired,
  isolationBreaches,
  MODELS,
  mcpServersUsed,
  parseRtkGain,
  readResult,
  resolveCli,
  skillsOffered,
  sumResults,
  systemPrompt,
  type TranscriptRecord,
  totalTokens,
} from './session.mjs'

/**
 * One cell of `pnpm bench:tokens` (T190), and the checks that decide whether its numbers count.
 *
 * `isolationBreaches` is the reason this file exists. ponytail's first agentic benchmark published
 * a result its own authors later withdrew: the plugin under test had a `SessionStart` hook that
 * fired on every arm, so the baseline was secretly running the treatment and the gap it measured
 * was noise. The fix was a flag; the flag is a claim until something reads the transcript back and
 * says what actually loaded. These are the tests for that reader.
 */

function transcript(parts: TranscriptRecord[]): TranscriptRecord[] {
  return parts
}

function hook(name: string): TranscriptRecord {
  return { type: 'attachment', attachment: { type: 'hook_success', hookName: name } }
}

function skills(names: string[]): TranscriptRecord {
  return {
    type: 'attachment',
    attachment: { type: 'skill_listing', content: names.map((name) => `- ${name}: does a thing`).join('\n') },
  }
}

function prompt(text: string): TranscriptRecord {
  return { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: [text] } }
}

/** The arm by id. A miss fails here, with the id in it, rather than as a null five lines later. */
function armNamed(id: string): Arm {
  const one = armOf(id)
  if (!one) throw new Error(`no arm ${id}`)
  return one
}

const baseline = armNamed('baseline')
const rtk = armNamed('rtk')
const ponytail = armNamed('ponytail')

/** A transcript's system prompt as Claude Code records it: its own preamble, then what we append. */
function promptFor(arm: typeof baseline): string {
  return `You are an interactive agent…\n\n${armSystemPrompt(arm)}`
}

describe('the isolation check', () => {
  it('fails a baseline whose session ran a hook — the bug that voided ponytail’s first benchmark', () => {
    const records = transcript([hook('SessionStart'), skills(['dataviz']), prompt(promptFor(baseline))])
    const bad = isolationBreaches({ arm: baseline, records, others: ARMS })
    expect(bad.some((line) => line.includes('SessionStart'))).toBe(true)
  })

  it('passes an RTK arm running exactly the hook it declares', () => {
    const records = transcript([hook('PreToolUse:Bash'), skills(['dataviz']), prompt(promptFor(rtk))])
    expect(isolationBreaches({ arm: rtk, records, others: ARMS })).toEqual([])
  })

  it('fails an RTK arm that also ran something else', () => {
    const records = transcript([hook('PreToolUse:Bash'), hook('SessionStart'), prompt(promptFor(rtk))])
    expect(isolationBreaches({ arm: rtk, records, others: ARMS })).toEqual([expect.stringContaining('SessionStart')])
  })

  it('fails when a plugin’s skill was offered, since no arm declares one', () => {
    const records = transcript([skills(['dataviz', 'anthropic-skills:pdf']), prompt(promptFor(baseline))])
    const bad = isolationBreaches({ arm: baseline, records, others: ARMS })
    expect(bad).toEqual([expect.stringContaining('anthropic-skills:pdf')])
  })

  it('fails when the system prompt holds another arm’s text', () => {
    const records = transcript([prompt(`${promptFor(baseline)}\n\n${promptFor(ponytail)}`)])
    const bad = isolationBreaches({ arm: baseline, records, others: ARMS })
    expect(bad.some((line) => line.includes('ponytail'))).toBe(true)
  })

  it('fails when the arm’s own text is missing from the prompt it ran with', () => {
    const records = transcript([prompt(promptFor(baseline))])
    const bad = isolationBreaches({ arm: ponytail, records, others: ARMS })
    expect(bad.some((line) => line.includes('is not in the system prompt'))).toBe(true)
  })

  it('fails a cell with no transcript rather than passing one that was never checked', () => {
    expect(isolationBreaches({ arm: baseline, records: null })).toEqual([expect.stringContaining('no transcript')])
  })

  it('fails a transcript that recorded no system prompt at all', () => {
    const bad = isolationBreaches({ arm: baseline, records: transcript([skills(['dataviz'])]), others: ARMS })
    expect(bad).toEqual([expect.stringContaining('no system prompt')])
  })
})

describe('reading a transcript', () => {
  it('names every hook that fired, once each', () => {
    expect(hooksFired(transcript([hook('PreToolUse:Bash'), hook('PreToolUse:Bash'), hook('Stop')]))).toEqual([
      'PreToolUse:Bash',
      'Stop',
    ])
  })

  it('reads a skill listing including the namespaced ones a plugin brings', () => {
    expect(skillsOffered(transcript([skills(['run', 'mattpocock-skills:tdd'])]))).toEqual([
      'mattpocock-skills:tdd',
      'run',
    ])
  })

  it('joins a system prompt recorded in parts', () => {
    expect(systemPrompt(transcript([{ attachment: { type: 'prompt_snapshot', systemPrompt: ['a', 'b'] } }]))).toBe(
      'a\nb',
    )
    expect(systemPrompt(transcript([]))).toBeNull()
  })
})

describe('the arguments a cell is started with', () => {
  const args = claudeArgs({
    prompt: 'do the thing',
    model: 'sonnet',
    arm: rtk,
    settingsFile: '/tmp/cell/settings.json',
    sessionId: 'abc',
    budgetUsd: 3,
  })

  it('leaves the boss’s own settings, plugins and MCP servers out of every cell', () => {
    expect(args).toContain('--setting-sources')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('project,local')
    expect(args).toContain('--strict-mcp-config')
    expect(args).not.toContain('--mcp-config')
  })

  it('pins the model to an id rather than an alias that moves when a new model ships', () => {
    expect(args[args.indexOf('--model') + 1]).toBe(MODELS['sonnet'])
    const passthrough = claudeArgs({
      prompt: 'x',
      model: 'claude-something-7',
      arm: baseline,
      settingsFile: null,
      sessionId: 'a',
    })
    expect(passthrough[passthrough.indexOf('--model') + 1]).toBe('claude-something-7')
  })

  it('asks for the JSON result and a session id, which is how the numbers and the transcript are found', () => {
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')
    expect(args[args.indexOf('--session-id') + 1]).toBe('abc')
  })

  it('passes a settings file only for an arm that has one', () => {
    expect(args).toContain('--settings')
    const plain = claudeArgs({ prompt: 'x', model: 'sonnet', arm: baseline, settingsFile: null, sessionId: 'a' })
    expect(plain).not.toContain('--settings')
  })
})

describe('the environment a cell runs in', () => {
  it('strips an inherited API key, because this spends a subscription and never an account', () => {
    const env = cellEnv({ env: { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't' } })
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
    expect(env['PATH']).toBe('/bin')
  })

  it('gives an RTK cell its own history file and keeps RTK’s ping off', () => {
    const env = cellEnv({ rtkDbPath: '/tmp/cell/rtk.db', env: { PATH: '/bin' } })
    expect(env['RTK_DB_PATH']).toBe('/tmp/cell/rtk.db')
    expect(env['RTK_TELEMETRY_DISABLED']).toBe('1')
  })

  it('sets neither for a cell with no RTK', () => {
    expect(cellEnv({ env: { PATH: '/bin' } })['RTK_DB_PATH']).toBeUndefined()
  })
})

describe('the result JSON', () => {
  const json = JSON.stringify({
    is_error: false,
    subtype: 'success',
    session_id: 'abc',
    total_cost_usd: 0.5123,
    num_turns: 9,
    duration_api_ms: 1000,
    permission_denials: [{}, {}],
    usage: {
      input_tokens: 12,
      output_tokens: 3400,
      cache_read_input_tokens: 400_000,
      cache_creation_input_tokens: 20_000,
    },
    modelUsage: { 'claude-sonnet-5': {} },
  })

  it('keeps cache tokens apart from fresh input, which is most of what a session moves', () => {
    const result = readResult(json)
    if (!result) throw new Error('the result JSON did not parse')
    expect(result.inputTokens).toBe(12)
    expect(result.cacheReadTokens).toBe(400_000)
    expect(result.cacheWriteTokens).toBe(20_000)
    expect(totalTokens(result)).toBe(423_412)
  })

  it('records the model the CLI actually billed, not the one the bench asked for', () => {
    expect(readResult(json)?.model).toBe('claude-sonnet-5')
  })

  it('is null for output that is not the result JSON, rather than a row of zeroes', () => {
    expect(readResult('')).toBeNull()
    expect(readResult('Error: something went wrong')).toBeNull()
  })
})

describe('rtk gain', () => {
  it('reads the summary RTK prints', () => {
    const gain = parseRtkGain(
      JSON.stringify({
        summary: { total_commands: 2, total_input: 197, total_output: 52, total_saved: 145, avg_savings_pct: 73.604 },
      }),
    )
    expect(gain).toEqual({ commands: 2, inputTokens: 197, outputTokens: 52, savedTokens: 145, cutPercent: 73.6 })
  })

  it('is null for anything else, because an RTK that could not be read saved an unknown amount', () => {
    expect(parseRtkGain('not json')).toBeNull()
    expect(parseRtkGain('{}')).toBeNull()
    expect(parseRtkGain(JSON.stringify({ summary: {} }))).toBeNull()
  })
})

describe('finding a CLI', () => {
  it('crosses PATH with PATHEXT on Windows and leaves it alone everywhere else', () => {
    expect(resolveCli('definitely-not-a-real-command-9184', { PATH: '/nowhere' }, 'linux')).toBeNull()
    expect(resolveCli('node')).not.toBeNull()
  })
})

describe('two arms that share a text on purpose', () => {
  /**
   * `ponytail` and `rtk+ponytail` prepend the same `SKILL.md` and differ by the hook alone. The
   * first real run of this bench flagged all three of their cells as contaminated because of it —
   * the check was reading *the same text* as *another arm's text*, which is the design, not a
   * crossed wire.
   */
  it('are not contamination in each other’s transcripts', () => {
    const both = armNamed('rtk+ponytail')
    const one = armNamed('ponytail')
    expect(isolationBreaches({ arm: one, records: [prompt(promptFor(one))], others: ARMS })).toEqual([])
    expect(
      isolationBreaches({ arm: both, records: [hook('PreToolUse:Bash'), prompt(promptFor(both))], others: ARMS }),
    ).toEqual([])
  })
})

describe('a leg of a longer cell (T197)', () => {
  const args = (over: Partial<Parameters<typeof claudeArgs>[0]>) =>
    claudeArgs({
      prompt: 'p',
      model: 'sonnet',
      arm: baseline,
      settingsFile: null,
      sessionId: 'S',
      budgetUsd: 3,
      ...over,
    })

  it('starts the first leg and resumes every one after, so the Employee is one session', () => {
    expect(args({})).toContain('--session-id')
    expect(args({})).not.toContain('--resume')
    expect(args({ resume: true })).toContain('--resume')
    expect(args({ resume: true })).not.toContain('--session-id')
    expect(args({ resume: true })[args({ resume: true }).indexOf('--resume') + 1]).toBe('S')
  })

  it('keeps the arm’s text contiguous when a role is appended, which the isolation check relies on', () => {
    const appended = args({ extra: 'You are Ada.' })
    const text = appended[appended.indexOf('--append-system-prompt') + 1] ?? ''
    expect(text).toContain(armSystemPrompt(baseline))
    expect(text.endsWith('You are Ada.')).toBe(true)
  })

  it('gives a session MCP servers only when it is handed a config, and never loosens --strict-mcp-config', () => {
    expect(args({})).toContain('--strict-mcp-config')
    expect(args({})).not.toContain('--mcp-config')
    const withServer = args({ mcpConfigFile: '/tmp/mcp.json' })
    expect(withServer).toContain('--strict-mcp-config')
    expect(withServer[withServer.indexOf('--mcp-config') + 1]).toBe('/tmp/mcp.json')
  })
})

describe('adding a cell’s legs up', () => {
  const leg = (over: Partial<ReturnType<typeof readResult> & object> = {}) => ({
    ...(readResult(
      JSON.stringify({
        is_error: false,
        subtype: 'success',
        session_id: 'S',
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
        total_cost_usd: 0.5,
        num_turns: 3,
        modelUsage: { 'claude-sonnet-5': {} },
      }),
    ) as NonNullable<ReturnType<typeof readResult>>),
    ...over,
  })

  it('adds the tokens, the cost and the turns, because a cell is a unit of work and not a process', () => {
    const sum = sumResults([leg(), leg()])
    if (!sum) throw new Error('two measured legs summed to nothing')
    expect(totalTokens(sum)).toBe(200)
    expect(sum.costUsd).toBe(1)
    expect(sum.turns).toBe(6)
    expect(sum.model).toBe('claude-sonnet-5')
    expect(sum.ok).toBe(true)
  })

  it('is not ok when any leg was not, so a cell that broke halfway cannot read as a clean one', () => {
    expect(sumResults([leg(), leg({ ok: false })])?.ok).toBe(false)
    expect(sumResults([leg(), null])?.ok).toBe(false)
  })

  it('is null for nothing at all, which is how an unmeasured cell stays out of every median', () => {
    expect(sumResults([])).toBeNull()
    expect(sumResults([null, null])).toBeNull()
  })
})

describe('the MCP check', () => {
  const tools = (names: string[]): TranscriptRecord => ({
    type: 'assistant',
    message: { content: names.map((name) => ({ type: 'tool_use', name })) },
  })

  it('reads the servers a session actually called off its tool names', () => {
    expect(mcpServersUsed([tools(['Read', 'mcp__company__chat_post', 'mcp__company__chat_read'])])).toEqual(['company'])
    expect(mcpServersUsed([tools(['mcp__linear__list_issues'])])).toEqual(['linear'])
    expect(mcpServersUsed([{ type: 'user' }])).toEqual([])
  })

  it('fails an arm that reached a server it does not declare — the boss’s own MCP in a measured cell', () => {
    const records = [tools(['mcp__linear__list_issues']), prompt(promptFor(baseline))]
    expect(isolationBreaches({ arm: baseline, records, others: ARMS })).toEqual([expect.stringContaining('linear')])
  })

  it('passes a duo arm calling the chat server it declares', () => {
    const dm = armNamed('dm-terse')
    const records = [tools(['mcp__company__chat_post']), prompt(promptFor(dm))]
    expect(isolationBreaches({ arm: dm, records, others: ARMS })).toEqual([])
  })

  it('does not call a DM arm contaminated for carrying the voice text a solo arm also carries', () => {
    const dm = armNamed('dm-terse')
    expect(isolationBreaches({ arm: dm, records: [prompt(promptFor(dm))], others: ARMS })).toEqual([])
    const plain = armNamed('dm-plain')
    expect(isolationBreaches({ arm: plain, records: [prompt(promptFor(plain))], others: ARMS })).toEqual([])
  })
})
