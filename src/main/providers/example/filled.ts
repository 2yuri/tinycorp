import { asking } from '../provider-adapter'
import { stripAnsi } from '../provider-hooks'
import type { ExampleCli } from './cli'

/**
 * What `cli-todo.ts` looks like once it is filled in, for the test that proves the template goes
 * green. It answers for a CLI that does not exist — `example`, with the plainest spelling of each
 * thing — so a contributor can read one complete set of answers beside the questions.
 *
 * A real Provider deletes this file: its answers live in `cli-todo.ts`, or folded back into the
 * adapter the way `providers/claude/adapter.ts` writes them.
 */
export const FILLED_EXAMPLE_CLI: ExampleCli = {
  instructionArgs: (text) => ['--system-prompt', text],

  // `example` takes the app's own id for a conversation, and continues it with --continue.
  sessionArgs: (sessionId, resume) => (resume ? ['--continue', sessionId] : ['--session', sessionId]),

  mcpArgs: (configPath) => ['--mcp-config', configPath],

  modelArgs: (model, effort) => ['--model', model, ...(effort ? ['--effort', effort] : [])],

  // `ask` is `example` stopping to ask its user before it acts, which is what T165 is about.
  hookEvents: ['start', 'prompt', 'tool', 'ask', 'done', 'end'],

  signalOf(hook) {
    switch (hook['event']) {
      case 'start':
        return 'ready'
      case 'prompt':
      case 'tool':
        return 'busy'
      case 'ask':
        // The Session is stopped waiting for an answer; `tool` and `done` are what clear it.
        return asking(typeof hook['about'] === 'string' ? hook['about'] : 'a permission')
      case 'done':
        return 'idle'
      default:
        return null
    }
  },

  sessionIdOf: (hook) =>
    typeof hook['conversation'] === 'string' && hook['conversation'] ? hook['conversation'] : null,

  confirmsResume: (hook) => hook['event'] === 'start' && hook['resumed'] === true,

  limitHit: (output) => /usage limit reached/i.test(stripAnsi(output)),

  limitResetAt(output, now) {
    const match = /resets in (?:(\d+)h )?(?:(\d+)m)?/i.exec(stripAnsi(output))
    if (!match || (!match[1] && !match[2])) return null
    const ms = Number(match[1] ?? 0) * 3_600_000 + Number(match[2] ?? 0) * 60_000
    return ms > 0 ? new Date(now.getTime() + ms) : null
  },

  submitKey: '\r',

  signIn: {
    statusArgs: ['auth', 'status'],
    installWith: 'npm install -g example-cli',
    signInWith: 'example auth login',
    verdict(outcome) {
      if (outcome.kind !== 'output' || /\bnot signed in\b/i.test(outcome.output)) return 'none'
      if (/\bapi key\b/i.test(outcome.output)) return 'api-key'
      return /\bsigned in\b/i.test(outcome.output) ? 'subscription' : 'none'
    },
  },
}
