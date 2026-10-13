import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'

/**
 * The Company's skill catalogue, the grant that follows the role, and what reaches a worktree
 * (T137).
 *
 * Nothing here opens a skill folder: which folders are on this Mac is injected, because a skill is
 * a path the boss picked and TinyCorp never reads, parses or runs what is in it.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

/** The folders this Mac has. `~/skills/gone` is in none of them: the boss moved it. */
const ON_DISK = [onDisk('/boss/skills/review-checklist'), onDisk('/boss/skills/deploy-runbook'), onDisk('/work/acme')]

function company({
  provider = fakeProvider(),
  folders = ON_DISK,
}: {
  provider?: FakeProvider
  folders?: string[]
} = {}) {
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git,
    mcpUrl: () => 'http://127.0.0.1:7377/mcp',
    log: () => {},
    // Every worktree the fake git makes is a folder as far as the catalogue is concerned.
    folderExists: (path) => folders.includes(path) || path.startsWith(onDisk('/work/acme/worktrees/')),
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, git, provider }
}

function checklist(engine: CompanyEngine, over: Partial<{ name: string; path: string }> = {}) {
  return engine.skills.create({ name: 'review-checklist', path: onDisk('/boss/skills/review-checklist'), ...over })
}

describe('The Company’s skill catalogue', () => {
  it('holds the folder the boss picked, and never copies it in', () => {
    const { engine } = company()

    const skill = checklist(engine)

    expect(engine.skills.list()).toEqual([
      {
        id: skill.id,
        name: 'review-checklist',
        path: onDisk('/boss/skills/review-checklist'),
        missing: false,
        employees: 0,
      },
    ])
  })

  it('refuses a second skill under the same name, and a name that is not a folder name', () => {
    const { engine } = company()
    checklist(engine)

    expect(() => checklist(engine, { path: onDisk('/boss/skills/deploy-runbook') })).toThrow(/already has a skill/i)
    expect(() =>
      engine.skills.create({ name: 'Review Checklist', path: onDisk('/boss/skills/deploy-runbook') }),
    ).toThrow(/lower case/i)
    expect(() => engine.skills.create({ name: 'x', path: 'skills/relative' })).toThrow(/absolute/i)
  })

  it('says on the row when the folder has moved, without touching the grant', () => {
    const { engine } = company()
    const skill = checklist(engine, { name: 'pen-handoff', path: onDisk('/boss/skills/pen-handoff') })
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { skills: [skill.id] })
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })

    expect(engine.skills.list()[0]!.missing).toBe(true)
    expect(ada.skills, 'a folder that moved is still granted — the boss may be about to put it back').toEqual([
      skill.id,
    ])
  })

  it('counts the Employees holding a skill, and forgets a fired one', () => {
    const { engine } = company()
    const skill = checklist(engine)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [skill.id] })
    engine.employees.create({ name: 'Grace', roleId: 'backend', skills: [skill.id] })

    expect(engine.skills.list()[0]!.employees).toBe(2)

    engine.hiring.fire(ada.id, 'done')

    expect(engine.skills.list()[0]!.employees).toBe(1)
  })
})

describe('A skill grant', () => {
  it('follows the role: everyone hired into it holds the role’s skills', () => {
    const { engine } = company()
    const skill = checklist(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { skills: [skill.id] })

    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })

    expect(ada.skills).toEqual([skill.id])
    expect(ada.overrides).not.toContain('skills')
  })

  it('is overridable per Employee, and a role edit leaves the override alone', () => {
    const { engine } = company()
    const checks = checklist(engine)
    const runbook = engine.skills.create({ name: 'deploy-runbook', path: onDisk('/boss/skills/deploy-runbook') })
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { skills: [checks.id] })
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })

    const overridden = engine.employees.update(ada.id, { skills: [runbook.id] })
    engine.roles.update(role.id, { skills: [] })

    expect(overridden.overrides).toContain('skills')
    expect(engine.employees.list().find((e) => e.id === ada.id)!.skills).toEqual([runbook.id])
  })

  it('follows the role again once the Employee gives the field back', () => {
    const { engine } = company()
    const checks = checklist(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id, skills: [checks.id] })

    engine.employees.update(ada.id, { followRole: ['skills'] })
    engine.roles.update(role.id, { skills: [checks.id] })

    const following = engine.employees.list().find((e) => e.id === ada.id)!
    expect(following.skills).toEqual([checks.id])
    expect(following.overrides).not.toContain('skills')
  })

  it('refuses a skill the Company’s catalogue does not hold', () => {
    const { engine } = company()

    expect(() => engine.employees.create({ name: 'Ada', roleId: 'backend', skills: ['nope'] })).toThrow(
      /unknown skill/i,
    )
  })

  it('goes off every Employee and every role when the skill leaves the catalogue', () => {
    const { engine } = company()
    const skill = checklist(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { skills: [skill.id] })
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })

    expect(engine.skills.impact(skill.id)).toEqual({ name: 'review-checklist', employees: 1, roles: 1 })

    engine.skills.remove(skill.id)

    expect(engine.employees.list().find((e) => e.id === ada.id)!.skills).toEqual([])
    expect(engine.roles.list().find((r) => r.id === role.id)!.skills).toEqual([])
  })
})

describe('An Employee’s worktree', () => {
  /** A ticket in Doing for `employeeId`, which is what gives it a worktree. */
  function worktreeFor(engine: CompanyEngine, employeeId: string): string {
    const repo = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: node })
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: employeeId, repos: [repo.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    return engine.code.of(ticket.id).worktrees[0]!.path
  }

  it('gets the skills its Employee holds, and not the ones it does not', () => {
    const { engine, provider } = company()
    const checks = checklist(engine)
    engine.skills.create({ name: 'deploy-runbook', path: onDisk('/boss/skills/deploy-runbook') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [checks.id] })

    const worktree = worktreeFor(engine, ada.id)

    expect(provider.skillsIn(worktree)).toEqual(['review-checklist'])
  })

  it('loses a skill the boss takes off the Employee', () => {
    const { engine, provider } = company()
    const checks = checklist(engine)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [checks.id] })
    const worktree = worktreeFor(engine, ada.id)

    engine.employees.update(ada.id, { skills: [] })

    expect(provider.skillsIn(worktree)).toEqual([])
  })

  it('loses a skill the boss takes off the catalogue', () => {
    const { engine, provider } = company()
    const checks = checklist(engine)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [checks.id] })
    const worktree = worktreeFor(engine, ada.id)

    engine.skills.remove(checks.id)

    expect(provider.skillsIn(worktree)).toEqual([])
  })

  it('starts without a folder that has moved, and says nothing is there', () => {
    const { engine, provider } = company()
    const gone = checklist(engine, { name: 'pen-handoff', path: onDisk('/boss/skills/pen-handoff') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [gone.id] })

    const worktree = worktreeFor(engine, ada.id)

    expect(provider.skillInstalls.at(-1)!.skills.map((skill) => skill.missing)).toEqual([true])
    expect(provider.skillsIn(worktree)).toEqual([])
  })

  it('puts nothing anywhere for a Provider whose product reads no skills', () => {
    const provider = fakeProvider({ skills: false })
    const { engine } = company({ provider })
    const checks = checklist(engine)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [checks.id] })

    worktreeFor(engine, ada.id)

    expect(provider.installSkills, 'a Provider that reads no skills implements none').toBeUndefined()
    expect(provider.skillInstalls).toEqual([])
  })
})

describe('An Employee’s instructions', () => {
  it('name the skills it holds and where they are, so it knows to open them', () => {
    const { engine, provider } = company()
    const checks = checklist(engine)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [checks.id] })

    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## Your skills')
    expect(text).toContain('`review-checklist`: `.claude/skills/review-checklist/`')
  })

  it('say a granted folder is not on this Mac rather than sending it looking', () => {
    const { engine, provider } = company()
    const gone = checklist(engine, { name: 'pen-handoff', path: onDisk('/boss/skills/pen-handoff') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', skills: [gone.id] })

    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions!.text).toContain('the folder is not on this machine any more')
  })

  it('say nothing at all about skills to an Employee that holds none', () => {
    const { engine, provider } = company()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions!.text).not.toContain('## Your skills')
  })
})
