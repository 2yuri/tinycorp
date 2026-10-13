import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeHookHandler } from './claude/adapter'
import { codexHookHandler } from './codex/adapter'
import { gitBashPath, HOOK_TOKEN_ENV, HOOK_TOKEN_HEADER, hookCommand, installHookFile } from './provider-hooks'

/**
 * The hook command is the only thing TinyCorp asks another product's shell to run, and until T166
 * there was one form of it: POSIX sh. Neither Windows shell understands a word of
 * `[ -z "$VAR" ] || curl … >/dev/null`, so a Session on a Windows without Git for Windows, and
 * every Codex Session on Windows at all, started and then never said anything about itself again.
 */

const URL = 'http://127.0.0.1:7377/hook'

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'provider-hooks-'))
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

describe('hookCommand', () => {
  it('is POSIX sh by default, and does nothing without the Session token', () => {
    const command = hookCommand(URL)

    expect(command).toContain(`[ -z "$${HOOK_TOKEN_ENV}" ] ||`)
    expect(command).toContain(`-H "${HOOK_TOKEN_HEADER}: $${HOOK_TOKEN_ENV}"`)
    expect(command).toContain(`'${URL}'`)
    // Whatever it did, the hook itself succeeded: a receiver that is not there is not a failure.
    expect(command.endsWith('; true')).toBe(true)
  })

  it('asks whether curl is there, and has a node fallback for a Linux without one', () => {
    const command = hookCommand(URL)

    expect(command).toContain('command -v curl')
    expect(command).toContain('node -e')
    // The whole node script sits inside one pair of single quotes, so it may not contain one.
    const script = command.slice(command.indexOf("node -e '") + "node -e '".length)
    expect(script.slice(0, script.indexOf("'"))).not.toContain("'")
  })

  it('has a PowerShell form, for a Claude Code on a Windows with no Git Bash', () => {
    const command = hookCommand(URL, 'powershell')

    expect(command).toContain(`if ($env:${HOOK_TOKEN_ENV})`)
    expect(command).toContain('curl.exe')
    expect(command).toContain(`-H "${HOOK_TOKEN_HEADER}: $env:${HOOK_TOKEN_ENV}"`)
    expect(command).toContain("'@-'")
    expect(command.endsWith('exit 0')).toBe(true)
    // Nothing of the POSIX form survives: `[`, `/dev/null` and `|| true` are all sh.
    expect(command).not.toContain('/dev/null')
    expect(command).not.toContain('[ -z')
  })

  it('has a cmd.exe form, which is what Codex runs a hook in on Windows', () => {
    const command = hookCommand(URL, 'cmd')

    expect(command).toContain(`if not "%${HOOK_TOKEN_ENV}%"==""`)
    expect(command).toContain('curl.exe')
    expect(command).toContain(`-H "${HOOK_TOKEN_HEADER}: %${HOOK_TOKEN_ENV}%"`)
    // Whatever curl did, the hook itself succeeded: a receiver that is not there is not a failure.
    expect(command.endsWith('& exit /b 0')).toBe(true)
    expect(command).not.toContain('/dev/null')
    expect(command).not.toContain('$')
  })

  it('throws the reply away without a redirection, because a product reads a hook’s stdout', () => {
    expect(hookCommand(URL, 'powershell')).toContain('-o NUL')
    expect(hookCommand(URL, 'cmd')).toContain('-o NUL')
  })
})

/**
 * The POSIX command, run by a real `/bin/sh` against a real receiver (T177).
 *
 * `curl` is on every Mac and on no minimal Linux, and the command's own `|| true` meant a missing
 * one looked exactly like a receiver that was not listening: the Session ran and the office never
 * heard from it. These are the runs that would have caught it — the same command, once with curl
 * on `PATH` and once with nothing on it but `node`.
 *
 * Windows is skipped: there is no `/bin/sh` there, and Git Bash — where this same string does run
 * on Windows — is not something a runner is promised.
 */
describe.skipIf(process.platform === 'win32')('the POSIX hook command, actually run', () => {
  let server: Server
  let posted: { token: string | undefined; type: string | undefined; body: string }[]
  let url: string

  beforeEach(async () => {
    posted = []
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        posted.push({
          token: request.headers[HOOK_TOKEN_HEADER] as string | undefined,
          type: request.headers['content-type'],
          body,
        })
        response.end('ok')
      })
    })
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
    const address = server.address()
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/hook`
  })

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()))
  })

  /**
   * Runs the command in a real sh and settles: either the receiver has heard it, or `expected` is
   * 0 and the wait is the grace a post would have needed had one been coming.
   */
  async function run(env: NodeJS.ProcessEnv, event: string, expected = 1) {
    // Never `spawnSync`: the receiver is in this very process, and a blocked event loop would
    // leave curl waiting out its own `-m 3` before anything answered it.
    const result = await new Promise<{ code: number | null; out: string }>((done) => {
      const child = spawn('/bin/sh', ['-c', hookCommand(url)], { env, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (chunk) => (out += chunk))
      child.stderr.on('data', (chunk) => (out += chunk))
      child.on('close', (code) => done({ code, out }))
      // A hook with nothing to post exits before it reads its stdin; that is not this test's failure.
      child.stdin.on('error', () => {})
      child.stdin.end(event)
    })
    // A hook that fails is a hook the product reports; whatever happened, the exit code is 0.
    expect(result.code).toBe(0)
    // Nothing on either stream: a product that reads a hook's stdout must be handed nothing.
    expect(result.out).toBe('')
    for (let wait = 0; wait < 100 && posted.length < expected; wait++) {
      await new Promise((tick) => setTimeout(tick, 10))
    }
    if (expected === 0) await new Promise((tick) => setTimeout(tick, 50))
    return result
  }

  /** A `PATH` with `node` on it and nothing else — a minimal Linux with no `curl` installed. */
  function nodeOnlyPath(): string {
    const bin = join(folder, 'bin')
    mkdirSync(bin, { recursive: true })
    symlinkSync(execFileSync('/bin/sh', ['-c', 'command -v node'], { encoding: 'utf8' }).trim(), join(bin, 'node'))
    return bin
  }

  it('posts the event to the receiver where curl is there', async () => {
    await run({ ...process.env, [HOOK_TOKEN_ENV]: 'session-1' }, '{"hook_event_name":"Stop"}')

    expect(posted).toEqual([{ token: 'session-1', type: 'application/json', body: '{"hook_event_name":"Stop"}' }])
  })

  it('posts the same event, byte for byte, on a machine with no curl at all', async () => {
    await run({ PATH: nodeOnlyPath(), [HOOK_TOKEN_ENV]: 'session-2' }, '{"hook_event_name":"Notification"}')

    expect(posted).toEqual([
      { token: 'session-2', type: 'application/json', body: '{"hook_event_name":"Notification"}' },
    ])
  })

  it('says nothing at all when the CLI was not started by TinyCorp', async () => {
    const env = { ...process.env }
    delete env[HOOK_TOKEN_ENV]
    await run(env, '{"hook_event_name":"Stop"}', 0)

    expect(posted).toEqual([])
  })

  it('stays quiet, and still succeeds, with neither curl nor node on the machine', async () => {
    await run({ PATH: join(folder, 'empty'), [HOOK_TOKEN_ENV]: 'session-3' }, '{}', 0)

    expect(posted).toEqual([])
  })
})

describe('gitBashPath', () => {
  it('takes Claude Code’s own setting first, when it points at a file that is there', () => {
    const bash = join(folder, 'bash.exe')
    writeFileSync(bash, '')

    expect(gitBashPath({ CLAUDE_CODE_GIT_BASH_PATH: bash })).toBe(bash)
  })

  it('finds Git for Windows where its installer puts it', () => {
    const root = join(folder, 'Program Files')
    mkdirSync(join(root, 'Git', 'bin'), { recursive: true })
    const bash = join(root, 'Git', 'bin', 'bash.exe')
    writeFileSync(bash, '')

    expect(gitBashPath({ ProgramFiles: root })).toBe(bash)
  })

  it('is null on a machine with no Git for Windows, which is a supported Windows', () => {
    expect(gitBashPath({ ProgramFiles: join(folder, 'nowhere') })).toBeNull()
    expect(gitBashPath({})).toBeNull()
  })
})

describe('claudeHookHandler', () => {
  it('is the POSIX command alone off Windows', () => {
    expect(claudeHookHandler(URL, {}, 'darwin')).toEqual({ type: 'command', command: hookCommand(URL) })
  })

  it('pins bash on a Windows that has Git Bash, which is the shell Claude Code picks there', () => {
    const bash = join(folder, 'bash.exe')
    writeFileSync(bash, '')

    expect(claudeHookHandler(URL, { CLAUDE_CODE_GIT_BASH_PATH: bash }, 'win32')).toEqual({
      type: 'command',
      command: hookCommand(URL, 'posix'),
      shell: 'bash',
    })
  })

  it('writes the PowerShell command, and says so, when the machine has no Git Bash', () => {
    expect(claudeHookHandler(URL, {}, 'win32')).toEqual({
      type: 'command',
      command: hookCommand(URL, 'powershell'),
      shell: 'powershell',
    })
  })
})

describe('codexHookHandler', () => {
  it('carries both commands, because Codex reads commandWindows in place of command on Windows', () => {
    expect(codexHookHandler(URL)).toEqual({
      type: 'command',
      command: hookCommand(URL),
      commandWindows: hookCommand(URL, 'cmd'),
    })
  })
})

describe('installHookFile', () => {
  it('writes whatever handler the product needs, per event', () => {
    const file = join(folder, 'hooks.json')

    installHookFile({ file, events: ['SessionStart', 'Stop'], hookUrl: URL, handler: codexHookHandler })

    const written = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, { hooks: unknown[] }[]> }
    expect(written.hooks['SessionStart']![0]!.hooks).toEqual([codexHookHandler(URL)])
    expect(written.hooks['Stop']![0]!.hooks).toEqual([codexHookHandler(URL)])
  })

  it('replaces our own entry however it was written before, and keeps everyone else’s', () => {
    const file = join(folder, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'echo theirs' }] },
            // Ours, as an earlier build wrote it: the token only appears in `commandWindows`.
            { hooks: [{ type: 'command', command: 'echo x', commandWindows: `%${HOOK_TOKEN_ENV}%` }] },
          ],
        },
      }),
    )

    installHookFile({ file, events: ['SessionStart'], hookUrl: URL, handler: codexHookHandler })

    const written = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, { hooks: unknown[] }[]> }
    expect(written.hooks['SessionStart']).toHaveLength(2)
    expect(written.hooks['SessionStart']![0]!.hooks).toEqual([{ type: 'command', command: 'echo theirs' }])
    expect(written.hooks['SessionStart']![1]!.hooks).toEqual([codexHookHandler(URL)])
  })
})
