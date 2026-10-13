import { describe, expect, it } from 'vitest'
import { isOrchestratorVar, ORCHESTRATOR_ENV_PREFIXES, withoutOrchestratorEnv } from './orchestrator-env'

describe('another orchestrator’s environment', () => {
  it('takes out the variables its global hook reads to decide whose pane an event is', () => {
    // The bug (T234): TinyCorp is started from the boss's shell, Orca was driving that shell, and
    // Orca's hook in ~/.claude/settings.json fires for a TinyCorp Employee because it finds these.
    const env = withoutOrchestratorEnv({
      ORCA_PANE_KEY: 'pane-7',
      ORCA_AGENT_HOOK_PORT: '7181',
      ORCA_AGENT_HOOK_TOKEN: 'another-app-s-bearer-token',
      CONDUCTOR_WORKSPACE_NAME: 'the-boss-s-other-workspace',
      PATH: '/usr/bin',
      HOME: '/Users/boss',
    })

    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/boss' })
  })

  it('leaves alone a variable that only begins like one', () => {
    // A prefix, not a substring: `ORCHESTRA_KEY` is somebody's synth, and `ORCA` on its own is a
    // word. Stripping either would be this app taking something it was never asked to take.
    const env = { ORCHESTRA_KEY: 'C minor', ORCA: 'whale', MY_ORCA_THING: 'kept' }

    expect(withoutOrchestratorEnv(env)).toEqual(env)
  })

  it('reads a prefix that is a prefix of a name we have never seen', () => {
    // Why the denylist is prefixes and not names: the next variable one of them adds is covered.
    expect(isOrchestratorVar('ORCA_SOMETHING_INVENTED_TOMORROW')).toBe(true)
    expect(isOrchestratorVar('ANTHROPIC_API_KEY')).toBe(false)
  })

  it('names every prefix with its trailing underscore, so it can never match a bare word', () => {
    for (const prefix of ORCHESTRATOR_ENV_PREFIXES) {
      expect(prefix, `${prefix} would match a variable that merely starts with those letters`).toMatch(/_$/)
    }
  })
})
