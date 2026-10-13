import type { Ticket } from '../../../shared/domain/board'
import { BOSS, type Mentionable } from '../../../shared/domain/chat'
import { PROVIDER_SHORT_NAME, PROVIDER_SKILLS_FOLDER } from '../../../shared/domain/providers'
import type { Employee, Provider } from '../../../shared/domain/staff'
import { matchesRepoFilter } from '../../../shared/domain/staff'
import type { NotesBrief } from '../../../shared/memory/notes'
import type { Repo } from '../../../shared/repos/repo'
import type { ReviewComment } from '../../../shared/review/review-diff'
import { type OpenCompany, ticketCodeIn } from '../../core'
import type { HandoffMove } from '../usage'
import type { RoutingHandoff } from './handoff-prompt'
import { type CompanyBrief, notesLogFile } from './instructions'

/**
 * What a Session is told, and what the next one is told when the first hands over.
 *
 * Two compositions, and they are compositions and nothing else: every fact in them is read from
 * some other feature, and none of it is stored here. They lived in `company-engine.ts` until T188,
 * which is why they are written against a set of façades rather than against the engine — the brief
 * needs the repos, the board, the code flow, the chat, review, memory, approvals and the
 * environments, and naming all eight through one object would be naming the engine again.
 *
 * Both are read from the Company rather than from the Session, deliberately: a Session that has
 * already died hands over exactly as much as one that stopped cleanly.
 */

/** How many recent messages of an Employee's own channels travel in a handoff prompt (T173). */
const HANDOFF_MESSAGES = 8

/** One place the Files view can open, as a handoff names one: enough to find its `git status`. */
export interface BriefPlace {
  id: string
  path: string
}

/** What a place's `git status` says, as a handoff reports it. */
export interface BriefChanges {
  files: { path: string }[]
  truncated: boolean
}

/** One ticket's worktrees, as a handoff names them. */
interface BriefWorktree {
  path: string
  branch: string
}

/**
 * The façades a brief is composed from, one function per feature.
 *
 * Every one takes the Company it is about, because a brief is built for whichever Company the
 * Session belongs to and never for "the current one" — a handoff can be written for a Company the
 * boss is not looking at.
 */
export interface BriefDeps {
  /** That Company's roster. */
  employees(entry: OpenCompany): Employee[]
  /** Its attached repos, for the brief's list and for what a Session may name. */
  repos(entry: OpenCompany): Repo[]
  /** Why a repo can get no PR, in the same words the drawer and `#prs` use, or null. */
  pullRequestRefusal(repoPath: string): string | null
  /** Its board's columns, with each one's WIP limit. */
  columns(entry: OpenCompany): CompanyBrief['columns']
  /** Its tickets, for the one a handing-over Employee is on. */
  tickets(entry: OpenCompany): Ticket[]
  /** One ticket's worktrees, newest first. */
  worktreesOf(entry: OpenCompany, ticketId: number): BriefWorktree[]
  /** Everyone who can be named in that Company. */
  people(entry: OpenCompany): Mentionable[]
  /** The last messages of the channels an Employee is in, oldest first. */
  recentMessages(entry: OpenCompany, employeeId: string, limit: number): { authorId: string; text: string }[]
  /** Every line comment on a ticket, oldest first. */
  reviewComments(entry: OpenCompany, ticketId: number): ReviewComment[]
  /** The Company's review round limit. */
  roundLimit(entry: OpenCompany): number
  /** Its autonomy level. */
  autonomy(entry: OpenCompany): CompanyBrief['autonomy']
  /** The one voice Employees write to each other in (T180). */
  colleagueVoice(entry: OpenCompany): CompanyBrief['colleagueVoice']
  /** Whether Lean builder is on for that Company (T194). */
  buildStyle(entry: OpenCompany): CompanyBrief['buildStyle']
  /** Whether Caveman is on for that Company, and at which intensity (T261). */
  caveman(entry: OpenCompany): CompanyBrief['caveman']
  /** The MCP servers this Employee holds, as the brief lists them. */
  mcpServers(entry: OpenCompany, employeeId: string): CompanyBrief['mcpServers']
  /** The skill folders it holds, as the brief lists them. */
  skills(entry: OpenCompany, employeeId: string): CompanyBrief['skills']
  /** What the Company keeps in each Environment, by name and never by value (T176). */
  environments(entry: OpenCompany): CompanyBrief['environments']
  /** That Employee's own notes, as the fixed-size wake a Session starts with (T193). */
  notes(entry: OpenCompany, employeeId: string): NotesBrief
  /** The shared wiki's folder, its bounded brief for these repos, and how many pages it holds. */
  companyMemory(entry: OpenCompany, repoNames: string[]): CompanyBrief['companyMemory']
  /** Writes the Handoff page a provider switch leaves behind; returns its slug. */
  writeHandoffPage(entry: OpenCompany, page: { title: string; body: string; ticketCode: string | null }): string
  /** Who answers the boss when a message addresses nobody, head of the chain (decision 41). */
  answerer(companyId: string): { id: string; name: string } | null
  /** Every place the Files view can open, for the worktree a handoff reports on. */
  places(): BriefPlace[]
  /** One place's `git status`, straight off the cache. May throw; a handoff survives that. */
  changesOf(placeId: string): BriefChanges
  log(line: string): void
}

/** The two compositions, wired. */
export interface Briefs {
  /** Everything a Session is told when it starts. */
  of(entry: OpenCompany, employeeId: string): CompanyBrief
  /** Everything the new Session is told when an Employee moves Provider (T173). */
  handoff(entry: OpenCompany, employeeId: string, move: HandoffMove): RoutingHandoff
  /**
   * The Handoff page that switch writes (T175): where the work stands, what failed and what is
   * open, in the Company's shared memory rather than only in the prompt. Null when it could not be
   * written — a page that cannot be saved must never stop the move.
   */
  handoffPage(entry: OpenCompany, employeeId: string, handoff: RoutingHandoff, move: HandoffMove): string | null
}

export function createBriefs(deps: BriefDeps): Briefs {
  /** The Provider as the boss names it: the prompt is read, so never an id. */
  const providerName = (provider: string) => PROVIDER_SHORT_NAME[provider as Provider] ?? provider

  function employeeIn(entry: OpenCompany, employeeId: string): Employee | undefined {
    return deps.employees(entry).find((person) => person.id === employeeId)
  }

  /**
   * Where this Employee's own product reads skill folders, or null when it reads none (T137). An
   * Employee on a Provider without skills is told that, rather than sent to a folder nothing fills.
   */
  function skillsFolderOf(entry: OpenCompany, employeeId: string): string | null {
    const employee = employeeIn(entry, employeeId)
    return employee ? PROVIDER_SKILLS_FOLDER[employee.provider] : null
  }

  /** The shared pages a Session is told about at spawn, and where they all live. */
  function companyMemoryBrief(entry: OpenCompany, employeeId: string): CompanyBrief['companyMemory'] {
    const employee = employeeIn(entry, employeeId)
    const mine = deps
      .repos(entry)
      .filter((repo) => !employee || matchesRepoFilter(employee.repoFilter, repo.name))
      .map((repo) => repo.name)
    return deps.companyMemory(entry, mine)
  }

  return {
    of(entry, employeeId) {
      // Read once, and each left out of the brief when the Company has nothing to say about it:
      // an absent key is what the instructions read as "not set", never a key holding undefined.
      const colleagueVoice = deps.colleagueVoice(entry)
      const buildStyle = deps.buildStyle(entry)
      const caveman = deps.caveman(entry)
      const mcpServers = deps.mcpServers(entry, employeeId)
      const skills = deps.skills(entry, employeeId)
      const companyMemory = companyMemoryBrief(entry, employeeId)
      const environments = deps.environments(entry)
      return {
        name: entry.company.name,
        key: entry.company.key,
        repos: deps.repos(entry).map((repo) => {
          // Why this repo can get no PR, in the same words the drawer and `#prs` use, or nothing.
          const refusal = deps.pullRequestRefusal(repo.path)
          return refusal ? { ...repo, noPullRequests: refusal } : repo
        }),
        columns: deps.columns(entry),
        autonomy: deps.autonomy(entry),
        roundLimit: deps.roundLimit(entry),
        // The voice the Company keeps between Employees (T180); the boss's side is never a setting.
        ...(colleagueVoice !== undefined && { colleagueVoice }),
        // Read at every spawn (T194), so switching Lean builder off takes at the next Session.
        ...(buildStyle !== undefined && { buildStyle }),
        // The same at every spawn for Caveman (T261).
        ...(caveman !== undefined && { caveman }),
        notesFile: notesLogFile(entry.company.folder, employeeId),
        // An Employee has to know what it was given: a granted server is a tool it can use.
        ...(mcpServers !== undefined && { mcpServers }),
        // And what it was given to read: a skill it was never told about is a folder nobody opens.
        ...(skills !== undefined && { skills }),
        skillsFolder: skillsFolderOf(entry, employeeId),
        notes: deps.notes(entry, employeeId),
        // The bounded brief (T175): the titles of the pages this Employee's repos are likely to
        // need. Titles only, and never the bodies: those are read on demand with `memory_read`.
        ...(companyMemory !== undefined && { companyMemory }),
        answerer: deps.answerer(entry.company.id),
        // What the Company keeps in each environment, by name (T176). Never a value: an Employee is
        // told what exists so it can run the right command and name what is missing.
        ...(environments !== undefined && { environments }),
      }
    },

    handoff(entry, employeeId, move) {
      const employee = employeeIn(entry, employeeId)
      const tickets = deps.tickets(entry)
      const ticket =
        tickets.find((t) => t.assigneeId === employeeId && t.column === 'doing') ??
        tickets.find((t) => t.assigneeId === employeeId && t.column === 'review') ??
        null
      const worktree = ticket ? (deps.worktreesOf(entry, ticket.id)[0] ?? null) : null
      const place = worktree ? (deps.places().find((one) => one.path === worktree.path) ?? null) : null
      let diff: RoutingHandoff['diff'] = null
      if (place) {
        try {
          const changes = deps.changesOf(place.id)
          diff = { paths: changes.files.map((file) => file.path), truncated: changes.truncated }
        } catch (error) {
          deps.log(`Usage limits: could not read ${place.id} for a handoff: ${(error as Error).message}`)
        }
      }
      const people = deps.people(entry)
      const nameOf = (authorId: string) =>
        authorId === BOSS ? entry.company.boss.name : (people.find((p) => p.id === authorId)?.name ?? authorId)
      const reviewThreads = ticket
        ? deps.reviewComments(entry, ticket.id).map((comment) => ({
            file: comment.path,
            line: comment.line,
            author: nameOf(comment.authorId),
            text: comment.body,
          }))
        : []
      const messages = deps
        .recentMessages(entry, employeeId, HANDOFF_MESSAGES)
        .map((message) => ({ author: nameOf(message.authorId), text: message.text }))
      return {
        employee: { name: employee?.name ?? 'this Employee', title: employee?.title ?? '' },
        from: { ...move.from, provider: providerName(move.from.provider) },
        to: { ...move.to, provider: providerName(move.to.provider) },
        reason: move.reason,
        backAt: move.backAt,
        ticket: ticket
          ? { code: ticketCodeIn(entry.db, ticket.id), title: ticket.title, body: ticket.description }
          : null,
        // The plan an Employee writes lives on the ticket, in its subtasks.
        plan:
          ticket && ticket.subtasks.length > 0
            ? ticket.subtasks.map((task) => `- [${task.done ? 'x' : ' '}] ${task.title}`).join('\n')
            : null,
        worktree: worktree ? { path: worktree.path, branch: worktree.branch } : null,
        diff,
        reviewThreads,
        messages,
        notes: deps.notes(entry, employeeId).text,
      }
    },

    handoffPage(entry, employeeId, handoff, move) {
      try {
        const ticket = handoff.ticket
        const title = `${handoff.employee.name} → ${providerName(move.to.provider)}${ticket ? ` · ${ticket.code}` : ''}`
        const body = [
          move.reason === 'out-of-budget'
            ? `${handoff.from.provider} hit its usage limit, so ${handoff.employee.name} carries on on ${handoff.to.provider}.`
            : `${handoff.from.provider} reset, so ${handoff.employee.name} moves back to it from ${handoff.to.provider}.`,
          '',
          '## Where the work stands',
          '',
          ticket ? `On ${ticket.code} — ${ticket.title}.` : 'On no ticket.',
          handoff.worktree
            ? `Worktree \`${handoff.worktree.path}\` on branch \`${handoff.worktree.branch}\`.`
            : 'No worktree.',
          handoff.diff && handoff.diff.paths.length > 0
            ? `Changed so far: ${handoff.diff.paths.slice(0, 10).join(', ')}${handoff.diff.paths.length > 10 ? ', and more' : ''}.`
            : 'Nothing is changed in the worktree yet.',
          '',
          '## What is open',
          '',
          ...(handoff.reviewThreads.length === 0
            ? ['No review thread is waiting.']
            : handoff.reviewThreads.map(
                (thread) =>
                  `- ${thread.file ?? 'the pull request'}${thread.line === null ? '' : `:${thread.line}`} — ${thread.author}`,
              )),
          '',
          '## Next',
          '',
          'Pick up the next unfinished step. Do not start the ticket again.',
        ].join('\n')
        return deps.writeHandoffPage(entry, { title, body, ticketCode: ticket?.code ?? null })
      } catch (error) {
        deps.log(`Memory: could not write ${employeeId}’s handoff page: ${(error as Error).message}`)
        return null
      }
    },
  }
}
