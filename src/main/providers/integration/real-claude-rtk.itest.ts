/**
 * RTK against a real `claude` on the developer's or CI's subscription (T179): a Session runs
 * `git status`, and the command RTK's own history records is the rewritten one.
 *
 * Everything else about RTK is checked with fakes. This is the one question fakes cannot answer —
 * *does Claude Code really run the hook we wrote, and does RTK really rewrite the command* — and it
 * is the question that breaks when either product changes its hook file.
 *
 * Slow, and it spends subscription usage, so it is not part of `pnpm test`; run it with
 * `pnpm test:claude`. Skipped without a credential, and skipped without `rtk` on this machine —
 * TinyCorp never installs it, and neither does its test suite.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  parseRtkGain,
  RTK_COMMAND,
  RTK_DB_ENV,
  RTK_TELEMETRY_ENV,
  rtkNewEnough,
  rtkVersionOf,
} from '../../../shared/rtk'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryRecents } from '../../core/testing'
import { resolveCli } from '../../platform/cli-command'
import { createClaudeAdapter } from '../claude/adapter'
import { type HookReceiver, startHookReceiver } from '../hooks/hook-receiver'
import { claudeCredential, subscriptionEnv } from './claude-credential'

const credential = claudeCredential(process.env)
const rtkPath = resolveCli(RTK_COMMAND)
const rtkUsable = rtkPath !== null && rtkNewEnough(rtkVersionOf(rtkVersion(rtkPath) ?? ''))

const STARTUP_MS = 3 * 60_000
const TURN_MS = 6 * 60_000

/** `rtk --version`, or null when the binary will not answer. */
function rtkVersion(path: string): string | null {
  try {
    return execFileSync(path, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

describe.skipIf(!credential || !rtkUsable)('RTK in a real Claude Session', () => {
  let root: string
  let companyFolder: string
  let dbPath: string
  let engine: CompanyEngine | undefined
  let receiver: HookReceiver | undefined

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'tinycorp-rtk-'))
    companyFolder = join(root, 'acme')
    mkdirSync(companyFolder)
    // `git status` needs a repo to have anything to say, and something uncommitted to say it about.
    git(root, 'init', '--quiet', '--initial-branch=main', companyFolder)
    writeFileSync(join(companyFolder, 'README.md'), '# acme\n')
    // This Company's own RTK history, in the app's folder — never in the repo (T179).
    dbPath = join(root, 'app-data', 'rtk', 'acme', 'history.db')
    mkdirSync(join(root, 'app-data', 'rtk', 'acme'), { recursive: true })

    receiver = await startHookReceiver((token, payload) => engine?.sessions.receiveHook(token, payload))
    engine = createCompanyEngine({
      recents: inMemoryRecents(),
      providers: {
        claude: createClaudeAdapter({
          hookUrl: receiver.url,
          dataDir: join(root, 'app-data'),
          env: subscriptionEnv(process.env),
        }),
      },
      rtk: { dir: join(root, 'app-data', 'rtk') },
      log: (line) => console.warn(`[engine] ${line}`),
    })
    await engine.rtk.status()
  })

  afterAll(async () => {
    engine?.close()
    await receiver?.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** What RTK has recorded in this Company's own history so far. */
  const recorded = () => {
    const output = execFileSync(rtkPath!, ['gain', '--format', 'json'], {
      env: { ...process.env, [RTK_DB_ENV]: dbPath, [RTK_TELEMETRY_ENV]: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseRtkGain(output)
  }

  async function until(what: string, check: () => boolean, timeoutMs = TURN_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  it(
    'runs `git status` through rtk, and records it in this Company’s own history',
    async () => {
      const company = engine!.createCompany({ folder: companyFolder, name: 'Acme' })
      const ada = engine!.employees.create({ name: 'Ada', roleId: 'backend' })

      // The Session is hooked because the Company's toggle is on by default and RTK is here.
      expect(engine!.rtk.hookFor(company.id)).toEqual({ path: rtkPath, dbPath, ping: false })

      engine!.sessions.start(ada.id)
      await until(
        'Ada’s Session to become idle after SessionStart',
        () => engine!.sessions.get(ada.id).status === 'idle',
        STARTUP_MS,
      )

      engine!.sessions.pushPrompt(ada.id, 'Run the shell command `git status` once, then stop. Do nothing else.')

      await until('rtk to record the command Claude Code ran', () => (recorded()?.commandsFiltered ?? 0) > 0)

      const savings = recorded()
      expect(
        savings?.commandsFiltered,
        'the Session ran a shell command and RTK’s history for this Company is empty, so the PreToolUse hook TinyCorp wrote is not rewriting anything',
      ).toBeGreaterThan(0)
    },
    STARTUP_MS + TURN_MS,
  )
})
