import { afterEach, describe, expect, it } from 'vitest'
import { intakeHolder } from '../../../shared/domain/staff'
import {
  addRoleLabel,
  addSeat,
  draftNames,
  employeeCount,
  officePlan,
  removeSeat,
  roleLine,
  rosterFromPreset,
  rosterHires,
  seatNameError,
  shortModelLabel,
  updateSeat,
  wizardCatalog,
} from '../../../shared/staff/roster-draft'
import { presetModel, teamPreset } from '../../../shared/staff/team-presets'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function newCompany() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: fakeProvider() },
    isGitRepo: () => true,
    log: () => {},
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/tiny'), name: 'Tiny Corp' })
  return engine
}

function planFor(engine: CompanyEngine, draft: ReturnType<typeof rosterFromPreset>) {
  return officePlan({
    draft,
    headcount: engine.hiring.headcount(),
    catalog: wizardCatalog(engine.roles.list()),
    repos: engine.repos.list().map((repo) => repo.name),
  })
}

describe('the Your team roster draft', () => {
  it('starts from the preset: names, roles, personas, the preset model', () => {
    const draft = rosterFromPreset(teamPreset('product-squad'), 'claude')

    expect(draft.map((seat) => [seat.name, seat.role, seat.model])).toEqual([
      ['Hera', 'PM', presetModel('claude')],
      ['Orion', 'Tech Lead', presetModel('claude')],
      ['Ada', 'Frontend', presetModel('claude')],
      ['Vega', 'Backend', presetModel('claude')],
    ])
    expect(draft[0]!.persona).toBe('Breaks the goal into tickets and keeps the board honest.')
    expect(shortModelLabel(draft[0]!.model)).toBe('Opus 5.5')
    // Your team previews the character each seat walks in on, so it hands out one per seat.
    expect(draft.map((seat) => seat.sprite)).toEqual([0, 1, 2, 3])
    expect(employeeCount(draft.length)).toBe('Four employees')
    expect(employeeCount(1)).toBe('One employee')
  })

  it('persists nothing while it is edited', () => {
    const engine = newCompany()
    let draft = rosterFromPreset(teamPreset('product-squad'), 'claude')
    draft = updateSeat(draft, draft[0]!.key, { name: 'Hestia', model: 'sonnet-5-fast' })
    draft = removeSeat(draft, draft[3]!.key)
    const qa = engine.roles.ensure(['qa'])[0]!
    draft = addSeat(draft, qa, engine.hiring.suggestName(draftNames(draft)), 'claude')

    expect(draft.map((seat) => seat.role)).toEqual(['PM', 'Tech Lead', 'Frontend', 'QA'])
    expect(engine.employees.list()).toEqual([])
    expect(engine.hiring.headcount().current).toBe(0)
  })

  it('suggests names nobody in the draft or the Company has', () => {
    const engine = newCompany()
    const draft = rosterFromPreset(teamPreset('full-studio'), 'claude')
    engine.employees.create({ name: 'Nova', roleId: 'qa' })

    for (let i = 0; i < 30; i++) {
      const name = engine.hiring.suggestName(draftNames(draft))
      expect([...draftNames(draft), 'Nova']).not.toContain(name)
    }
  })

  it('refuses a blank name or one another seat has', () => {
    const draft = rosterFromPreset(teamPreset('product-squad'), 'claude')

    expect(seatNameError(draft, draft[0]!.key, 'Hera')).toBeNull()
    expect(seatNameError(draft, draft[0]!.key, '  ')).toBe('A name is required')
    expect(seatNameError(draft, draft[0]!.key, 'orion ')).toBe('Someone on the team already has this name')
  })

  it('names the catalog roles the draft is missing on Add another role', () => {
    const catalog = wizardCatalog(newCompany().roles.list())

    expect(addRoleLabel(rosterFromPreset(teamPreset('product-squad'), 'claude'), catalog)).toMatch(
      /^Add another role — QA, DevOps, HR, PO/,
    )
    expect(addRoleLabel(rosterFromPreset(teamPreset('full-studio'), 'claude'), catalog)).not.toContain('QA')
    expect(addRoleLabel(rosterFromPreset(teamPreset('product-squad'), 'claude'), [])).toBe('Add another role')
  })

  it('adds a seat per catalog role with a key of its own, even after a removal', () => {
    const catalog = wizardCatalog(newCompany().roles.list())
    const qa = catalog.find((role) => role.id === 'qa')!
    let draft = addSeat([], qa, 'Iris', 'claude')
    draft = addSeat(draft, qa, 'Nova', 'claude')
    draft = removeSeat(draft, draft[0]!.key)
    draft = addSeat(draft, qa, 'Milo', 'claude')

    expect(new Set(draft.map((seat) => seat.key)).size).toBe(2)
    expect(draft[1]).toMatchObject({ roleId: 'qa', role: 'QA', name: 'Milo' })
    expect(draft[1]!.persona).toBe('Tries to break every PR against its acceptance criteria.')
  })

  it('shows a custom role by the first sentence of its persona', () => {
    const engine = newCompany()
    const designer = engine.roles.create({
      name: 'Designer',
      persona: 'You draw the screens. You also review UI PRs.',
      capabilities: ['code'],
      repoFilter: [],
      areas: [],
      mcpServers: [],
      skills: [],
    })

    expect(roleLine(designer)).toBe('You draw the screens.')
    expect(addSeat([], designer, 'Nova', 'claude')[0]!.persona).toBe('You draw the screens.')
  })

  it('hires the edited draft on Finish, with the plan’s intake holder welcoming the team', () => {
    const engine = newCompany()
    let draft = rosterFromPreset(teamPreset('product-squad'), 'claude')
    draft = updateSeat(draft, draft[0]!.key, { name: ' Hestia ', model: 'fable-5-1-deep' })
    draft = removeSeat(draft, draft[2]!.key)
    const plan = planFor(engine, draft)

    for (const hire of rosterHires(draft)) engine.employees.create(hire)
    const staff = engine.employees.list()

    expect(staff.map((employee) => [employee.name, employee.title, employee.model])).toEqual([
      ['Hestia', 'PM', 'fable-5-1-deep'],
      ['Orion', 'Tech Lead', presetModel('claude')],
      ['Vega', 'Backend', presetModel('claude')],
    ])
    expect(staff.map((employee) => employee.sprite)).toEqual(draft.map((seat) => seat.sprite))
    expect(staff[0]!.persona).toBe(engine.roles.ensure(['pm'])[0]!.persona)
    expect(plan.next[1]!.text).toBe(`${intakeHolder(staff)!.name} opens #general and introduces the team.`)
  })

  it('shows desks against the maximum headcount, the first repo and what happens next', () => {
    const engine = newCompany()
    engine.hiring.setMaxHeadcount(12)
    engine.repos.add({ path: onDisk('/code/web-app'), name: 'web-app', stack: readyStack() })
    engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })

    expect(planFor(engine, rosterFromPreset(teamPreset('product-squad'), 'claude'))).toEqual({
      desksTaken: '4 of 12',
      desksFill: 4 / 12,
      overHeadcount: false,
      repository: 'web-app',
      next: [
        { icon: 'desks', text: 'Four desks appear in the office, one sprite each.' },
        { icon: 'general', text: 'Hera opens #general and introduces the team.' },
        { icon: 'ticket', text: 'Your first ticket lands in Todo and work starts.' },
      ],
    })
  })

  it('counts Employees already on staff, flags a draft over the maximum, and reads without one', () => {
    const engine = newCompany()
    engine.employees.create({ name: 'Nova', roleId: 'qa' })
    engine.hiring.setMaxHeadcount(5)
    const studio = planFor(engine, rosterFromPreset(teamPreset('full-studio'), 'claude'))

    expect(studio).toMatchObject({ desksTaken: '9 of 5', desksFill: 1, overHeadcount: true, repository: 'None yet' })

    engine.hiring.setMaxHeadcount(null)
    expect(planFor(engine, rosterFromPreset(teamPreset('solo-builder'), 'claude'))).toMatchObject({
      desksTaken: '2',
      desksFill: null,
      overHeadcount: false,
      next: [
        { text: 'One desk appears in the office, with its sprite.' },
        { text: 'Orion opens #general and introduces the team.' },
        {},
      ],
    })
  })

  it('says who welcomes the team when nobody holds intake, or nobody is left', () => {
    const engine = newCompany()
    const squad = rosterFromPreset(teamPreset('product-squad'), 'claude')
    const noPm = removeSeat(squad, squad[0]!.key)

    expect(planFor(engine, noPm).next[1]!.text).toBe('Nobody takes intake yet, so your goal waits in #general.')
    expect(planFor(engine, []).next.map((line) => line.text)).toEqual([
      'No desks yet — hire from the Staff page when you are ready.',
      '#general waits for your first hire.',
      'Your first ticket lands in Todo and work starts.',
    ])
  })

  it('says under Supervised that only the intake holder clocks in', () => {
    const engine = newCompany()
    const squad = rosterFromPreset(teamPreset('product-squad'), 'claude')
    const plan = (draft: typeof squad) =>
      officePlan({
        draft,
        headcount: null,
        catalog: wizardCatalog(engine.roles.list()),
        repos: [],
        autonomy: 'supervised',
      })

    expect(plan(squad).next[0]!.text).toBe(
      'Four desks appear; under Supervised only Hera clocks in, you start the rest from Employees.',
    )
    expect(plan(squad.slice(0, 1)).next[0]!.text).toBe('One desk appears; Hera clocks in to plan.')
    expect(plan(squad.slice(1)).next[0]!.text).toBe(
      'Three desks appear; under Supervised you start everyone from Employees.',
    )
    expect(plan([]).next[0]!.text).toBe('No desks yet — hire from the Staff page when you are ready.')
    expect(planFor(engine, squad).next[0]!.text).toBe('Four desks appear in the office, one sprite each.')
  })
})
