import type { DatabaseSync } from 'node:sqlite'
import type { Approval, GateConditions } from '../../../shared/approvals'
import { COMPANY_AUTHOR } from '../../../shared/domain/chat'
import {
  CAPABILITIES,
  type Capability,
  type Employee,
  matchesRepoFilter,
  type RoleTemplate,
} from '../../../shared/domain/staff'
import {
  type Headcount,
  hireExceedsHeadcount,
  type ProposalPatch,
  type ProposedEmployee,
  type SkillGap,
  type StaffingKind,
  type StaffingOutcome,
  type StaffingRequest,
  type TeamLoad,
} from '../../../shared/hiring'
import { requireKnownModel } from '../../../shared/staff/models'
import { ROLE_TEMPLATES, templateAsRole } from '../../../shared/staff/role-templates'
import type { Migration } from '../../core'
import type { CompanyApprovals } from '../approvals'
import type { Board } from '../board'
import { averageStay } from '../board'
import type { Chat } from '../chat'
import { createRouting, type EmployeeRow, freeDesk, type RoleCatalog, type Staff, toEmployee } from '../staff'
import {
  editProposal,
  hireInput,
  parseProposal,
  parseStoredProposal,
  proposalFromRole,
  readMaxHeadcount,
  type StoredProposal,
  writeMaxHeadcount,
} from './hiring-proposals'

/**
 * The hiring migration step, appended to the engine's migrations. A fired Employee keeps its row
 * (so its messages, approvals and memory file still point somewhere and it can be rehired) with
 * `fired_at` set and a negative desk, which frees the desk it had.
 */
export const HIRING_MIGRATION: Migration = {
  name: 'hiring-fired-employees-and-staffing-requests',
  sql: `
  ALTER TABLE employee ADD COLUMN fired_at TEXT;
  CREATE TABLE staffing_request (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    requester_id TEXT NOT NULL REFERENCES employee (id),
    role_id TEXT REFERENCES role_template (id),
    employee_id TEXT REFERENCES employee (id),
    name TEXT,
    reason TEXT NOT NULL,
    approval_id INTEGER UNIQUE REFERENCES approval (id),
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`,
}

/** One Company's hiring and firing. */
export interface CompanyHiring {
  /**
   * WIP per Employee and per role, unassigned tickets, Todo per repo, blocked tickets, the wait in
   * Review, column limits, headcount and what nobody on the team can do.
   */
  teamLoad(): TeamLoad
  /**
   * An Employee with `hire` proposes hiring from the catalog `role` (id or name). With `name`, the
   * hire gets that name, or a fired Employee of that name comes back. Gated by the autonomy level.
   */
  requestHire(input: {
    requesterId: string
    role: string
    reason: string
    name?: string
    /** A model id from the provider's catalog; left out, the hire runs on the provider's default. */
    model?: string | null
  }): StaffingOutcome
  /** The boss changes the model of a pending hire proposal before deciding it. */
  setRequestModel(requestId: number, model: string | null): StaffingRequest
  /** An Employee with `hire` proposes firing a colleague. Always gated. */
  requestFire(input: { requesterId: string; employeeId: string; reason: string }): StaffingOutcome
  /**
   * The boss fires an Employee: stops its Session, unassigns its open tickets and frees its desk.
   * Its memory file and history stay.
   */
  fire(employeeId: string, reason?: string): Employee
  /** The boss brings a fired Employee back under the same id, at a free desk. */
  rehire(employeeId: string): Employee
  /** Fired Employees, as they were when they left. */
  former(): Employee[]
  /** Hire and fire requests, oldest first. */
  requests(): StaffingRequest[]
  /**
   * The boss edits the Employee a pending new-hire request proposes; approval hires the edited one.
   */
  updateProposal(requestId: number, patch: ProposalPatch): StaffingRequest
  /** A random name nobody in the Company has, fired or proposed, nor any of `exclude` (e.g. a setup draft's). */
  suggestName(exclude?: readonly string[]): string
  headcount(): Headcount
  /**
   * A whole number from 1, or null for unlimited. Under Autonomous, a hire that would go above it
   * asks the boss.
   */
  setMaxHeadcount(max: number | null): Headcount
  /** Carries out, or closes, the request behind a decided Approval. Ignores other Approvals. */
  decided(approval: Approval): void
}

/** The engine's view: the current Company's hiring. */
export type Hiring = Omit<CompanyHiring, 'decided'>

export interface CompanyHiringOptions {
  db: DatabaseSync
  /** This Company's roles and Employees. */
  staff: { roles: RoleCatalog; employees: Staff }
  /** This Company's board, acting as the boss. */
  board: Board
  chat: Chat
  approvals: CompanyApprovals
  /** Starts (or parks) an Employee's Session; may throw, e.g. when no provider is available. */
  startSession(employeeId: string): void
  /** Stops an Employee's Session or takes it out of the parked queue. */
  stopSession(employeeId: string): void
  /** Called after someone is hired, fired or rehired. */
  onChange(): void
  log(line: string): void
}

/** Names handed to new hires: a random one nobody in the Company has. */
const NAMES = [
  'Nova',
  'Iris',
  'Milo',
  'Theo',
  'Luna',
  'Remy',
  'Juno',
  'Otto',
  'Vera',
  'Hugo',
  'Nina',
  'Emil',
  'Cleo',
  'Felix',
  'Maya',
  'Oscar',
  'Zoe',
  'Leon',
  'Ines',
  'Arlo',
  'Ruby',
  'Jonas',
  'Lena',
  'Kai',
  'Sofia',
  'Noah',
  'Alma',
  'Ezra',
  'Wren',
  'Tobias',
]

const CAPABILITY_GAP: Record<Capability, string> = {
  intake: 'Nobody turns the boss’s requests into targets and tickets.',
  plan: 'Nobody splits epics into tickets.',
  code: 'Nobody writes code.',
  review: 'Nobody reviews pull requests, so every PR goes to the boss.',
  test: 'Nobody tests a ticket before it merges, so every test goes to the boss.',
  hire: 'Nobody proposes hires.',
}

export function createCompanyHiring({
  db,
  staff,
  board,
  chat,
  approvals,
  startSession,
  stopSession,
  onChange,
  log,
}: CompanyHiringOptions): CompanyHiring {
  function active(employeeId: string): Employee {
    const found = staff.employees.list().find((e) => e.id === employeeId)
    if (!found) throw new Error(`Unknown Employee: ${employeeId}`)
    return found
  }

  function former(): Employee[] {
    const rows = db
      .prepare('SELECT * FROM employee WHERE fired_at IS NOT NULL ORDER BY fired_at, rowid')
      .all() as unknown as EmployeeRow[]
    return rows.map(toEmployee)
  }

  const routing = createRouting(() => staff.employees.list())
  function hirer(requesterId: string): Employee {
    const requester = active(requesterId)
    routing.require(requesterId, 'hire')
    return requester
  }

  function findRole(role: string): RoleTemplate {
    const wanted = typeof role === 'string' ? role.trim().toLowerCase() : ''
    const found = staff.roles.list().find((r) => r.id === role || r.name.toLowerCase() === wanted)
    if (found) return found
    // A Company holds only the roles it uses (T240), so HR may well ask for a QA nobody has ever
    // been hired as. The built-in answers for it, and the Company takes that one role: the request
    // it is about to file points at a real row, and the boss sees it in the Roles list — marked
    // \"Not used\" for as long as the proposal is unapproved, theirs to remove if they reject it.
    const template = ROLE_TEMPLATES.find((t) => t.id === role || t.name.toLowerCase() === wanted)
    if (!template) throw new Error(`Unknown role: ${String(role)}`)
    const [adopted] = staff.roles.ensure([template.id])
    if (!adopted) throw new Error(`Unknown role: ${String(role)}`)
    return adopted
  }

  function requireReason(reason: unknown): string {
    const why = typeof reason === 'string' ? reason.trim() : ''
    if (!why) throw new Error('A hire or fire request needs a reason')
    return why
  }

  function request(id: number): StaffingRequest {
    return toRequest(db.prepare('SELECT * FROM staffing_request WHERE id = ?').get(id) as unknown as RequestRow)
  }

  function file(input: {
    kind: StaffingKind
    requesterId: string
    roleId: string | null
    employeeId: string | null
    name: string | null
    reason: string
    proposal: StoredProposal | null
    model: string | null
    approvalId: number | null
  }): StaffingRequest {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO staffing_request
           (kind, requester_id, role_id, employee_id, name, reason, proposal, model, approval_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        input.kind,
        input.requesterId,
        input.roleId,
        input.employeeId,
        input.name,
        input.reason,
        input.proposal && JSON.stringify(input.proposal),
        input.model,
        input.approvalId,
        new Date().toISOString(),
      )
    return request(Number(lastInsertRowid))
  }

  function close(id: number, status: StaffingRequest['status'], employeeId?: string): StaffingRequest {
    db.prepare('UPDATE staffing_request SET status = ?, employee_id = COALESCE(?, employee_id) WHERE id = ?').run(
      status,
      employeeId ?? null,
      id,
    )
    return request(id)
  }

  function start(employee: Employee): void {
    try {
      startSession(employee.id)
    } catch (error) {
      log(`Hiring: ${employee.name} was hired but their Session did not start: ${(error as Error).message}`)
    }
  }

  /** Names of everyone who works or worked here, and of pending proposals. */
  function takenNames(): Set<string> {
    const proposed = (
      db.prepare(`SELECT proposal FROM staffing_request WHERE status = 'pending'`).all() as {
        proposal: string | null
      }[]
    ).flatMap((r) => parseProposal(r.proposal)?.name ?? [])
    const names = (db.prepare('SELECT name FROM employee').all() as { name: string }[]).map((r) => r.name)
    return new Set([...names, ...proposed].map((n) => n.toLowerCase()))
  }

  function generatedName(exclude: readonly string[] = []): string {
    const taken = takenNames()
    for (const name of exclude) taken.add(name.trim().toLowerCase())
    const free = NAMES.filter((n) => !taken.has(n.toLowerCase()))
    if (free.length > 0) return free[Math.floor(Math.random() * free.length)]!
    for (let n = 2; ; n++) {
      const name = `${NAMES[n % NAMES.length]} ${n}`
      if (!taken.has(name.toLowerCase())) return name
    }
  }

  function hireNew(req: StaffingRequest): Employee {
    const row = db.prepare('SELECT proposal FROM staffing_request WHERE id = ?').get(req.id) as {
      proposal: string | null
    }
    const proposal = parseStoredProposal(row.proposal)
    const employee = staff.employees.create({
      ...(proposal ? hireInput(proposal) : { name: req.name ?? generatedName(), roleId: req.roleId! }),
      model: req.model,
    })
    onChange()
    chat.post({
      authorId: employee.id,
      channelId: 'general',
      text: `Hi team! I’m ${employee.name}, the new ${employee.title}. Glad to be here; mention me when you need a hand.`,
    })
    start(employee)
    return employee
  }

  function bringBack(employeeId: string, model: string | null = null): Employee {
    const gone = former().find((e) => e.id === employeeId)
    if (!gone) throw new Error(`Unknown former Employee: ${employeeId}`)
    db.prepare('UPDATE employee SET fired_at = NULL, desk = ? WHERE id = ?').run(freeDesk(db), employeeId)
    if (model !== null) staff.employees.update(employeeId, { model })
    const employee = active(employeeId)
    onChange()
    chat.post({
      authorId: employee.id,
      channelId: 'general',
      text: `Hi team, ${employee.name} here again, back as ${employee.title}. Good to see you all.`,
    })
    start(employee)
    return employee
  }

  function fireNow(employeeId: string, reason: string): Employee {
    const employee = active(employeeId)
    stopSession(employeeId)
    for (const ticket of board.snapshot().tickets) {
      if (ticket.assigneeId === employeeId && ticket.column !== 'done') {
        board.updateTicket(ticket.id, { assigneeId: null })
      }
    }
    db.prepare('UPDATE employee SET fired_at = ?, desk = -rowid WHERE id = ?').run(new Date().toISOString(), employeeId)
    onChange()
    chat.post({
      authorId: COMPANY_AUTHOR,
      channelId: 'general',
      text:
        `${employee.name} (${employee.title}) has left the company${reason ? `: ${reason}` : '.'} ` +
        'Their open tickets are unassigned. Their memory is kept, so they can be rehired.',
    })
    return employee
  }

  function carryOut(req: StaffingRequest): Employee {
    if (req.kind === 'fire') return fireNow(req.employeeId!, req.reason)
    if (req.employeeId) return bringBack(req.employeeId, req.model)
    return hireNew(req)
  }

  function headcount(): Headcount {
    return { current: staff.employees.list().length, max: readMaxHeadcount(db) }
  }

  function submit(
    req: Parameters<typeof file>[0],
    action: 'hire' | 'fire',
    subject: string,
    conditions?: GateConditions,
  ): StaffingOutcome {
    const outcome = approvals.request({
      requesterId: req.requesterId,
      action,
      subject,
      reason: req.reason,
      ...(conditions !== undefined && { conditions }),
    })
    if (outcome.gate === 'ask') {
      const filed = file({ ...req, approvalId: outcome.approval.id })
      return { status: 'pending', request: filed, approvalId: outcome.approval.id }
    }
    const filed = file(req)
    const employee = carryOut(filed)
    return { status: 'done', request: close(filed.id, 'done', employee.id), employee }
  }

  return {
    teamLoad() {
      const employees = staff.employees.list()
      const roles = staff.roles.list()
      const { tickets, columns } = board.snapshot()
      const repos = db.prepare('SELECT id, name FROM repo ORDER BY added_at, rowid').all() as {
        id: string
        name: string
      }[]
      const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? id
      const open = tickets.filter((t) => t.column !== 'done')
      const todo = new Map<string, number>()
      for (const ticket of tickets) {
        if (ticket.column !== 'todo') continue
        for (const repo of ticket.repos) todo.set(repoName(repo), (todo.get(repoName(repo)) ?? 0) + 1)
      }

      // A gap names who would close it, so it looks past the Company's own roles to the built-ins
      // it has not taken yet (T240): "nobody reviews" is only useful beside "QA would". The order
      // is the catalogue's, then the roles the boss wrote, so the suggestion reads the same however
      // much of the catalogue this Company happens to hold.
      const byId = new Map(roles.map((role) => [role.id, role]))
      const hireable = [
        ...ROLE_TEMPLATES.map((template) => byId.get(template.id) ?? templateAsRole(template)),
        ...roles.filter((role) => !ROLE_TEMPLATES.some((template) => template.id === role.id)),
      ]

      const skillGaps: SkillGap[] = []
      for (const capability of CAPABILITIES) {
        if (employees.some((e) => e.capabilities.includes(capability))) continue
        // Decision 41: the answerer chain covers intake, so a planner answering the boss is no gap.
        if (capability === 'intake' && employees.some((e) => e.capabilities.includes('plan'))) continue
        skillGaps.push({
          kind: 'capability',
          capability,
          detail: CAPABILITY_GAP[capability],
          roles: hireable.filter((r) => r.capabilities.includes(capability)).map((r) => r.name),
        })
      }
      const codes = (who: { capabilities: Capability[]; repoFilter: string[] }, repo: string) =>
        who.capabilities.includes('code') && matchesRepoFilter(who.repoFilter, repo)
      for (const repo of repos) {
        if (employees.some((e) => codes(e, repo.name))) continue
        const waiting = open.filter((t) => t.repos.includes(repo.id)).length
        skillGaps.push({
          kind: 'repo',
          repo: repo.name,
          detail: `Nobody who codes works in ${repo.name}; ${waiting} open ticket(s) touch it.`,
          roles: hireable.filter((r) => codes(r, repo.name)).map((r) => r.name),
        })
      }

      return {
        employees: employees.map((e) => {
          const held = open.filter((t) => t.assigneeId === e.id)
          return {
            id: e.id,
            name: e.name,
            title: e.title,
            capabilities: e.capabilities,
            repoFilter: e.repoFilter,
            wip: held.length,
            tickets: held.map((t) => ({ id: t.id, title: t.title, column: t.column, blocked: t.blocked })),
          }
        }),
        unassigned: open
          .filter((t) => t.assigneeId === null)
          .map((t) => ({ id: t.id, title: t.title, column: t.column, repos: t.repos.map(repoName) })),
        columns: columns.map(({ id, wipLimit, count, overLimit }) => ({ id, wipLimit, count, overLimit })),
        skillGaps,
        // What a hire could be made into, not only what the Company already holds (T240): the same
        // list the skill gaps name, so HR can act on the gap it was just told about.
        roles: hireable.map(({ id, name, capabilities, repoFilter }) => ({ id, name, capabilities, repoFilter })),
        roleLoad: roles.map((role) => {
          const onRole = new Set(employees.filter((e) => e.roleId === role.id).map((e) => e.id))
          return {
            roleId: role.id,
            name: role.name,
            employees: onRole.size,
            wip: open.filter((t) => t.assigneeId !== null && onRole.has(t.assigneeId)).length,
          }
        }),
        todoByRepo: [...todo]
          .map(([repo, count]) => ({ repo, count }))
          .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo)),
        blocked: open.filter((t) => t.blocked).length,
        review: averageStay(db, 'review'),
        headcount: headcount(),
      }
    },

    requestHire({ requesterId, role: roleInput, reason, name, model = null }) {
      hirer(requesterId)
      const role = findRole(roleInput)
      const why = requireReason(reason)
      const proposedModel = requireKnownModel(model)
      const wanted = typeof name === 'string' ? name.trim().replace(/^@/, '') : ''
      if (wanted && staff.employees.list().some((e) => e.name.toLowerCase() === wanted.toLowerCase())) {
        throw new Error(`${wanted} already works here`)
      }
      const back = wanted ? former().find((e) => e.name.toLowerCase() === wanted.toLowerCase()) : undefined
      const proposal = back ? null : proposalFromRole(role, wanted || generatedName())
      const subject = back ? `rehire ${back.name} (${back.title})` : `a new ${role.name} named ${proposal!.name}`
      return submit(
        {
          kind: 'hire',
          requesterId,
          roleId: back ? back.roleId : role.id,
          employeeId: back?.id ?? null,
          name: back ? null : wanted || null,
          reason: why,
          proposal,
          model: proposedModel,
          approvalId: null,
        },
        'hire',
        subject,
        { aboveHeadcount: hireExceedsHeadcount(headcount()) },
      )
    },

    requestFire({ requesterId, employeeId, reason }) {
      hirer(requesterId)
      const target = active(employeeId)
      if (target.id === requesterId) throw new Error('You cannot fire yourself')
      const why = requireReason(reason)
      return submit(
        {
          kind: 'fire',
          requesterId,
          roleId: null,
          employeeId,
          name: null,
          reason: why,
          proposal: null,
          model: null,
          approvalId: null,
        },
        'fire',
        `${target.name} (${target.title})`,
      )
    },

    setRequestModel(requestId, model) {
      const row = db.prepare('SELECT * FROM staffing_request WHERE id = ?').get(requestId) as RequestRow | undefined
      if (!row || row.kind !== 'hire') throw new Error(`Unknown hire proposal: ${requestId}`)
      if (row.status !== 'pending') throw new Error('Only a pending hire proposal can be changed')
      db.prepare('UPDATE staffing_request SET model = ? WHERE id = ?').run(requireKnownModel(model), requestId)
      onChange()
      return request(requestId)
    },

    fire(employeeId, reason = '') {
      return fireNow(employeeId, typeof reason === 'string' ? reason.trim() : '')
    },

    rehire: (employeeId) => bringBack(employeeId),

    former,

    requests() {
      const rows = db.prepare('SELECT * FROM staffing_request ORDER BY id').all() as unknown as RequestRow[]
      return rows.map(toRequest)
    },

    updateProposal(requestId, patch) {
      const row = db.prepare('SELECT * FROM staffing_request WHERE id = ?').get(requestId) as RequestRow | undefined
      if (!row) throw new Error(`There is no hire request ${String(requestId)}`)
      const current = toRequest(row)
      const stored = parseStoredProposal(row.proposal)
      if (current.kind !== 'hire' || !stored) throw new Error('Only a new-hire proposal can be edited')
      if (current.status !== 'pending') throw new Error(`Hire request ${current.id} is already ${current.status}`)
      // Moving a proposal onto a built-in the Company has not taken yet takes it, the way every
      // other role change does (T240), so the request it rewrites points at a role that is there.
      if (patch.roleId !== undefined) findRole(patch.roleId)
      const taken = takenNames()
      const next = editProposal({ ...stored, model: current.model }, patch, {
        roles: staff.roles.list(),
        nameTaken: (name) => taken.has(name.toLowerCase()),
      })
      const model = requireKnownModel(next.model)
      db.prepare('UPDATE staffing_request SET proposal = ?, role_id = ?, model = ? WHERE id = ?').run(
        JSON.stringify({ ...next, model }),
        next.roleId,
        model,
        current.id,
      )
      onChange()
      return request(current.id)
    },

    suggestName: (exclude) => generatedName(exclude),

    headcount,

    setMaxHeadcount(max) {
      writeMaxHeadcount(db, max)
      onChange()
      return headcount()
    },

    decided(approval) {
      const row = db.prepare('SELECT * FROM staffing_request WHERE approval_id = ?').get(approval.id) as
        | RequestRow
        | undefined
      if (!row || row.status !== 'pending') return
      if (approval.status === 'rejected') return void close(row.id, 'rejected')
      if (approval.status !== 'approved') return
      try {
        close(row.id, 'done', carryOut(toRequest(row)).id)
      } catch (error) {
        log(`Hiring: approved ${row.kind} request ${row.id} could not be carried out: ${(error as Error).message}`)
        close(row.id, 'failed')
      }
    },
  }
}

interface RequestRow {
  id: number
  kind: StaffingKind
  requester_id: string
  role_id: string | null
  employee_id: string | null
  name: string | null
  reason: string
  proposal: string | null
  model: string | null
  approval_id: number | null
  status: StaffingRequest['status']
  created_at: string
}

/** The model column is the one source of a proposal's model (`setRequestModel` writes it too). */
function withModel(proposal: ProposedEmployee | null, model: string | null): ProposedEmployee | null {
  return proposal && { ...proposal, model }
}

function toRequest(row: RequestRow): StaffingRequest {
  return {
    id: row.id,
    kind: row.kind,
    requesterId: row.requester_id,
    roleId: row.role_id,
    employeeId: row.employee_id,
    name: row.name,
    reason: row.reason,
    proposal: withModel(parseProposal(row.proposal), row.model ?? null),
    model: row.model ?? null,
    approvalId: row.approval_id,
    status: row.status,
    createdAt: row.created_at,
  }
}
