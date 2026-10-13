/**
 * The spike v0 scenario, automated against a real `claude` on the developer's or CI's
 * subscription: one Employee, one ticket, one resume. Slow and it spends subscription usage,
 * so it is not part of `pnpm test`; run it with `pnpm test:claude`. Skipped without a credential.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryRecents } from '../../core/testing'
import type { SessionActivity } from '../../features/sessions/sessions'
import { fakeForge } from '../../forges/testing'
import { createGitService } from '../../platform/git-service'
import { createClaudeAdapter } from '../claude/adapter'
import { type HookReceiver, startHookReceiver } from '../hooks/hook-receiver'
import type { HookPayload } from '../provider-adapter'
import { claudeCredential, subscriptionEnv } from './claude-credential'

const credential = claudeCredential(process.env)
const STARTUP_MS = 3 * 60_000
const TURN_MS = 6 * 60_000
const TICKET_TITLE = 'Add hello.txt greeting'
const GREETING = 'hello from Ada'
const PR_URL = 'https://github.com/acme/api/pull/1'
// The throwaway repo has nothing to build: the stack commands are shell no-ops, so the ticket can be claimed.
const node = {
  language: 'TypeScript',
  framework: 'Node',
  packageManager: 'pnpm',
  install: 'true',
  build: 'true',
  test: 'true',
  lint: 'true',
}

/** One run of the app: the engine with a real Claude adapter, hook receiver and MCP server. */
interface Run {
  engine: CompanyEngine
  hooks: HookPayload[]
  activity: SessionActivity[]
  /** The Company MCP endpoint of this run. */
  mcpUrl(companyId: string): string
  /** Keeps the Employee's terminal output, for failure messages. */
  watch(employee: Employee): void
  output(): string
  close(): Promise<void>
}

describe.skipIf(!credential)('Real Claude loop (spike v0, automated)', () => {
  let root: string
  let companyFolder: string
  let origin: string
  let repo: string
  const runs: Run[] = []

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'tinycorp-real-claude-'))
    companyFolder = join(root, 'acme')
    origin = join(root, 'api.git')
    repo = join(root, 'api')
    mkdirSync(companyFolder)
    git(root, 'init', '--quiet', '--bare', '--initial-branch=main', origin)
    git(root, 'init', '--quiet', '--initial-branch=main', repo)
    git(repo, 'config', 'user.name', 'tinycorp test')
    git(repo, 'config', 'user.email', 'test@tinycorp.invalid')
    writeFileSync(join(repo, 'README.md'), '# api\n')
    git(repo, 'add', 'README.md')
    git(repo, 'commit', '--quiet', '-m', 'Initial commit')
    git(repo, 'remote', 'add', 'origin', origin)
    git(repo, 'push', '--quiet', '-u', 'origin', 'main')
    git(repo, 'remote', 'set-head', 'origin', 'main')
    // Pushes go to the local bare origin; `origin` reads as a forge, and a fake adapter stands in
    // for it — a real one would open a real pull request, and no test opens one of those.
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/api.git')
    git(repo, 'config', 'remote.origin.pushurl', origin)
  })

  afterAll(async () => {
    for (const run of runs.splice(0)) await run.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function launch(): Promise<Run> {
    const hooks: HookPayload[] = []
    const activity: SessionActivity[] = []
    let output = ''
    let engine: CompanyEngine | undefined
    const receiver: HookReceiver = await startHookReceiver((token, payload) => {
      hooks.push(payload)
      engine?.sessions.receiveHook(token, payload)
    })
    const mcp: CompanyMcpServer = await startCompanyMcpServer({
      mcpCaller: (companyId, token) => engine!.mcpCaller(companyId, token),
    })
    engine = createCompanyEngine({
      recents: inMemoryRecents(),
      providers: {
        claude: createClaudeAdapter({
          hookUrl: receiver.url,
          dataDir: join(root, 'app-data'),
          env: subscriptionEnv(process.env),
        }),
      },
      mcpUrl: (companyId) => mcp.urlFor(companyId),
      git: createGitService({ forges: { github: fakeForge({ url: PR_URL, number: 1 }) } }),
      log: (line) => console.warn(`[engine] ${line}`),
    })
    engine.sessions.onActivity((a) => activity.push(a))
    const started = engine
    const run: Run = {
      engine: started,
      hooks,
      activity,
      mcpUrl: (companyId) => mcp.urlFor(companyId),
      watch(employee) {
        started.terminals.attach(employee.id, (data) => {
          output = (output + data).slice(-20_000)
        })
      },
      output: () => output,
      async close() {
        started.close()
        await receiver.close()
        await mcp.close()
      },
    }
    runs.push(run)
    return run
  }

  async function quit(run: Run): Promise<void> {
    runs.splice(runs.indexOf(run), 1)
    await run.close()
    // Give the killed CLI a moment to flush its transcript before it is resumed.
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  async function until(run: Run, what: string, check: () => boolean, timeoutMs = TURN_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!check()) {
      if (Date.now() > deadline) {
        const screen = stripAnsi(run.output()).slice(-3000)
        const hooks = run.hooks.map((h) => `${h.hook_event_name}${h['tool_name'] ? `(${h['tool_name']})` : ''}`)
        throw new Error(`Timed out waiting for: ${what}\nhooks: ${hooks.join(' ')}\nscreen:\n${screen}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  /** Ada's DM messages to the boss posted after message `afterId`. */
  const dmRepliesFrom = (run: Run, ada: Employee, afterId: number) =>
    run.engine
      .chat()
      .read({ channelId: dmChannelId(BOSS, ada.id) })
      .filter((m) => m.authorId === ada.id && m.id > afterId)

  it(
    'delivers a ticket through MCP, idles by hook, accepts pushed prompts and remembers after resume',
    async () => {
      // --- First run: hire, spawn, deliver one ticket.
      const first = await launch()
      const { engine } = first
      engine.createCompany({ folder: companyFolder, name: 'Acme' })
      engine.approvals.setLevel('autonomous')
      const api = engine.repos.add({ path: repo, name: 'api', stack: node })
      const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
      first.watch(ada)

      const { providerSessionId } = engine.sessions.start(ada.id)
      await until(
        first,
        'Ada’s Session to become idle after SessionStart',
        () => engine.sessions.get(ada.id).status === 'idle',
        STARTUP_MS,
      )

      const ticket = engine.board().createTicket({
        title: TICKET_TITLE,
        description:
          `In your worktree for this ticket, create hello.txt containing exactly "${GREETING}", ` +
          `commit it with the message "${TICKET_TITLE}", then move the ticket to review with ticket_move. ` +
          'Do nothing else.',
        assigneeId: ada.id,
        repos: [api.id],
      })
      engine.board().moveTicket(ticket.id, 'doing')
      const code = () => engine.code.of(ticket.id)
      await until(
        first,
        `#${ticket.id} to reach review with a PR opened`,
        () =>
          engine
            .board()
            .snapshot()
            .tickets.find((t) => t.id === ticket.id)?.column === 'review' && code().pullRequests.length === 1,
      )
      await until(first, 'Ada to finish the ticket turn', () => engine.sessions.get(ada.id).status === 'idle')

      // --- A fact only the conversation knows, for the resume check.
      const codeword = `pelican-${randomBytes(3).toString('hex')}`
      engine.chat().post({
        authorId: BOSS,
        channelId: dmChannelId(BOSS, ada.id),
        text:
          `Remember this codeword for later: ${codeword}. Do not write it to any file, memory or chat, ` +
          'and do not call any tool. Just answer "noted" in your terminal.',
      })
      const stopsBefore = first.hooks.filter((h) => h.hook_event_name === 'Stop').length
      await until(
        first,
        'Ada to take the codeword and finish the turn',
        () =>
          engine.inbox.list(ada.id).every((item) => item.status === 'handled') &&
          first.hooks.filter((h) => h.hook_event_name === 'Stop').length > stopsBefore &&
          engine.sessions.get(ada.id).status === 'idle',
      )

      // 1. Spawned in a throwaway worktree: the Session runs in the Company folder, the ticket's worktree
      //    lives under it, and the work landed on the ticket's branch there, not in the repo.
      const [worktree] = code().worktrees
      expect(worktree).toMatchObject({ repoId: api.id, base: 'main' })
      expect(worktree!.path.startsWith(companyFolder)).toBe(true)
      expect(readFileSync(join(worktree!.path, 'hello.txt'), 'utf8').trim()).toBe(GREETING)
      expect(git(worktree!.path, 'log', '-1', '--format=%s', worktree!.branch)).toBe(TICKET_TITLE)
      expect(git(repo, 'status', '--porcelain')).toBe('')
      expect(existsSync(join(repo, 'hello.txt'))).toBe(false)
      expect(first.hooks.find((h) => h.hook_event_name === 'SessionStart')).toMatchObject({
        source: 'startup',
        session_id: providerSessionId,
      })

      // 2. MCP called with the Session's token: Ada moved the ticket through the Company server, which
      //    refuses callers without one, and the PR (pushed to origin) followed.
      const toolsUsed = first.hooks.filter((h) => h.hook_event_name === 'PreToolUse').map((h) => h['tool_name'])
      expect(toolsUsed).toContain('mcp__company__ticket_move')
      expect(code().pullRequests[0]).toMatchObject({ url: PR_URL, number: 1 })
      expect(git(origin, 'log', '-1', '--format=%s', worktree!.branch)).toBe(TICKET_TITLE)
      const anonymous = await fetch(first.mcpUrl(engine.currentCompany()!.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(anonymous.status).toBe(401)

      // 3. Idle via hook: every Stop left the Session idle.
      const afterStop = first.activity.filter((a) => a.hook === 'Stop')
      expect(afterStop.length).toBeGreaterThanOrEqual(2)
      expect(afterStop.every((a) => a.status === 'idle' && a.signal === 'idle')).toBe(true)

      // 4. Push accepted: each pushed prompt came back as UserPromptSubmit and its item is handled.
      const items = engine.inbox.list(ada.id)
      expect(items.map((i) => i.kind)).toEqual(expect.arrayContaining(['dm']))
      expect(items.length).toBeGreaterThanOrEqual(2)
      const submitted = first.hooks
        .filter((h) => h.hook_event_name === 'UserPromptSubmit')
        .map((h) => String(h['prompt']))
      for (const item of items) {
        expect(item.status).toBe('handled')
        expect(submitted.some((prompt) => prompt.includes(item.prompt.slice(0, 60)))).toBe(true)
      }

      // --- Quit the app, open the Company again: Ada comes back with --resume.
      await quit(first)
      const second = await launch()
      second.watch(ada)
      second.engine.openCompany(companyFolder)
      await until(
        second,
        'Ada’s resumed Session to become idle',
        () => second.engine.sessions.get(ada.id).status === 'idle',
        STARTUP_MS,
      )

      const question = second.engine.chat().post({
        authorId: BOSS,
        channelId: dmChannelId(BOSS, ada.id),
        text:
          'Which codeword did I give you earlier, and which ticket are you on? ' +
          'Answer in this DM with chat_post, exactly as "codeword=<word> ticket=#<id>".',
      })
      await until(
        second,
        'Ada to answer in the DM after resuming',
        () => dmRepliesFrom(second, ada, question.id).length > 0,
      )

      // 5. Resume remembers: same Session, continued rather than primed, and it knows the codeword.
      expect(second.hooks.find((h) => h.hook_event_name === 'SessionStart')).toMatchObject({
        source: 'resume',
        session_id: providerSessionId,
      })
      expect(second.engine.sessions.get(ada.id).providerSessionId).toBe(providerSessionId)
      expect(second.engine.inbox.list(ada.id).map((i) => i.kind)).not.toContain('resume')
      const answer = dmRepliesFrom(second, ada, question.id)
        .map((m) => m.text)
        .join('\n')
      expect(answer).toContain(codeword)
      expect(answer).toContain(`#${ticket.id}`)
    },
    2 * STARTUP_MS + 3 * TURN_MS,
  )
})

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, '')
}
