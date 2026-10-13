/**
 * The security pass (T241): a second review, by the Company's Security Employee, of the change a
 * normal review round is already about.
 *
 * It is not another round. The reviewer argues the change with the assignee as it always did; the
 * Security Employee reads the same diff beside them and writes findings, each one a review thread
 * on the line it is about with a concrete fix in it. A `high` finding still open is what stops the
 * merge — until the thread is resolved, or the boss overrides the pass and says why.
 *
 * The engine is `src/main/features/review/security-flow.ts`.
 */

/**
 * How much a finding matters, and what each one means for the merge.
 *
 * `high` is exploitable as written and blocks the merge. `medium` is a real weakness that needs a
 * fix but not this merge's. `low` is worth saying and nothing more.
 */
export const SECURITY_SEVERITIES = ['high', 'medium', 'low'] as const
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number]

/** The scale as the Security Employee is told it, and as the panel writes it out. */
export const SEVERITY_MEANING: Record<SecuritySeverity, string> = {
  high: 'Exploitable as written, or a secret already in the history. Blocks the merge.',
  medium: 'A real weakness that needs a fix, but not one this change can be exploited through.',
  low: 'Worth saying: a hardening, a missing check that nothing reaches yet, a risky habit.',
}

/** `High` / `Medium` / `Low`, as the row and the card write them. */
export const SEVERITY_LABEL: Record<SecuritySeverity, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/**
 * When a Company asks for a security pass. `risky` is the default and only asks for one when the
 * change touches something that has historically been worth reading twice; `every` asks on every
 * PR, and costs that much more quota; `off` never asks, which is what a Company with no Security
 * Employee gets anyway.
 */
export const SECURITY_SCOPES = ['risky', 'every', 'off'] as const
export type SecurityScope = (typeof SECURITY_SCOPES)[number]

/** What a Company with no setting of its own gets: only the PRs that look worth the quota. */
export const DEFAULT_SECURITY_SCOPE: SecurityScope = 'risky'

/** The chips on the SECURITY PASS field in Company settings. */
export const SECURITY_SCOPE_LABEL: Record<SecurityScope, string> = {
  risky: 'Risky paths',
  every: 'Every PR',
  off: 'Off',
}

/** The line under the chips, which says what the chosen scope does. */
export const SECURITY_SCOPE_HELP: Record<SecurityScope, string> = {
  risky: 'Only when the change touches auth, IPC, the machine, secrets or dependencies.',
  every: 'Every pull request gets a security pass. It costs a Session on each one.',
  off: 'Nothing is read for security. The normal review is the only one.',
}

/**
 * The classes of change worth a second pair of eyes, and how a path or a ticket label says so.
 *
 * A pattern matches when the changed path *contains* it, lower-cased and written with `/` — which
 * is how every forge and `git` write a path on all three platforms, so the same change is risky on
 * Windows and on Linux. They are deliberately narrow: the point of `risky` is to spend a Session
 * where it pays, and a class that matched half a repo would just be `every` under another name.
 */
export const RISK_CLASSES = [
  {
    id: 'auth',
    label: 'auth and sessions',
    paths: ['auth', 'login', 'signin', 'sign-in', 'oauth', 'jwt', 'session', 'permission'],
    labels: ['auth', 'authz', 'login'],
  },
  {
    id: 'secrets',
    label: 'secrets',
    paths: ['secret', 'credential', 'password', 'keychain', 'safe-storage', 'crypto', '.env'],
    labels: ['secrets', 'crypto'],
  },
  {
    id: 'ipc',
    label: 'IPC and the window policy',
    paths: ['ipc', 'preload', 'window-policy', 'content-security', 'csp'],
    labels: ['ipc'],
  },
  {
    id: 'platform',
    label: 'the machine',
    paths: ['main/platform', 'child-process', 'child_process', 'sandbox'],
    labels: ['platform'],
  },
  {
    id: 'deps',
    label: 'dependencies',
    paths: [
      'package.json',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
      'cargo.toml',
      'cargo.lock',
      'go.mod',
      'go.sum',
      'requirements.txt',
      'pyproject.toml',
      'gemfile',
    ],
    labels: ['deps', 'dependencies'],
  },
] as const

export type RiskClassId = (typeof RISK_CLASSES)[number]['id']

/** A ticket label that asks for a pass whatever the change touches. */
export const SECURITY_LABELS = ['security', 'vuln', 'vulnerability'] as const

/** How every comparison here reads a path: lower case, and `/` on every platform. */
function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').toLowerCase()
}

/** Which risk classes a change falls into, in the order `RISK_CLASSES` lists them. */
export function riskClassesOf(input: { paths: readonly string[]; labels?: readonly string[] }): RiskClassId[] {
  const paths = input.paths.map(normalizePath)
  const labels = (input.labels ?? []).map((label) => label.trim().toLowerCase())
  return RISK_CLASSES.filter(
    (risk) =>
      paths.some((path) => risk.paths.some((pattern) => path.includes(pattern))) ||
      labels.some((label) => risk.labels.some((pattern) => label === pattern)),
  ).map((risk) => risk.id)
}

/** Whether a ticket label asks for a pass on its own, whatever the change touches. */
export function askedByLabel(labels: readonly string[]): boolean {
  return labels.some((label) =>
    SECURITY_LABELS.includes(label.trim().toLowerCase() as (typeof SECURITY_LABELS)[number]),
  )
}

/** Why a change is getting a pass, or null when it is not getting one. */
export interface SecurityReason {
  /** `risky` the change touched one of the classes, `label` the ticket asked for it, `every` the setting did. */
  kind: 'risky' | 'label' | 'every'
  /** The classes the change fell into; empty when nothing matched and the scope asked anyway. */
  classes: RiskClassId[]
}

/**
 * Whether this change gets a security pass under `scope`, and why. Null means it does not — which
 * is the answer for every Company that has no Security Employee, because nobody asks then.
 */
export function securityReason(input: {
  scope: SecurityScope
  paths: readonly string[]
  labels?: readonly string[]
}): SecurityReason | null {
  if (input.scope === 'off') return null
  const labels = input.labels ?? []
  const classes = riskClassesOf({ paths: input.paths, labels })
  if (askedByLabel(labels)) return { kind: 'label', classes }
  if (classes.length > 0) return { kind: 'risky', classes }
  return input.scope === 'every' ? { kind: 'every', classes: [] } : null
}

/** `auth and sessions, dependencies`, the classes as a sentence; empty when there are none. */
export function riskLine(classes: readonly RiskClassId[]): string {
  return classes.map((id) => RISK_CLASSES.find((risk) => risk.id === id)?.label ?? id).join(', ')
}

/** One thing the Security Employee found, and the thread it went up as. */
export interface SecurityFinding {
  id: number
  passId: number
  severity: SecuritySeverity
  /** What is wrong, one line. */
  title: string
  /** The fix it was filed with — a finding without one is refused. */
  fix: string
  /** The review thread it was written as, so resolving the thread resolves the finding. */
  threadId: number
  /** Where it is, as the thread anchors it: `src/main/ipc.ts:20`, or the PR itself. */
  where: string
  /** Whether its thread has been settled. */
  resolved: boolean
  createdAt: string
}

/**
 * How far a pass has got. `pending` the Security Employee is still reading; `clear` it found
 * nothing that blocks; `findings` it filed some; `overridden` the boss let the merge through
 * anyway and said why.
 */
export const SECURITY_PASS_STATES = ['pending', 'clear', 'findings', 'overridden'] as const
export type SecurityPassState = (typeof SECURITY_PASS_STATES)[number]

/** One security pass of a ticket: one per review round that asked for one. */
export interface SecurityPass {
  id: number
  ticketId: number
  /** The review round it reads beside. */
  reviewId: number
  /** The Employee reading it. */
  reviewerId: string
  state: SecurityPassState
  /** Why it was asked for. */
  reason: SecurityReason
  /** What the Security Employee said when it closed the pass. */
  summary: string
  /** Who overrode it and why; null while nobody has. */
  overriddenBy: string | null
  overrideReason: string
  startedAt: string
  finishedAt: string | null
  findings: SecurityFinding[]
}

/** The findings that stop a merge: `high`, and their thread still open. */
export function blockingFindings(pass: Pick<SecurityPass, 'findings'>): SecurityFinding[] {
  return pass.findings.filter((finding) => finding.severity === 'high' && !finding.resolved)
}

/**
 * Whether the merge waits on this pass: while it is still being read, and while a high finding of
 * it is open. An overridden pass never waits — that is what the override is.
 */
export function holdsTheMerge(pass: Pick<SecurityPass, 'state' | 'findings'>): boolean {
  if (pass.state === 'overridden') return false
  return pass.state === 'pending' || blockingFindings(pass).length > 0
}

/** `2 high · 1 medium`, the counts a row and a card carry; empty when there is nothing. */
export function findingsLine(pass: Pick<SecurityPass, 'findings'>): string {
  return SECURITY_SEVERITIES.map((severity) => ({
    severity,
    n: pass.findings.filter((finding) => finding.severity === severity).length,
  }))
    .filter((count) => count.n > 0)
    .map((count) => `${count.n} ${count.severity}`)
    .join(' · ')
}

/** The tone of the security row and of the card's badge. */
export type SecurityTone = 'reading' | 'blocked' | 'findings' | 'clear' | 'overridden'

export interface SecurityChip {
  tone: SecurityTone
  text: string
}

/** The badge a board card carries while a ticket has a security pass (T241). */
export function securityChip(
  pass: Pick<SecurityPass, 'state' | 'findings'>,
  reviewerName: string | null,
): SecurityChip {
  if (pass.state === 'overridden') return { tone: 'overridden', text: 'Security overridden' }
  if (pass.state === 'pending') {
    return { tone: 'reading', text: `Security: ${reviewerName ?? 'agent'} reading` }
  }
  const blocking = blockingFindings(pass).length
  if (blocking > 0) {
    return { tone: 'blocked', text: `Security: ${blocking} high open` }
  }
  if (pass.findings.length > 0) return { tone: 'findings', text: `Security: ${findingsLine(pass)}` }
  return { tone: 'clear', text: 'Security clear' }
}

/** Why the merge is waiting on the pass, in the words the round's thread and the panel use. */
export function securityRefusal(pass: Pick<SecurityPass, 'state' | 'findings'>, ticketCode: string): string | null {
  if (!holdsTheMerge(pass)) return null
  if (pass.state === 'pending') return `The security pass on ${ticketCode} is not finished, so the merge waits.`
  const blocking = blockingFindings(pass)
  return (
    `${blocking.length} high security ${blocking.length === 1 ? 'finding is' : 'findings are'} open on ` +
    `${ticketCode}: ${blocking.map((finding) => `${finding.where} — ${finding.title}`).join('; ')}. ` +
    'Resolve each thread, or override the pass and say why.'
  )
}
