import { invokeSkill, providerEntry } from '../../../shared/domain/providers'
import type { CompanyContext, OpenCompany } from '../../core'
import type { SecretStore } from '../../platform'
import { createMcpCatalogue, employeeGrants, grantedServers, grantSummaries, type McpCatalogue } from './mcp-servers'
import { syncWorktreeSkills, type WorktreeSkillsOptions } from './skill-worktrees'
import {
  createSkillCatalogue,
  employeeSkillGrants,
  type SkillCatalogue,
  type SkillCatalogueOptions,
  skillSummaries,
} from './skills'

/**
 * What the catalogues reach for. Every one of them is about a Company other than itself: who is on
 * the staff, which worktrees exist, and whether a folder is still on this Mac.
 */
export interface CatalogueDeps {
  /** Where a server's token is kept: the OS store, never the Company folder. */
  secrets: SecretStore
  log(line: string): void
  /** A grant changed, so the Employees view and the hire form redraw with the same list. */
  notify(): void
  /**
   * The roster changed in the current Company. A role edit hands its skills to everyone hired into
   * it, so a staff change is a grant change and the worktrees are reconciled with it (T137).
   */
  onStaffChange(listener: () => void): () => void
  /** Whether a skill folder is on this Mac. Injected so the engine's tests never need one. */
  folderExists: NonNullable<SkillCatalogueOptions['exists']>
  /** That Company's ticket worktrees, which is what a granted folder is linked into. */
  code(entry: OpenCompany): { list(): { worktrees: ReturnType<WorktreeSkillsOptions['worktrees']> }[] }
  /** That Company's board and roster, to find who is on a ticket now. */
  board(entry: OpenCompany): { snapshot(): { tickets: { id: number; assigneeId: string | null }[] } }
  staff(entry: OpenCompany): { employees: { list(): NonNullable<ReturnType<WorktreeSkillsOptions['assignee']>>[] } }
  /** Every Provider's adapter; the ones that install no skills are skipped. */
  providers: WorktreeSkillsOptions['adapters']
}

/** The catalogue feature, once it is wired. */
export interface CatalogueFeature {
  facade: McpFacade & SkillsFacade
  /**
   * The outside MCP servers this Employee holds, with their secrets read from the OS store at this
   * moment and held nowhere else (T136). Every Session spawn asks once, and nothing else may.
   */
  grantsFor(entry: OpenCompany, employeeId: string): ReturnType<typeof grantedServers>
  /** The same servers as a brief lists them: name and purpose, never a value. */
  serverSummaries(entry: OpenCompany, employeeId: string): ReturnType<typeof grantSummaries>
  /** The skill folders it holds, as a brief lists them; one that has moved is left out. */
  skillsFor(entry: OpenCompany, employeeId: string): ReturnType<typeof skillSummaries>
  /**
   * `prompt` as the message that invokes the skill called `name` on this Employee's Provider
   * (T264), or null when the Employee holds no skill by that name or its folder is missing — a
   * skill that is not in the worktree cannot be run, and the message goes as it was written.
   */
  invokeSkill(entry: OpenCompany, employeeId: string, name: string, prompt: string): string | null
  /**
   * Puts each Employee's granted skill folders in the worktrees it works in, and takes away the
   * ones it no longer holds. Run after a worktree is created, after the catalogue changes and
   * after the staff changes — a role edit hands a skill to everyone in it.
   */
  syncWorktrees(): void
}

/**
 * Wires the Company's MCP servers and its skill folders (T136, T137, T186).
 *
 * The two are one feature because they are the same shape and change the same thing: a table the
 * boss keeps, a grant per Employee and per role, and a notification that the staff redraw from.
 *
 */
export function register(ctx: CompanyContext, deps: CatalogueDeps): CatalogueFeature {
  const mcp = createMcpCatalogue({
    current: () => {
      const entry = ctx.currentEntry()
      return { db: entry.db, companyId: entry.company.id }
    },
    secrets: deps.secrets,
    notify: deps.notify,
  })

  const skills = createSkillCatalogue({
    current: () => ({ db: ctx.currentEntry().db }),
    notify: deps.notify,
    exists: deps.folderExists,
  })

  function syncWorktrees(): void {
    // A reconcile with nothing open is not an error: it is the app before the first Company.
    const entry = ctx.currentOrNull()
    if (!entry) return
    try {
      syncWorktreeSkills({
        db: entry.db,
        worktrees: () =>
          deps
            .code(entry)
            .list()
            .flatMap((code) => code.worktrees),
        assignee(ticketId) {
          const ticket = deps
            .board(entry)
            .snapshot()
            .tickets.find((row) => row.id === ticketId)
          return (
            deps
              .staff(entry)
              .employees.list()
              .find((employee) => employee.id === ticket?.assigneeId) ?? null
          )
        },
        adapters: deps.providers,
        exists: deps.folderExists,
        log: deps.log,
      })
    } catch (error) {
      // A worktree that refuses its skills must never stop the board.
      deps.log(`Skills: could not follow a change: ${(error as Error).message}`)
    }
  }

  skills.onChange(syncWorktrees)
  deps.onStaffChange(syncWorktrees)

  return {
    facade: { mcp, skills },
    syncWorktrees,
    grantsFor: (entry, employeeId) =>
      grantedServers(entry.db, entry.company.id, employeeGrants(entry.db, employeeId), deps.secrets),
    serverSummaries: (entry, employeeId) => grantSummaries(entry.db, employeeGrants(entry.db, employeeId)),
    skillsFor: (entry, employeeId) =>
      skillSummaries(entry.db, employeeSkillGrants(entry.db, employeeId), deps.folderExists),
    invokeSkill(entry, employeeId, name, prompt) {
      const held = skillSummaries(entry.db, employeeSkillGrants(entry.db, employeeId), deps.folderExists)
      if (!held.some((skill) => skill.name === name && !skill.missing)) return null
      const employee = deps
        .staff(entry)
        .employees.list()
        .find((row) => row.id === employeeId)
      return employee ? invokeSkill(providerEntry(employee.provider), name, prompt) : null
    },
  }
}

/** Company settings → MCP servers (T136). */
export interface McpFacade {
  mcp: McpCatalogue
}

/** Company settings → Skills (T137). */
export interface SkillsFacade {
  skills: SkillCatalogue
}
