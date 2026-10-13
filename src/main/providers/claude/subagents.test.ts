import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onDisk } from '../../core/testing'
import { createSubagentModel } from '../../features/sessions/subagents'
import type { HookPayload } from '../provider-adapter'
import { CLAUDE_HOOK_EVENTS, claudeHookSignal, claudeSubagentSignal } from './adapter'

/**
 * What `claude` 2.1.280 sent, in order, when asked to run two subagents in parallel — recorded
 * off a real run and trimmed to the fields that matter. Both agents were backgrounded: the call
 * came back at once with `async_launched`, the parent's turn ended while they worked, and each one
 * reported its own stop later.
 */
const CWD = onDisk('/work/acme')
const PROMPT_ONE = 'Count the words in notes.txt.\nUse the Bash tool with wc.'
const RECORDED: HookPayload[] = [
  { hook_event_name: 'UserPromptSubmit', prompt: 'Run two subagents in parallel' },
  {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: 'toolu_one',
    tool_input: { description: 'count words', prompt: PROMPT_ONE, subagent_type: 'general-purpose' },
  },
  { hook_event_name: 'SubagentStart', agent_id: 'a-one', agent_type: 'general-purpose' },
  {
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: 'toolu_one',
    tool_input: { description: 'count words', prompt: PROMPT_ONE, subagent_type: 'general-purpose' },
    tool_response: { isAsync: true, status: 'async_launched', agentId: 'a-one', description: 'count words' },
  },
  {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: 'toolu_two',
    tool_input: { description: 'list files', prompt: 'List the files here.', subagent_type: 'general-purpose' },
  },
  { hook_event_name: 'SubagentStart', agent_id: 'a-two', agent_type: 'general-purpose' },
  {
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: 'toolu_two',
    tool_input: { description: 'list files', prompt: 'List the files here.', subagent_type: 'general-purpose' },
    tool_response: { isAsync: true, status: 'async_launched', agentId: 'a-two', description: 'list files' },
  },
  {
    hook_event_name: 'Stop',
    background_tasks: [
      { id: 'a-one', type: 'subagent', status: 'running', description: 'count words' },
      { id: 'a-two', type: 'subagent', status: 'running', description: 'list files' },
    ],
  },
  {
    hook_event_name: 'PreToolUse',
    agent_id: 'a-two',
    agent_type: 'general-purpose',
    cwd: CWD,
    tool_name: 'Bash',
    tool_use_id: 'toolu_ls',
    tool_input: { command: 'ls -la', description: 'List files' },
  },
  {
    hook_event_name: 'PreToolUse',
    agent_id: 'a-one',
    agent_type: 'general-purpose',
    cwd: CWD,
    tool_name: 'Bash',
    tool_use_id: 'toolu_wc',
    tool_input: { command: 'wc -w notes.txt', description: 'Count words' },
  },
  {
    hook_event_name: 'SubagentStop',
    agent_id: 'a-one',
    agent_type: 'general-purpose',
    last_assistant_message: 'The word count in notes.txt is **1 word**.',
  },
]

function replay(hooks: HookPayload[], model = createSubagentModel()) {
  let second = 0
  for (const hook of hooks) {
    const signal = claudeSubagentSignal(hook)
    if (signal) model.apply(signal, new Date(Date.UTC(2026, 8, 22, 9, 0, second++)))
  }
  return model
}

describe('Claude Code subagents, from its hooks', () => {
  it('registers the two hooks that report subagents', () => {
    expect(CLAUDE_HOOK_EVENTS).toContain('SubagentStart')
    expect(CLAUDE_HOOK_EVENTS).toContain('SubagentStop')
  })

  it('draws two subagents from a real run: one done, one still running what it runs', () => {
    const [one, two] = replay(RECORDED).list()

    expect(one).toMatchObject({
      id: 'toolu_one',
      name: 'count words',
      task: 'Count the words in notes.txt.',
      state: 'done',
      now: 'wc -w notes.txt',
    })
    expect(one!.endedAt).not.toBeNull()
    expect(two).toMatchObject({ name: 'list files', state: 'running', now: 'ls -la', endedAt: null })
  })

  it('keeps the prompt’s first line and none of the rest', () => {
    const [one] = replay(RECORDED.slice(0, 2)).list()

    expect(one!.state).toBe('started')
    expect(JSON.stringify(one)).not.toContain('Use the Bash tool')
  })

  it('clips a long description and a long first line', () => {
    const [one] = replay([
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_use_id: 'toolu_long',
        tool_input: { description: 'd'.repeat(300), prompt: `${'p'.repeat(5000)}\nsecret second line` },
      },
    ]).list()

    expect(one!.name.length).toBeLessThanOrEqual(40)
    expect(one!.task.length).toBeLessThanOrEqual(120)
    expect(one!.task.endsWith('…')).toBe(true)
  })

  it('ends a foreground subagent when its call returns, even if its stop is never heard', () => {
    const [one] = replay([
      RECORDED[1]!,
      RECORDED[2]!,
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: 'toolu_one',
        tool_response: { status: 'completed', agentId: 'a-one', prompt: PROMPT_ONE },
      },
    ]).list()

    expect(one!.state).toBe('done')
  })

  it('ends a background subagent whose stop was lost once the parent says it is no longer running', () => {
    const model = replay(RECORDED.slice(0, 8))
    replay(
      [{ hook_event_name: 'Stop', background_tasks: [{ id: 'a-two', type: 'subagent', status: 'running' }] }],
      model,
    )

    expect(model.list().map((row) => [row.name, row.state])).toEqual([
      ['count words', 'done'],
      ['list files', 'running'],
    ])
  })

  it('pairs each agent with its own call when the product names it, not by arrival order', () => {
    const call = (id: string, description: string): HookPayload => ({
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_use_id: id,
      tool_input: { description, prompt: description, subagent_type: 'general-purpose' },
    })
    const model = replay([
      call('toolu_a', 'first'),
      call('toolu_b', 'second'),
      // The second call's agent reports in first, so the guess pairs it with the first call…
      { hook_event_name: 'SubagentStart', agent_id: 'agent-b', agent_type: 'general-purpose' },
      { hook_event_name: 'PreToolUse', agent_id: 'agent-b', tool_name: 'Bash', tool_input: { command: 'b' } },
      { hook_event_name: 'SubagentStart', agent_id: 'agent-a', agent_type: 'general-purpose' },
      // …until the calls return and say which agent is whose.
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: 'toolu_b',
        tool_response: { status: 'async_launched', agentId: 'agent-b' },
      },
      { hook_event_name: 'SubagentStop', agent_id: 'agent-b' },
    ])

    expect(model.list().map((row) => [row.name, row.state, row.now])).toEqual([
      ['first', 'running', null],
      ['second', 'done', 'b'],
    ])
  })

  it('counts the files a subagent edits, once each', () => {
    const edit = (file: string): HookPayload => ({
      hook_event_name: 'PreToolUse',
      agent_id: 'a-one',
      cwd: CWD,
      tool_name: 'Edit',
      tool_input: { file_path: join(CWD, file), old_string: 'x', new_string: 'y' },
    })
    const [one] = replay([...RECORDED.slice(1, 4), edit('src/a.ts'), edit('src/b.ts'), edit('src/a.ts')]).list()

    expect(one).toMatchObject({ filesChanged: 2, now: `Edit ${join('src', 'a.ts')}` })
  })

  it('reads nothing about subagents from the parent’s own tools', () => {
    expect(
      claudeSubagentSignal({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }),
    ).toBeNull()
    expect(claudeSubagentSignal({ hook_event_name: 'SessionStart' })).toBeNull()
  })

  it('leaves the status machine where it was: a subagent’s start or stop is not the parent going idle', () => {
    expect(claudeHookSignal({ hook_event_name: 'SubagentStart', agent_id: 'a' })).toBeNull()
    expect(claudeHookSignal({ hook_event_name: 'SubagentStop', agent_id: 'a' })).toBeNull()
  })
})
