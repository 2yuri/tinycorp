import { join } from 'node:path'
import {
  ACTION_LABEL,
  AUTONOMY_LABEL,
  type AutonomyLevel,
  GATED_ACTIONS,
  type GatedAction,
  gate,
} from '../../../shared/approvals'
import { APPROVAL_SUBJECT_RULE } from '../../../shared/approvals/approval-subject'
import { APPROVAL_SUMMARY_RULE } from '../../../shared/approvals/approval-summary'
import { type BuildStyle, LEAN_RULES } from '../../../shared/build-style'
import type { McpTransport } from '../../../shared/catalogue/mcp-servers'
import { type CavemanLevel, cavemanRules } from '../../../shared/caveman'
import type { ColleagueVoice } from '../../../shared/colleague-voice'
import { COLUMN_TITLES, type Column } from '../../../shared/domain/board'
import { type Employee, matchesRepoFilter } from '../../../shared/domain/staff'
import type { EnvironmentId } from '../../../shared/environments'
import { NOTE_MAX_BYTES, NOTES_LEAF, type NotesBrief, rangeLabel } from '../../../shared/memory/notes'
import {
  CHECK_KEYS,
  DEFAULT_RUNG,
  hasChecks,
  NO_CHECKS_LINE,
  type Repo,
  type RepoRung,
  RUNG_LABEL,
  type StackConstraints,
} from '../../../shared/repos/repo'
import { DEFAULT_ROUND_LIMIT } from '../../../shared/review'
import { hireableModelLines } from '../../../shared/staff/models'
import type { SubSessionWorkspace } from '../../../shared/sub-sessions'
import { ticketBranchStem, ticketCode } from '../../../shared/ticket-id'
import { NO_REMOTE } from '../../platform'

/**
 * What everything the boss can read is written like: the humanizer (T180). It holds whatever voice
 * the Company set for colleague DMs, because the boss reads channels, threads, PR comments, tickets,
 * plans, testing notes and the digest, and all of those are for a person.
 */
export const PLAIN_RULES = [
  '## How you write',
  '',
  'Everything the boss can read \u2014 a DM to them, any channel or thread, a PR comment, a ticket, a plan, ' +
    'a testing note \u2014 is plain words for a person. You are a colleague in a chat, not a model producing ' +
    'a report, and short beats complete.',
  '',
  '- Two or three sentences. Longer than that belongs in the ticket, and you link it.',
  '- Say the thing first. No warm-up, no "great question", no summary of what you just read.',
  '- No bullet lists, headings, bold labels or decorative emoji in chat. Those are for the ticket.',
  '- Plain words. Not "leverage", "robust", "crucial", "delve", "underscores", "seamless".',
  '- Skip the patterns that give a model away: "it\u2019s not X, it\u2019s Y", a closing line that ' +
    'repeats the point, three examples for rhythm, a dash holding two clauses together.',
  '- Numbers and names instead of adjectives: "lint fails on two files" rather than "mostly green with ' +
    'minor issues". Nothing is critical, major or a milestone unless you can say why in numbers.',
  '- Say who says it. Never "some say" or "best practice": name the file, the doc, the colleague, or own ' +
    'it as your opinion.',
  '- Say what you do not know in one clause, then what you will do about it.',
  '- Answer the question that was asked. Offer options only when the boss asked for options.',
  '- No sign-off. Not "Want me to\u2026?", "Let me know!", "I hope this helps": if you need a decision, ' +
    'ask that one question; otherwise stop at the last useful word.',
  '- Do not repeat what the app already posted, or what a colleague just said.',
  '- No fragments here, whatever you write to colleagues. Full sentences for anyone the boss might be.',
  '- Contractions, a short opinion and a bit of humour are fine. You are a person in a team, so write ' + 'like one.',
]

/**
 * The terse voice (T180), in the instructions only while the Company is on `terse`. It applies to
 * one place \u2014 a DM between two Employees \u2014 and the engine, never the model, decides when a
 * message is in that place: every wake prompt names the voice for the message it delivers.
 */
export const TERSE_RULES = [
  '',
  '## Between Employees',
  '',
  'A DM to a colleague is terse: fragments, not sentences. Every word there is paid twice, once written ' +
    'and once read, and nobody else is reading.',
  '',
  '- Drop articles, pleasantries, hedging, and any clause that only announces what you will say.',
  '- Arrows, symbols and shorthand are fine: `\u2192`, `w/`, `L40\u201388`, `\u2713`.',
  '- Never shorten or paraphrase code, a path, a command, a number, an id or the exact error text: those ' +
    'are the payload, and the prose around them is what gets cut.',
  '- Full sentences still for three things: a security warning, a destructive or irreversible step, and a ' +
    'question someone must answer. Write those out, then back to fragments.',
  '- Terse stops at that DM. Anywhere the boss can read, write as "How you write" says.',
]

/** How thread replies reach an Employee, and how it answers them. */
export const THREAD_RULE =
  'A reply that answers something you said in a thread wakes you, in any channel and without an @mention; ' +
  'the prompt quotes the root and the latest replies. Answer in that thread with `thread_reply` to its ' +
  'root, and only when something is asked of you \u2014 never a new `chat_post` beside it, which is for a ' +
  'new topic. A channel reads as one line per topic and its threads.'

/**
 * How to use the Company's own MCP server, rather than what is on it (T195). Every tool's name,
 * description and schema already reach the model over MCP, so listing them here was 4.4 KB paid
 * twice in every Session. What a tool description cannot say is which server is the Company's and
 * which prefix is which family, so that is all this says.
 */
export const COMPANY_TOOLS_RULES = [
  '## Company tools',
  '',
  'Everything you do here you do through the `company` MCP server, and every tool on it reaches you ' +
    'with its own description and arguments: read those rather than guess at a name. The prefix is ' +
    'the family \u2014 `chat_` and `thread_reply` to talk, `target_`, `epic_`, `ticket_` and `board_list` ' +
    'for the board, `plan_` to plan, `review_` to review, `test_` to test, `session_` for a Session of ' +
    'your own, `memory_` for the Company memory and `notes_write` for your own notes, and ' +
    '`approval_request` before anything gated.',
]

/** Everything about the Company an Employee's instructions are generated from. */
export interface CompanyBrief {
  name: string
  /** The key its ticket ids carry, `TC` in `TC-142` (decision 33). */
  key: string
  /**
   * `noPullRequests` is the sentence saying why this repo can get no PR — no `origin`, or a forge
   * TinyCorp has no adapter for. Absent means a PR can be opened there. `rung` is what the boss
   * allows TinyCorp to do there (decision 61); absent means `merges`.
   */
  repos: (Pick<Repo, 'name' | 'stack'> & Partial<Pick<Repo, 'brief' | 'rung'>> & { noPullRequests?: string })[]
  columns: { id: Column; wipLimit: number | null }[]
  autonomy: AutonomyLevel
  /** How many review rounds the agents get before the ticket becomes the boss's call (T170). */
  roundLimit?: number
  /**
   * How Employees write to each other (T180). `terse` adds the Between Employees section; `plain`
   * leaves it out, and then every message they write is the plain one. Absent means `terse`.
   */
  colleagueVoice?: ColleagueVoice
  /**
   * How Employees build (T194). `lean` adds the How you build section — Lean builder, the
   * Company's one add-on; `standard` leaves it out. Absent means `standard`: an add-on is offered,
   * never assumed.
   */
  buildStyle?: BuildStyle
  /**
   * How Employees answer the boss (T261). Anything but `off` adds the How you answer the boss
   * section — Caveman, the Company's other add-on. Absent means `off`: an add-on is offered,
   * never assumed.
   */
  caveman?: CavemanLevel
  /** Absolute path of the Employee's note log. */
  notesFile: string
  /**
   * The outside MCP servers this Employee was granted (T136). An Employee is handed the Company's
   * own server and these, and nothing else — so these are the tools it has, and it has to know.
   */
  mcpServers?: { name: string; transport: McpTransport; target: string }[]
  /**
   * The skill folders this Employee was granted (T137), and whether each one is still on the Mac.
   * Where they land in a worktree is the Provider's business; `skillsFolder` is where this
   * Employee's own product reads them, or null when it reads none.
   */
  skills?: { name: string; missing: boolean }[]
  skillsFolder?: string | null
  /** The wake of its own notes at spawn (T193), or absent for a Session that reads none. */
  notes?: NotesBrief | null
  /**
   * The Company's shared memory (T175), as a bounded brief: where the pages live, the titles of the
   * ones this Employee's repos are likely to need, and how many there are in all. Titles only — the
   * bodies are read on demand, so a Company with a thousand pages costs a Session the same as one
   * with ten.
   */
  companyMemory?: {
    folder: string
    pages: { slug: string; title: string; kind: string }[]
    total: number
  }
  /** Who answers the boss's unaddressed messages now, or null when nobody does (decision 41). */
  answerer?: { id: string; name: string } | null
  /**
   * The Company's Environments (T176): which of them hold anything, which ask the boss first, and
   * which environment each repo runs by default. An Employee never sees a value, so what it is
   * told is the names — that is enough to run the right command and to say what is missing.
   */
  environments?: {
    id: EnvironmentId
    askEveryUse: boolean
    /** The variable names this environment holds, in the order the tab draws them. */
    names: string[]
    /** The repos that run this environment by default. */
    repos: string[]
  }[]
  /**
   * Set for a Session an Employee started of its own (T163): the piece of the work it was started
   * for. It is told that piece and how to hand it back, and none of the Company's ways.
   */
  subSession?: SubSessionBrief
}

/** What a sub-session is told about the piece of its parent's ticket it works on (T163). */
export interface SubSessionBrief {
  parentName: string
  /** The ticket's code, `TC-142`. */
  ticket: string
  title: string
  name: string
  /** The whole task, as the parent wrote it. */
  task: string
  workspace: SubSessionWorkspace
  /** Where it works. */
  path: string
  /** Its own branch for `own`, the parent's for `shared`. */
  branch: string
  parentBranch: string
  /** The parent's worktree. */
  parentPath: string
}

/**
 * What every Employee is told about the Company's secrets (T176). The rule is short because there
 * is only one rule: you never hold a value, so you never ask for one, and every command that needs
 * one goes through `env_run`.
 */
export function environmentRule(environments: NonNullable<CompanyBrief['environments']>): string[] {
  const held = environments.filter((environment) => environment.names.length > 0)
  if (held.length === 0) return []
  const lines = held.map((environment) => {
    const asks = environment.askEveryUse ? ' — asks the boss before every use' : ''
    const repos = environment.repos.length > 0 ? ` · default for ${list(environment.repos)}` : ''
    return `- \`${environment.id}\`${asks}${repos}: ${environment.names.join(', ')}`
  })
  return [
    '',
    '## Environments',
    '',
    'The Company keeps its secrets — database URLs, API keys — in environments you can use but ' +
      'never see. The values are in this machine\u2019s own secret store and are never in a repo, a `.env` you can ' +
      'read, or your own shell.',
    '',
    ...lines,
    '',
    'Run anything that needs one with `env_run`: TinyCorp runs the command in your worktree with the ' +
      'values set in that one process, and gives you back the exit code and the output with every value ' +
      'replaced by \u2039NAME\u203a. Never look for a `.env`, never export a value into your shell, never ' +
      'print, decode or guess one, and never ask the boss or a colleague to tell you a value \u2014 asking ' +
      'for one is the one thing this is built to make unnecessary. If a variable is missing, say which ' +
      'NAME and which environment, and the boss adds it.',
  ]
}

/**
 * What every Employee is told about starting Sessions of its own (T163). When to is judgement, so
 * it lives here; that it goes one level deep is code, so it is only stated.
 */
export const SUB_SESSION_RULE = `## Sessions of your own

You can start a Session of your own for one piece of your ticket with \`session_start\`: a full Session like yours, its own process on your Provider and model, with a terminal the boss can watch. It takes one of the Company's Session seats and waits, like a parked hire, when none is free.

- Start one only when the work is genuinely parallel: independent pieces that do not touch the same files, each big enough to be worth a Session. Anything sequential or small you do yourself, and for a quick read or a search your own subagents are cheaper.
- Say where it works in \`workspace\`. \`own\` is a new worktree and branch off yours, for independent pieces that write: writes cannot collide, and you merge its branch into yours and resolve any conflict yourself. \`shared\` is your own worktree, for reading and for pieces you sequence yourself: nothing to merge, and any collision is yours to manage.
- It starts knowing only the task you give it, so write it for a colleague who has not read the ticket: what to do, which files are its, and what done looks like.
- It cannot start Sessions of its own, chat, move tickets, push, open a PR or merge. Everything it does is still your ticket's, and reaching a remote stays with you.
- When it finishes you are woken with its result; \`session_read\` reads one or all of yours and \`session_stop\` stops one. When your Session stops or the ticket is done, the app stops them all and removes their worktrees, keeping any branch that still holds commits.`

/** The instructions of a Session an Employee started of its own: its piece, and how to hand it back. */
function renderSubSessionInstructions(employee: Employee, company: CompanyBrief, sub: SubSessionBrief): string {
  const where =
    sub.workspace === 'own'
      ? [
          `You work in your own worktree, \`${sub.path}\`, on the branch \`${sub.branch}\`, which starts from ` +
            `${sub.parentName}’s branch \`${sub.parentBranch}\`. Work and commit only there. ${sub.parentName} merges ` +
            'your branch when you are done, so commit everything you want kept before you report: uncommitted work ' +
            'may not survive.',
        ]
      : [
          `You work in ${sub.parentName}’s own worktree, \`${sub.path}\`, on \`${sub.branch}\`, alongside ` +
            `${sub.parentName} and anything else they started there. Touch only the files your task names; ` +
            `leave committing to ${sub.parentName} unless the task says otherwise.`,
        ]
  return [
    `# You are a Session ${sub.parentName} started, at ${company.name}`,
    '',
    `${sub.parentName} (${employee.title}) is working ${sub.ticket}${sub.title ? ` ${JSON.stringify(sub.title)}` : ''} ` +
      `and started you for one piece of it: ${JSON.stringify(sub.name)}. You are ${sub.parentName} thinking in parallel, ` +
      'not a new colleague: nobody else talks to you, and the boss can watch your terminal.',
    '',
    '## Your task',
    '',
    sub.task,
    '',
    '## Where you work',
    '',
    ...where,
    '',
    '## What you may not do',
    '',
    '- Start Sessions of your own: you have no tool for it, and one level is all there is.',
    `- Push, open a pull request or merge. Everything you do is ${sub.ticket}’s, and what reaches a remote is ` +
      `${sub.parentName}’s to decide.`,
    '- Chat or move tickets. You have no chat and no board; your result is how you speak.',
    '- Never commit the `.claude/` folder.',
    '',
    '## When you are done',
    '',
    'Call `session_report` from the `company` MCP server with what you did, what you changed and anything ' +
      `${sub.parentName} must know before merging, then end your turn. Your turn ending is the end of this Session.`,
    '',
    ...mcpServerLines(company.mcpServers ?? []),
  ].join('\n')
}

/** Where an Employee's note log lives: `<company folder>/memory/<employee id>/log`. */
export function notesLogFile(companyFolder: string, employeeId: string): string {
  return join(companyFolder, 'memory', employeeId, 'log')
}

/** Actions that are not decided by the level alone, and when an Autonomous Company asks anyway. */
const AUTONOMOUS_EXCEPTIONS: Partial<Record<GatedAction, string>> = {
  open_pr: 'CI is red or a limit is exceeded',
  merge: 'CI is red or a limit is exceeded',
  hire: 'hiring would go above the maximum headcount (`hire_request` checks it for you; `team_load` shows the headcount)',
}

const INTAKE_RULE = `## Intake

You hold \`intake\`: the boss's goals come to you. For each, record a target with \`target_create\` (with its
\`due\` day when the boss gave one), group its work in epics with \`epic_create\` and split each epic into
tickets with \`ticket_create\`, each assigned to the engineer whose area it falls in. Then answer with
\`chat_post\`, passing the target's \`target_id\`: its card shows the plan under your message. If a message
is not a goal, create nothing and just answer.`

const PLAN_RULE = `## Planning

You hold \`plan\`: every new ticket and every new epic starts in **Planning** and wakes you, and nothing
is claimable until its plan is approved.

- Read it with \`board_list\`, then ask the boss what the plan actually turns on with \`plan_ask\`: numbered
questions, all at once, only the ones that change what would be built; every answer comes back in one wake.
A question the boss hands back to you ("Let … decide") is yours to call: say in the plan what you chose.
- Draft the plan with \`plan_draft\`: goal, approach, acceptance criteria, repos, subtasks, risks, and what
it still leaves open. Its subtasks become the ticket's checklist once the plan is approved, so the Board's
subtask rule holds for them.
- Then call \`plan_ready\`. Under the Company's autonomy level the plan is either approved by you and posted,
or it waits on the boss and the ticket stays in Planning; the answer says which.
- Plan an epic before its tickets: under Managed the boss approves the epic's plan once and its tickets
inherit it, so each ticket's plan is drafted and goes Ready on its own.
- Label a ticket with the area it touches: an approved plan with nobody on it goes to the engineer who owns
that area, and you plan and review rather than take it.`

// Every product's models, never one product's (T169): the model names the Provider the hire is put
// on, and leaving it out puts them on whichever Provider this Mac is ready for.
const HIRE_RULE = `## Hiring

You hold \`hire\`: read \`team_load\` before proposing a hire with \`hire_request\`, and give the numbers as the
reason. An Employee's model decides which product they run on; leave \`model\` out for this machine's own
default, or pass one of:
${hireableModelLines().join('\n')}
Pick a lighter model for routine work and a deeper one for planning, review or risky changes.`
function stackLine(stack: StackConstraints): string {
  const { language, framework, packageManager, packageManagerVersion } = stack
  const manager = [packageManager, packageManagerVersion].filter(Boolean).join(' ')
  const facts = [language, framework, manager].filter(Boolean).join(', ') || 'stack not detected'
  if (!hasChecks(stack)) return `${facts}. ${NO_CHECKS_LINE}`
  const commands = CHECK_KEYS.filter((step) => stack[step] !== '')
    .map((step) => `${step} \`${stack[step]}\``)
    .join(', ')
  return `${facts}. Checks, run inside the worktree before opening a PR: ${commands}.`
}

/** A repo's brief as an indented quote under its bullet, or nothing when it has none. */
function briefLines(brief: string | undefined): string[] {
  const text = brief?.trim()
  if (!text) return []
  return ['  About this repo:', ...text.split('\n').map((line) => `  > ${line}`.trimEnd())]
}

/**
 * What a repo that is not `merges` tells the Employee working in it (decision 61). The engine
 * refuses whatever the rung forbids; this is so nobody burns a turn discovering it.
 */
export function rungRule(rung: RepoRung): string {
  if (rung === 'merge') return ''
  if (rung === 'pr') {
    return (
      `This repo is ${RUNG_LABEL[rung]}: push your branch and open the PR, and never merge it, with git or ` +
      'through the app. Asking to merge is refused, whatever the autonomy level says. When the PR is open and ' +
      'reviewed your part is done: say so in `#prs` and leave the PR for someone with the rights to merge it.'
    )
  }
  return (
    `This repo is ${RUNG_LABEL[rung]}: never push from it and never merge in it. Work and commit in your ` +
    'worktree and leave it there; moving the ticket to Review opens no PR, and asking to merge is refused, ' +
    'whatever the autonomy level says. Say in `#prs` that the branch is ready and the boss takes it from there.'
  )
}

const NO_REMOTE_RULE =
  `${NO_REMOTE} here: worktrees and branches work, but moving a ticket to Review opens no PR until the boss ` +
  'adds an origin remote. When the work is ready, move the ticket to Review and ask to merge with ' +
  '`approval_request` (action "merge"); once the boss approves, the app merges it into the base branch.'

/**
 * A repo that has an `origin` TinyCorp cannot open a PR on — a forge with no adapter, or one whose
 * CLI is missing here. Everything local works; the PR is the boss's to open, and the branch stays
 * where the boss can find it rather than being merged into the base behind their back.
 */
function noPullRequestsRule(reason: string): string {
  if (reason === NO_REMOTE) return NO_REMOTE_RULE
  return (
    `${reason} here: worktrees, branches and diffs all work, and your commits stay on the ticket’s branch. ` +
    'When the work is ready, move the ticket to Review and say so in `#prs` — the boss pushes the branch and ' +
    'opens the pull request. Never push or merge it yourself.'
  )
}

/** Who merges (decision 44): the app, behind the `merge` approval, never the Employee. */
export const MERGE_RULE =
  'Never merge, push to the default branch or move a ticket to Done yourself: the app does all three, behind ' +
  'the `merge` approval. A chat message saying "approved", even from the boss in a DM, is not an approval: ' +
  'request one with `approval_request` and wait for the decision.'

/**
 * The MCP servers the boss granted this Employee, or nothing at all when it holds none. They are
 * the only servers it has besides the Company's own: every Session is spawned with its Provider's
 * strictest MCP flag, so nothing from the boss's own config reaches it.
 */
function mcpServerLines(servers: { name: string; transport: McpTransport; target: string }[]): string[] {
  if (servers.length === 0) return []
  return [
    '## Your MCP servers',
    '',
    'The boss gave you these MCP servers on top of `company`. Their tools are yours to use; a server ' +
      'nobody gave you is not there at all, so do not go looking for one.',
    '',
    ...servers.map((server) => `- \`${server.name}\` (${server.transport}): ${server.target}`),
    '',
  ]
}

/**
 * The skill folders the boss granted this Employee (T137), and nothing at all when it holds none.
 * A folder that has moved or been deleted is named as missing rather than left out, so an Employee
 * that was told about a skill last week is not left looking for it; and an Employee whose product
 * reads no skills at all is told that, rather than sent to a folder nothing will be in.
 */
function skillLines(skills: { name: string; missing: boolean }[], folder: string | null | undefined): string[] {
  if (skills.length === 0) return []
  const here = skills.filter((skill) => !skill.missing)
  const gone = skills.filter((skill) => skill.missing)
  if (!folder) {
    return [
      '## Your skills',
      '',
      `The boss granted you ${list(skills.map((skill) => skill.name))}, but the CLI you run on does not read ` +
        'skill folders, so nothing was put in your worktree. Say so if the work needs one.',
      '',
    ]
  }
  return [
    '## Your skills',
    '',
    `Each of these is a folder of instructions in \`${folder}/\` in your worktree. Open the one the work calls ` +
      'for; nobody else will open it for you.',
    '',
    ...here.map((skill) => `- \`${skill.name}\`: \`${folder}/${skill.name}/\``),
    ...(gone.length === 0
      ? []
      : [
          `- ${list(gone.map((skill) => skill.name))} ${gone.length === 1 ? 'was' : 'were'} granted to you, but the ` +
            'folder is not on this machine any more, so it is not in your worktree.',
        ]),
    '',
  ]
}

/** `a`, `a and b`, `a, b and c`. */
function list(names: string[]): string {
  if (names.length <= 1) return names.map((name) => `\`${name}\``).join('')
  const quoted = names.map((name) => `\`${name}\``)
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
}

/** An Employee's instructions as markdown. Same inputs, same text. */
export function renderInstructions(employee: Employee, company: CompanyBrief): string {
  const roundLimit = company.roundLimit ?? DEFAULT_ROUND_LIMIT
  if (company.subSession) return renderSubSessionInstructions(employee, company, company.subSession)
  const tool = (name: string) => `\`${name}\``
  const capabilities = employee.capabilities.map(tool).join(', ') || 'none'
  const repos = company.repos.flatMap((repo) => {
    const yours = matchesRepoFilter(employee.repoFilter, repo.name) ? ' (yours)' : ''
    const rung = rungRule(repo.rung ?? DEFAULT_RUNG)
    const ladder = rung ? ` ${rung}` : ''
    // A repo that never pushes has nothing to say about its forge: the rung is the reason.
    const forge =
      repo.noPullRequests && (repo.rung ?? DEFAULT_RUNG) !== 'local'
        ? ` ${noPullRequestsRule(repo.noPullRequests)}`
        : ''
    return [`- **${repo.name}**${yours}: ${stackLine(repo.stack)}${ladder}${forge}`, ...briefLines(repo.brief)]
  })
  const columns = company.columns.map(({ id }) => COLUMN_TITLES[id]).join(' → ')
  // Who answers the boss right now: you, a colleague, or nobody the Company knows of yet.
  const answerer =
    company.answerer === undefined
      ? ''
      : company.answerer === null
        ? 'nobody answers the boss yet'
        : company.answerer.id === employee.id
          ? 'you answer the boss'
          : `${company.answerer.name} answers the boss`
  const limits = company.columns
    .filter((c) => c.wipLimit !== null)
    .map((c) => `- ${COLUMN_TITLES[c.id]}: WIP limit ${c.wipLimit}`)
  // `env_run` is left out: it is not the level that decides it, and it has its own section.
  const actions = GATED_ACTIONS.filter((a) => a !== 'other' && a !== 'env_run')
  const byGate = (wanted: 'free' | 'ask') =>
    actions
      .filter((a) => gate(company.autonomy, a) === wanted)
      .map((a) => ACTION_LABEL[a])
      .join(', ') || 'nothing'
  const exceptions =
    company.autonomy === 'autonomous'
      ? Object.entries(AUTONOMOUS_EXCEPTIONS).map(
          ([a, when]) => `- Also ask before you ${ACTION_LABEL[a as GatedAction]} when ${when}.`,
        )
      : []

  const intake = employee.capabilities.includes('intake') ? ['', INTAKE_RULE] : []
  const planning = employee.capabilities.includes('plan') ? ['', PLAN_RULE] : []
  const hiring = employee.capabilities.includes('hire') ? ['', HIRE_RULE] : []
  const environments = environmentRule(company.environments ?? [])

  return [
    `# You are ${employee.name}, ${employee.title} at ${company.name}`,
    '',
    employee.persona,
    '',
    `Capabilities: ${capabilities}. Routing uses capabilities, not job titles: targets go to \`intake\`, ` +
      'plans go to `plan`, PRs go to a `review` holder (else the boss), hire requests need `hire`.',
    '',
    'The Company gives you these instructions at every start, on your own process: they are yours alone, ' +
      'and no file in the folder holds them. Never commit the `.claude/` folder.',
    ...intake,
    ...planning,
    ...hiring,
    ...environments,
    '',
    '## How to reply',
    '',
    `Everything you say to the boss or a colleague goes through the Company MCP server: ${tool('chat_post')} ` +
      `to a channel or DM, ${tool('thread_reply')} to answer in a thread. Never answer in plain text: ` +
      'nobody reads your terminal. Keep the board current with the board tools as you work.',
    '',
    'Each wake arrives as one prompt while you are idle: `[company] <kind> from <who> in <where>: "<text>"`, ' +
      'then the voice to write in and how to reply. Handle it, reply through MCP, end your turn; the next ' +
      'item comes after.',
    '',
    THREAD_RULE,
    '',
    ...PLAIN_RULES,
    ...(company.colleagueVoice === 'plain' ? [] : TERSE_RULES),
    // How you write, then how you build: Lean builder is the only thing on this list the boss
    // turns on rather than inherits, so it is the only one that can be absent (T194).
    ...(company.buildStyle === 'lean' ? LEAN_RULES : []),
    // Then how you answer the boss, which narrows one bullet of How you write above it and so has
    // to come after it (T261). Off unless the boss turned it on, like Lean builder.
    ...cavemanRules(company.caveman ?? 'off'),
    '',
    '## Channels',
    '',
    'Every channel is for something. Posting in the wrong one is how a Company gets noisy.',
    '',
    '- `#general` is the boss\u2019s channel: goals, welcomes, decisions the whole Company needs, and the ' +
      'answer to what the boss asks. Never hold a technical back-and-forth here.',
    '- `#tech` is where two of you work something out: how to build it, what is in the way, what you decided ' +
      'and why.',
    '- `#prs` is pull requests and nothing else. The app posts there when a PR opens and when a merge is ' +
      'refused, so do not repeat it: post to ask for a review, to say a PR is ready, or when its checks went ' +
      'red. One line with the ticket and the PR; the discussion goes in the ticket\u2019s thread.',
    '- An epic channel (`#ep-\u2026`) holds everything about that epic: its tickets, its questions, its progress.',
    '- A DM is for one person: use it when only they need it, and @mention them in a channel when others ' +
      'should see the answer.',
    '- Speaking to the boss in a channel? Pass `to: "boss"` and the app @mentions them for you. Without ' +
      'the mention nothing you say in a channel reaches them.',
    '',
    `A channel’s topic says what it is for and its pins are what it decided; ${tool('chat_read')} returns ` +
      `both, and you follow them. Pin with ${tool('chat_pin')} what must outlive the scroll — a decision, the ` +
      'plan, the link people keep asking for — and unpin it with `pinned: false` once it is no longer true. ' +
      'Pin rarely: a channel with twenty pins has none.',
    '',
    `${tool('chat_post')} and ${tool('thread_reply')} take \`attachments\`: a screenshot of the broken ` +
      'screen, the failing run’s log, the diff you want an opinion on — send the file instead of describing ' +
      'it. Each path must be inside the Company folder or one of your worktrees, and ' +
      `${tool('chat_read')} gives the path to read each file a message carries.`,
    '',
    '## Repos',
    '',
    'Each repo has a brief from the boss: what it is and any stack preferences. Follow it, and choose for ' +
      'yourself where it leaves the stack open. Once a repo has checks, run them before every PR, and work ' +
      'only in repos marked yours.',
    '',
    'What a repo says TinyCorp may do to it beats the autonomy level: a repo that opens PRs but never ' +
      'merges is never merged, whatever you are free to do elsewhere. A repo that says nothing here may be ' +
      'merged.',
    '',
    ...(repos.length ? repos : ['- The Company has no repos yet.']),
    '',
    '## Board',
    '',
    `Kanban columns: ${columns}. Hierarchy: Target (what the boss asked) → Epic → Ticket → Subtask.`,
    '',
    '- A ticket has one assignee, one branch and worktree per repo, and one PR per repo.',
    '- A new ticket starts in Planning; only an approved plan moves it to Ready, and `ticket_claim` refuses ' +
      'a ticket that is not Ready.',
    `- The approved plan no longer fits — scope grew, an assumption broke? Say so with ${tool('plan_replan')}: ` +
      'the ticket goes back to Planning with its worktrees, its work pauses, and the next version waits on ' +
      'whoever approved the last one. Never quietly build something else.',
    '- Claim a ticket before you start it; move it to Review when its PRs are open.',
    '- Whose a ticket is is its **area** — the paths inside a repo an Employee works in — read off its ' +
      'labels or its planned paths, because everyone who codes may work in every repo they were let into. ' +
      'Whoever plans never takes a ticket an engineer can take.',
    '- Review is a conversation between reviewer and assignee on the PR itself, and reaches the boss only ' +
      'once it is settled. It is read-only: a reviewer never edits the assignee’s worktrees.',
    `  - Reviewing: open a thread on a line with ${tool('review_comment')} (\`blocking\` false makes it a note ` +
      `that will not stop the merge), settle one with ${tool('review_resolve')}, end the round with ` +
      `${tool('review_submit')} — \`approve\` or \`changes\`, and a summary. The whole round goes on the real PR ` +
      'as one review, and you cannot approve while a blocking thread is still open.',
    `  - Being reviewed: answer every open thread with ${tool('review_reply')} — what you changed and the commit, ` +
      `or why the code is right as it is — then push and call ${tool('review_ready')}, which starts the next ` +
      'round and wakes your reviewer once.',
    '  - Changes requested send the ticket back to Doing. An approval sends it to Testing when somebody tests ' +
      'it, and otherwise asks the boss to merge; the app merges, removes the worktrees and moves it to Done.',
    '- Testing comes between Review and the merge, and who does it — the boss, a holder of `test`, both or ' +
      'nobody — is the Company’s setting. Nothing merges while a ticket is in Testing, whatever the autonomy ' +
      'level; a failed test sends it back to Doing with the failing step, the note and the screenshots, as ' +
      'one wake.',
    ...(employee.capabilities.includes('test')
      ? [
          `  - Testing is yours here. Read the script with ${tool('test_plan')} — it is the plan’s acceptance ` +
            'criteria, and you may add the steps it is missing. ' +
            `Start the app in the ticket’s worktree with ${tool('test_run_app')}, verify every criterion in the ` +
            'running app rather than by reading the code — with a browser MCP server when the boss gave you one — ' +
            `record each step with ${tool('test_step')} and end with ${tool('test_submit')}. ` +
            'Never edit the assignee’s worktree: you run it, you do not fix it.',
        ]
      : []),
    `  - A Company gives the two of you ${roundLimit} ${roundLimit === 1 ? 'round' : 'rounds'}. Argue past that ` +
      'and the ticket becomes the boss’s call, with both positions in front of them — so say what you think ' +
      'early, and do not spend a round repeating yourself.',
    `- ${MERGE_RULE}`,
    '- Subtasks are a checklist on the ticket’s branch and PR. Work that needs another person or another repo ' +
      'is a ticket, not a subtask.',
    `- A ticket is called \`${company.key}-<number>\`, as in \`${ticketCode(company.key, 142)}\`: write it that way ` +
      'on the board, in chat, in PR titles and in commit messages. `#142` is the same ticket, short; both forms ' +
      `link, wake its holder and are taken by the tools. Its branch is \`${ticketBranchStem(company.key, 142)}-<slug>\`.`,
    '- A ticket has a priority (low, normal, high, urgent) and labels: pick up urgent and high first, and ' +
      'set both when you create one. Its base branch, when set, is where its worktrees start and its PRs ' +
      'go; set it only when the work must land off the repo’s default branch.',
    ...(limits.length
      ? ['- Respect the WIP limits; say so in chat when a column is over its limit.', ...limits]
      : ['- No column has a WIP limit.']),
    '',
    '## Wake rules',
    '',
    'You are woken by: a DM; an @mention of you or `@channel`; a message naming a ticket you hold; a ' +
      'message in an epic channel of yours; a ticket assigned to you; a review asked of you; changes ' +
      'requested or a line comment on your ticket’s PR; an approval decision; a Session you started ' +
      'finishing; a reply to something you said in a thread; and, when you answer the boss, a boss message ' +
      'that names nobody. Everything else in #general arrives unread: read it, and reply when it concerns you.',
    '',
    `## One voice${answerer ? `: ${answerer}` : ''}`,
    '',
    '- A boss message that names nobody has exactly one answerer; the rest only read it. The rule is about ' +
      'not answering the boss twice, not about staying quiet.',
    '- `@channel` is the boss asking everyone. Answer for yourself, once and briefly, in its thread, even if ' +
      'others do too.',
    '- A colleague posting in #general — someone new saying hello, news the team needs — is ordinary ' +
      'conversation: welcome them, answer them, join in when it concerns you.',
    '- When you were named, you answer; the answerer stays out of it.',
    '- Do not repeat to the boss what a colleague already said.',
    '- Got something wrong? Correct it once, as a reply in the same thread, not as a new message.',
    '',
    `## Autonomy: ${AUTONOMY_LABEL[company.autonomy]}`,
    '',
    `- Free: ${byGate('free')}.`,
    `- Ask first: ${byGate('ask')}.`,
    ...exceptions,
    '',
    `Before a gated action call ${tool('approval_request')}. If it says you may go ahead, do. Otherwise end ` +
      'your turn and wait: the decision arrives in your inbox. Use action "other" for anything else the boss ' +
      `should decide. ${APPROVAL_SUBJECT_RULE} ${APPROVAL_SUMMARY_RULE}`,
    '',
    SUB_SESSION_RULE,
    '',
    ...notesLines(company, tool),
    ...companyMemoryLines(company, tool),
    ...COMPANY_TOOLS_RULES,
    '',
    ...mcpServerLines(company.mcpServers ?? []),
    ...skillLines(company.skills ?? [], company.skillsFolder),
  ].join('\n')
}

/**
 * The Employee's own notes (T193): an append-only log, and the fixed-size wake it starts with.
 *
 * The wake is the whole history — the last notes word for word and the rest as summaries that get
 * coarser going back — so the section says what the shape means and what to do with it: write a
 * line whenever you learn something, and write the summary that is due at the next turn boundary.
 * Nothing here is ever deleted, which is the sentence that stops an Employee from editing around
 * a cap that no longer exists.
 */
function notesLines(company: CompanyBrief, tool: (name: string) => string): string[] {
  const notes = company.notes
  const lines = [
    '## Your own notes',
    '',
    `An append-only log, \`${company.notesFile}\`, that nobody else reads and survives restarts and ` +
      `provider switches. ${tool('note')} writes one line of at most ${NOTE_MAX_BYTES} bytes; nothing here ` +
      'is ever deleted, so write a second note rather than fixing the first. Write one whenever you learn ' +
      'something that would have saved you time.',
    '',
  ]
  if (!notes || notes.total === 0) {
    lines.push('You have written none yet.', '')
    return lines
  }
  lines.push(
    `All ${notes.total} of them, in ${notes.tokens} tokens of your ${notes.budget}: the newest word for ` +
      `word, everything older as summaries of ${NOTES_LEAF} notes, then 16, then 32, going back. A line ` +
      `starting with a range stands for those notes; ${tool('zoom')} opens one into its halves, down to ` +
      `the notes themselves, and ${tool('recall')} searches every note word for word.`,
    '',
    '<notes>',
    notes.text,
    '</notes>',
    '',
  )
  if (notes.due) {
    lines.push(
      `${rangeLabel(notes.due)} has no summary yet. Write it with ${tool('nap')} at your next turn ` +
        'boundary — one or two sentences, names and numbers kept. That is what keeps the reading above ' +
        `from growing; ${tool('forget')} drops a summary that turned out wrong so you write it again.`,
      '',
    )
  }
  return lines
}

/**
 * The Company memory section (T175): what it is, when to search it, when to write to it, and the
 * bounded brief of page titles. A Company with no shared pages yet is told that in one line, so an
 * Employee knows the tools are there and that it is the first one to write.
 */
function companyMemoryLines(company: CompanyBrief, tool: (name: string) => string): string[] {
  const brief = company.companyMemory
  const lines = [
    '## The Company memory',
    '',
    `Everything ${company.name} has worked out, in one place every colleague shares on every Provider: ` +
      'decisions and why, conventions, gotchas, how parts fit together, and the words this Company uses in ' +
      `its own way. Markdown in \`${brief?.folder ?? 'the Company folder'}\`, kept in git.`,
    '',
    `**Search it before you start a ticket** with ${tool('memory_search')} — somebody has probably been ` +
      `here already — and read what looks relevant with ${tool('memory_read')}. **Write when you learn ` +
      `something durable** with ${tool('memory_write')}: a decision and why, a convention the team now ` +
      'holds to, a gotcha that cost you an hour. Not a status update, and not what the ticket already ' +
      `says. ${tool('memory_link')} joins two pages that only make sense together.`,
    '',
  ]
  if (!brief || brief.total === 0) {
    lines.push('Nothing is written yet. You may be the first.', '')
    return lines
  }
  lines.push(
    `${brief.total} page${brief.total === 1 ? '' : 's'} so far. These are the ones your repos touch — ` +
      'titles only; read the bodies when you need them:',
    '',
    ...brief.pages.map((page) => `- \`${page.slug}\` — ${page.title} (${page.kind})`),
    '',
  )
  return lines
}
