import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProviderPlacement } from '../../shared/platform/wsl'
import { isWsl } from '../platform'

/**
 * The hook plumbing every Provider shares. Each CLI product has its own file and its own event
 * names, but they all run a shell command per event and hand it the event's JSON on stdin, so the
 * command, the token that identifies the Session and the git exclusion are written once here.
 */

/** The env var a spawned Session's hooks read their token from. */
export const HOOK_TOKEN_ENV = 'TINYCORP_HOOK_TOKEN'
/** The header the hook receiver reads the token from. */
export const HOOK_TOKEN_HEADER = 'x-tinycorp-token'

/**
 * The shells a product runs a hook command in. There is no one answer, so the command has three
 * forms and each adapter writes the ones its own product will run (T166):
 *
 * - `posix` is macOS and Linux, and Windows where the product runs hooks in Git Bash;
 * - `powershell` is Claude Code on a Windows with no Git for Windows, which is supported and
 *   common: Git Bash is optional there, and without it Claude Code's own default is PowerShell;
 * - `cmd` is Codex on Windows, which runs every hook through `%COMSPEC% /C`.
 *
 * All three do the one thing: POST the event's stdin JSON to the receiver with the Session's
 * token, and nothing at all when the CLI was not started by TinyCorp, so the boss's own runs of
 * `claude` in a Company folder stay quiet. `curl.exe` ships with Windows 10 and later, so the two
 * Windows forms need nothing installed.
 */
export type HookShell = 'posix' | 'powershell' | 'cmd'

/** The shell command a hook runs, in the form `shell` parses. */
export function hookCommand(hookUrl: string, shell: HookShell = 'posix'): string {
  if (shell === 'powershell') return powershellHookCommand(hookUrl)
  if (shell === 'cmd') return cmdHookCommand(hookUrl)
  return posixHookCommand(hookUrl)
}

/**
 * The POSIX sh form: macOS, Linux, and Git Bash on Windows.
 *
 * `curl` is on every Mac and it is **not** on every Linux (T177). A Fedora Workstation has it, a
 * Debian netinstall and most container images do not, and the failure was silent by design —
 * `|| true` is there so a receiver that is not listening does not fail the Employee's own
 * command, and it swallowed a missing `curl` just as quietly. The Session would run and the
 * office would never hear a word from it.
 *
 * So the command asks first, and falls back to {@link nodeHookPost}: `node` is there whenever
 * `claude` or `opencode` is, because both are npm packages. On a machine with neither the branch
 * fails and `true` keeps the exit code at 0, which is the same silence as before and never a
 * broken hook.
 *
 * The check is inside the command rather than done once when the file is written, because the
 * file outlives the machine's state: a Company folder is synced, and the `curl` the boss removed
 * yesterday would otherwise be found in a settings file written last month.
 */
function posixHookCommand(hookUrl: string): string {
  const token = `$${HOOK_TOKEN_ENV}`
  const curl =
    `curl -s -m 3 -X POST -H 'Content-Type: application/json' ` +
    `-H "${HOOK_TOKEN_HEADER}: ${token}" --data-binary @- '${hookUrl}'`
  return (
    `[ -z "${token}" ] || { if command -v curl >/dev/null 2>&1; then ${curl}; ` +
    `else ${nodeHookPost(hookUrl)}; fi; } >/dev/null 2>&1; true`
  )
}

/**
 * The same POST in `node -e`, for a machine with no `curl`. It is written without a single quote
 * anywhere in it, because the whole script goes inside one pair of them in the sh command above —
 * the same thing the curl form already assumes about the URL, which TinyCorp writes itself and is
 * always `http://127.0.0.1:<port>/…`.
 *
 * `http` rather than `fetch`: the receiver is `127.0.0.1` and the body is whatever the product
 * wrote on stdin, byte for byte, which is what `--data-binary @-` meant. The timeout matches
 * curl's `-m 3`, and every error is swallowed for the same reason curl's was.
 */
export function nodeHookPost(hookUrl: string): string {
  const script = [
    'const c=[];process.stdin.on("data",d=>c.push(d)).on("end",()=>{',
    'const b=Buffer.concat(c);',
    `const r=require("http").request(${JSON.stringify(hookUrl)},{method:"POST",headers:{`,
    '"Content-Type":"application/json",',
    `"${HOOK_TOKEN_HEADER}":process.env.${HOOK_TOKEN_ENV},`,
    '"Content-Length":b.length}});',
    'r.setTimeout(3000,()=>r.destroy());r.on("error",()=>{});r.end(b)})',
  ].join('')
  return `node -e '${script}'`
}

/**
 * The PowerShell form. `-o NUL` throws the reply away rather than a redirection, because a product
 * that reads a hook's stdout must be handed nothing; `exit 0` because a receiver that is not
 * listening is not a hook that failed.
 */
function powershellHookCommand(hookUrl: string): string {
  const token = `$env:${HOOK_TOKEN_ENV}`
  return (
    `if (${token}) { curl.exe -s -o NUL -m 3 -X POST -H 'Content-Type: application/json' ` +
    `-H "${HOOK_TOKEN_HEADER}: ${token}" --data-binary '@-' '${hookUrl}' }; exit 0`
  )
}

/**
 * The `cmd.exe` form. `if not "%VAR%"==""` is the guard — an unset variable leaves the two empty
 * strings equal — and `& exit /b 0` is the `|| true`, on its own so it runs whatever curl did.
 */
function cmdHookCommand(hookUrl: string): string {
  const token = `%${HOOK_TOKEN_ENV}%`
  return (
    `if not "${token}"=="" curl.exe -s -o NUL -m 3 -X POST -H "Content-Type: application/json" ` +
    `-H "${HOOK_TOKEN_HEADER}: ${token}" --data-binary @- "${hookUrl}" & exit /b 0`
  )
}

/**
 * The platform a Session's own **hooks** run on, which is not always the one the app runs on (T258).
 *
 * A Session inside a WSL distro is a Linux process, and a product runs a hook command where it runs
 * itself — so its hooks are POSIX ones whatever this Windows has installed. Written by host, a
 * `claude` in Arch on a Windows with no Git for Windows was handed a PowerShell command line: a hook
 * that fires and does nothing, so the Session never reports ready and the boss watches a terminal
 * that works beside a card that says it does not. And Git Bash being *present* was no better: `bash`
 * pinned in the entry is a shell the distro has never heard of.
 *
 * It takes the placement rather than the runtime because that is what an adapter is handed.
 */
export function hookPlatform(
  placement: Pick<ProviderPlacement, 'chosen'> | null,
  host: NodeJS.Platform = process.platform,
): NodeJS.Platform {
  return isWsl(placement?.chosen) ? 'linux' : host
}

/**
 * Where Git for Windows keeps its bash, or null when this machine has none. Claude Code runs hook
 * commands in Git Bash when it is there and in PowerShell when it is not, so the app has to know
 * which before it can write a command either will run (T166). `CLAUDE_CODE_GIT_BASH_PATH` is
 * Claude Code's own setting for a Git that is somewhere else, and it is read first for that reason.
 */
export function gitBashPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env['CLAUDE_CODE_GIT_BASH_PATH'],
    ...['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']
      .map((variable) => env[variable])
      .flatMap((root) => (root ? [join(root, 'Git', 'bin', 'bash.exe')] : [])),
    ...(env['LOCALAPPDATA'] ? [join(env['LOCALAPPDATA'], 'Programs', 'Git', 'bin', 'bash.exe')] : []),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not there. Try the next one.
    }
  }
  return null
}

/** One handler in a product's hook file. Every product has `type` and `command`; the rest differ. */
export interface HookHandler {
  type: string
  command?: string
  [key: string]: unknown
}

export interface HookEntry {
  matcher?: string
  hooks?: HookHandler[]
}

export interface HookFileRequest {
  /** The provider's hook file, e.g. `<cwd>/.claude/settings.json`. */
  file: string
  /** The events to hook, in the order the file should list them. */
  events: readonly string[]
  hookUrl: string
  /** The matcher an event needs, when the product takes one. */
  matcher?(event: string): string | undefined
  /**
   * The handler this product needs, when the POSIX command alone is not it: Claude Code pins the
   * shell it runs the command in, and Codex carries a second command for Windows (T166).
   */
  handler?(hookUrl: string): HookHandler
}

/**
 * Writes the status hooks into a provider's hook file under its `hooks` key, keeping every other
 * setting and every hook that is not ours. Our own entries are replaced, so a respawn never
 * stacks them up. Throws rather than overwrite a file it cannot read.
 */
export function installHookFile({ file, events, hookUrl, matcher, handler = posixHandler }: HookFileRequest): void {
  mkdirSync(dirname(file), { recursive: true })
  let settings: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      throw new Error(`Cannot add hooks: ${file} is not valid JSON`)
    }
  }
  const hooks = { ...(settings['hooks'] as Record<string, HookEntry[]> | undefined) }
  for (const event of events) {
    const others = (hooks[event] ?? []).filter((entry) => !isOurs(entry))
    const only = matcher?.(event)
    hooks[event] = [...others, { ...(only !== undefined && { matcher: only }), hooks: [handler(hookUrl)] }]
  }
  writeFileSync(file, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`)
}

/**
 * The command a product's hook runs to have RTK rewrite the Bash command it is about to run (T179).
 *
 * `rtk hook <agent>` is RTK's own native processor, in the binary since 0.37.2: it reads the hook's
 * stdin JSON and answers in that product's protocol. There is nothing else on the line — no shell
 * built-in, no pipe, no `jq` — so the three forms differ only in how the path is quoted, which is
 * the one thing the three shells disagree about.
 *
 * The path is quoted every time, because a boss on Windows may well have RTK under
 * `C:\Program Files`, and an unquoted space there runs a program called `C:\Program`.
 */
export function rtkHookCommand(path: string, agent: string, shell: HookShell = 'posix'): string {
  if (shell === 'powershell') return `& '${path.replace(/'/g, "''")}' hook ${agent}`
  if (shell === 'cmd') return `"${path}" hook ${agent}`
  return `'${path.replace(/'/g, `'\\''`)}' hook ${agent}`
}

/**
 * Whether a handler in a product's hook file is an RTK rewrite for `agent`.
 *
 * Read off the command rather than off a marker of our own: the boss can move RTK, upgrade it or
 * reinstall it somewhere else between two Sessions, and the entry that has to come out is the one
 * that runs `rtk hook <agent>` wherever that binary now lives.
 */
export function isRtkRewrite(hook: HookHandler, agent: string): boolean {
  const pattern = new RegExp(String.raw`(?:^|[\\/\s'"&])rtk(?:\.exe)?['"]?\s+hook\s+${agent}\b`, 'i')
  return Object.values(hook).some((value) => typeof value === 'string' && pattern.test(value))
}

export interface RewriteHookRequest {
  /** The provider's hook file, e.g. `<cwd>/.claude/settings.json`. */
  file: string
  /** The event a command rewrite belongs on. Every product that has one calls it `PreToolUse`. */
  event: string
  /** The tool the rewrite is for, when the product takes a matcher: `Bash`. */
  matcher?: string
  /** RTK's own agent name in `rtk hook <agent>`, which is how an old entry is recognised. */
  agent: string
  /** The handler to write, or null to take whatever rewrite is in there back out. */
  handler: HookHandler | null
}

/**
 * Writes RTK's command rewrite into a product's hook file beside our status hooks, or takes it back
 * out again (T179).
 *
 * Out is half the job and not an afterthought: the hook file lives in the Company folder and
 * outlives the Session, so a boss who turns the toggle off would go on being compressed for as long
 * as that file stood. Off means off at the next start, and this is where that happens.
 *
 * It never creates a file to remove something from: a Company folder no Session has started in has
 * no rewrite to take out.
 */
export function installRewriteHook({ file, event, matcher, agent, handler }: RewriteHookRequest): void {
  if (handler === null && !existsSync(file)) return
  mkdirSync(dirname(file), { recursive: true })
  let settings: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      throw new Error(`Cannot add hooks: ${file} is not valid JSON`)
    }
  }
  const hooks = { ...(settings['hooks'] as Record<string, HookEntry[]> | undefined) }
  const others = (hooks[event] ?? []).filter((entry) => !(entry.hooks ?? []).some((hook) => isRtkRewrite(hook, agent)))
  hooks[event] = handler ? [...others, { ...(matcher !== undefined && { matcher }), hooks: [handler] }] : others
  writeFileSync(file, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`)
}

/** What a product that runs one shell command and nothing else gets. */
export function posixHandler(hookUrl: string): HookHandler {
  return { type: 'command', command: hookCommand(hookUrl) }
}

function isOurs(entry: HookEntry): boolean {
  return entry.hooks?.some((hook) => ours(hook)) ?? false
}

/** Ours by the one thing no other hook carries: the Session token's variable, in any of its forms. */
function ours(hook: HookHandler): boolean {
  return Object.values(hook).some((value) => typeof value === 'string' && value.includes(HOOK_TOKEN_ENV))
}

/** Terminal output without the escape sequences a TUI paints it with. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, '')
}
