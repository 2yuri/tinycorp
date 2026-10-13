/**
 * Testing before merge (T174): after review approves, a ticket waits in Testing on its own
 * worktree. Who does the testing is a Company setting with per-repo overrides, and the script is
 * the plan's acceptance criteria (T171) plus whatever the QA agent adds.
 */

/**
 * Who tests a ticket before it merges. `you` the boss does it, `agent` an Employee holding `test`
 * does it, `both` the agent first and then the boss confirms, `nobody` the stage is skipped and
 * the merge gate rises straight after review, which is what every Company did before this.
 */
export const TEST_MODES = ['you', 'agent', 'both', 'nobody'] as const
export type TestMode = (typeof TEST_MODES)[number]

/** What a Company with no setting of its own does: exactly what it did before Testing existed. */
export const DEFAULT_TEST_MODE: TestMode = 'nobody'

/** The chips on the WHO TESTS field, as frame `YatUW` words them. */
export const TEST_MODE_LABEL: Record<TestMode, string> = {
  you: 'You',
  agent: 'QA agent',
  both: 'Both',
  nobody: 'Nobody',
}

/** The line under the chips, which says what the chosen mode does (`YatUW`, card c). */
export const TEST_MODE_HELP: Record<TestMode, string> = {
  you: 'You test it yourself on the ticket’s worktree. The merge waits for you.',
  agent: 'The QA agent tests it and posts what it verified. Its pass is the go-ahead.',
  both: 'The QA agent tests first and posts evidence, then you confirm. Merge waits for both.',
  nobody: 'Merges straight after review. Nothing is tested here.',
}

/** Whether the mode asks an Employee holding `test` to do a pass. */
export function asksTheAgent(mode: TestMode): boolean {
  return mode === 'agent' || mode === 'both'
}

/** Whether the mode asks the boss to confirm before the merge. */
export function asksTheBoss(mode: TestMode): boolean {
  return mode === 'you' || mode === 'both'
}

/**
 * The mode a ticket runs under when its repos disagree: the strictest of them.
 *
 * "Strictest" is not a ranking of the four names, it is the union of what they ask for. A repo that
 * wants the agent and a repo that wants the boss together want both, which is the only answer that
 * keeps either repo's rule. `nobody` asks for nothing, so it only wins when every repo says it —
 * a ticket that touches one repo nobody tests and one repo the boss tests is still tested.
 */
export function strictestMode(modes: readonly TestMode[]): TestMode {
  const agent = modes.some(asksTheAgent)
  const boss = modes.some(asksTheBoss)
  if (agent && boss) return 'both'
  if (agent) return 'agent'
  if (boss) return 'you'
  return 'nobody'
}

/** What a step's tester said about it. `pending` is a step nobody has reached yet. */
export const TEST_RESULTS = ['pending', 'pass', 'fail'] as const
export type TestResult = (typeof TEST_RESULTS)[number]

/** A file kept beside a step: a screenshot picked, pasted, or captured from the running app. */
export interface TestAttachment {
  id: number
  stepId: number
  /** The file name inside the attempt's folder. */
  name: string
  size: number
  createdAt: string
}

/** One line of the test script: what to check, and what happened when someone checked it. */
export interface TestStep {
  id: number
  runId: number
  /** What to do, one sentence — the acceptance criterion itself when it came from the plan. */
  title: string
  /** How to check it, when whoever wrote the step said. */
  detail: string
  /**
   * Which of the plan's acceptance criteria this step is, counting from 1, or null for a step
   * somebody added. It is what the `Criterion 2` tag on the step says.
   */
  criterion: number | null
  /** The Employee who added this step, or null when it came from the plan. */
  addedBy: string | null
  result: TestResult
  note: string
  /** `BOSS` or an Employee id; null while the step is pending. */
  testedBy: string | null
  testedAt: string | null
  attachments: TestAttachment[]
}

/**
 * How far an attempt has got. `agent` waits on the QA agent, `you` on the boss, `passed` is the
 * attempt that lets the merge through, `failed` sent the ticket back to Doing.
 */
export const TEST_RUN_STATES = ['agent', 'you', 'passed', 'failed'] as const
export type TestRunState = (typeof TEST_RUN_STATES)[number]

/** The QA agent's verdict on an attempt, as `test_submit` takes it. */
export type TestVerdict = 'pass' | 'fail'

/** One attempt at testing a ticket. A ticket gets a new one each time it re-enters Testing. */
export interface TestRun {
  id: number
  ticketId: number
  /** Which attempt of this ticket it is, counting from 1. */
  attempt: number
  /** The mode it started under; changing the setting mid-flight does not rewrite an attempt. */
  mode: TestMode
  state: TestRunState
  /** The Employee asked to test it, or null when nobody was. */
  agentId: string | null
  agentVerdict: TestVerdict | null
  agentSummary: string
  /** What the agent said it checked beyond the steps: `typecheck`, `test · 142`. */
  checks: string[]
  startedAt: string
  finishedAt: string | null
  steps: TestStep[]
}

/** How many of an attempt's steps passed, failed and are still to test. */
export interface TestCounts {
  passed: number
  failed: number
  pending: number
  total: number
}

export function testCounts(run: Pick<TestRun, 'steps'>): TestCounts {
  const of = (result: TestResult) => run.steps.filter((s) => s.result === result).length
  return { passed: of('pass'), failed: of('fail'), pending: of('pending'), total: run.steps.length }
}

/**
 * Whether the attempt may be passed: no step failed and none is still to test.
 *
 * An attempt with no steps at all can be passed. A ticket whose plan set no acceptance criteria —
 * or that was never planned — would otherwise be stuck in Testing with nothing anyone could do
 * about it, and a stage nobody can leave is worse than one that says there was nothing to check.
 */
export function canPass(run: Pick<TestRun, 'steps'>): boolean {
  return run.steps.every((step) => step.result === 'pass')
}

/** `2 passed · 1 failed · 1 to test`, the line the test script's header carries (frame `BRzY6`). */
export function testSummary(run: Pick<TestRun, 'steps'>): string {
  const counts = testCounts(run)
  const parts: string[] = []
  if (counts.passed > 0) parts.push(`${counts.passed} passed`)
  if (counts.failed > 0) parts.push(`${counts.failed} failed`)
  if (counts.pending > 0) parts.push(`${counts.pending} to test`)
  return parts.join(' · ') || 'No steps yet'
}

/** `4 of 4 passed`, `3 of 4 · 1 failed` — what the evidence card's badge says (frame `vKIwf`). */
export function evidenceBadge(run: Pick<TestRun, 'steps'>): string {
  const { passed, failed, total } = testCounts(run)
  if (failed > 0) return `${passed} of ${total} · ${failed} failed`
  return `${passed} of ${total} passed`
}

/** The tone of the chip a board card carries while it is in Testing (frame `YatUW`, card a). */
export type TestChipTone = 'agent' | 'you' | 'failed' | 'passed'

export interface TestChip {
  tone: TestChipTone
  text: string
}

/**
 * The card's own line: `QA: Iris testing`, `Waiting on you · test`, `Failed 1 · back to Doing`, or
 * `Testing passed` once it is through. The failed chip stays on the card after it leaves Testing,
 * which is how the board says why a ticket is back in Doing.
 */
export function testChip(run: Pick<TestRun, 'state' | 'steps'>, agentName: string | null): TestChip {
  if (run.state === 'failed') {
    const { failed } = testCounts(run)
    return { tone: 'failed', text: `Failed ${failed} · back to Doing` }
  }
  if (run.state === 'passed') return { tone: 'passed', text: 'Testing passed' }
  if (run.state === 'agent') return { tone: 'agent', text: `QA: ${agentName ?? 'agent'} testing` }
  return { tone: 'you', text: 'Waiting on you · test' }
}

/**
 * The chip beside the assignee on a card in Testing (frame `YatUW`, card a): `Step 2 of 5` while
 * the agent is still going, and `Iris 4/4` once it has handed its pass to the boss. Null when
 * there is nothing to say — no agent ran, or the attempt is over.
 */
export function testerChip(
  run: Pick<TestRun, 'state' | 'steps' | 'agentVerdict'>,
  agentName: string | null,
): string | null {
  const { passed, total, pending } = testCounts(run)
  if (total === 0) return null
  if (run.state === 'agent') return `Step ${Math.min(total - pending + 1, total)} of ${total}`
  if (run.state === 'you' && run.agentVerdict === 'pass' && agentName) return `${agentName} ${passed}/${total}`
  return null
}

/** A repo's own testing rule: who tests its tickets, how its app is started and on which port. */
export interface RepoTestSettings {
  repoId: string
  /** Null means the Company's own mode; anything else overrides it for this repo. */
  mode: TestMode | null
  /** What `Run it` starts in the ticket's worktree, e.g. `pnpm dev`. Empty when the repo has none. */
  runCommand: string
  /** What `Open` points at, `http://localhost:<port>`; null when the repo serves nothing. */
  port: number | null
}

/** The Company's testing settings: the default mode and every repo that differs from it. */
export interface TestSettings {
  mode: TestMode
  repos: RepoTestSettings[]
}

/** A change to one repo's rule. Fields left out stay as they are. */
export interface RepoTestChanges {
  mode?: TestMode | null
  runCommand?: string
  port?: number | null
}

/** Whether a port is one a run command could serve on. */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536
}

/** Where `Open` goes for a repo with a port. */
export function localUrl(port: number): string {
  return `http://localhost:${port}`
}

/**
 * The repo's app, running in the ticket's worktree because the boss pressed Run it or the QA agent
 * called `test_run_app`. The app owns the process: it is killed on Stop, when the ticket leaves
 * Testing, and when the app quits. Nothing starts one by itself.
 */
export interface AppRun {
  ticketId: number
  repoId: string
  repoName: string
  /** The repo's run command, e.g. `pnpm dev`. */
  command: string
  /** The ticket's worktree of that repo, which is where the command runs. */
  cwd: string
  port: number | null
  /** `http://localhost:<port>`, where Open goes; null for a repo with no port. */
  url: string | null
  state: 'running' | 'exited'
  startedAt: string
  /** `BOSS` or the Employee id that started it. */
  startedBy: string
  exitCode: number | null
  /** The newest line of output, which is the strip under the Run it row. */
  lastLine: string
  /** How many lines the log holds, which is what `Show log · 24 lines` counts. */
  lines: number
}

/** One repo of a ticket in Testing, as the Run it row draws it whether or not it is running. */
export interface RunnableRepo {
  repoId: string
  repoName: string
  command: string
  cwd: string
  port: number | null
  url: string | null
  run: AppRun | null
}

/** What "Capture the running app" hands back: the PNG bytes, and the name to keep them under. */
export interface CapturedPage {
  name: string
  data: Uint8Array
}

/**
 * Takes a shot of `url`. Implemented in the composition root, because a hidden browser window is
 * the machine's, and injected into the Testing IPC — so the shape of it lives here (T188), where
 * both sides may name it and no test opens a window.
 */
export type CapturePage = (input: { url: string; name: string }) => Promise<CapturedPage>
