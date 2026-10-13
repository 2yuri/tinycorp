import { describe, expect, it } from 'vitest'
import {
  answererChain,
  type Capability,
  type Employee,
  EVERY_REPO,
  matchesArea,
  preferredAssignee,
  rankAssignees,
  resolveAnswerer,
  shutOutLine,
  shutOutOfEveryRepo,
  type Unavailability,
} from './staff'

let hired = 0
function employee(name: string, capabilities: Capability[], job: Partial<Employee> = {}): Employee {
  hired += 1
  return {
    id: name.toLowerCase(),
    name,
    roleId: 'custom',
    title: name,
    persona: '',
    capabilities,
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    provider: 'claude',
    permissionMode: 'skip-permissions',
    model: null,
    overrides: [],
    desk: hired,
    sprite: 0,
    createdAt: new Date(hired).toISOString(),
    ...job,
  }
}

const away = (reasons: Record<string, Unavailability>) => (e: Employee) => reasons[e.id] ?? null

describe('The answerer chain', () => {
  it('picks the first intake holder in hire order when two hold intake', () => {
    const team = [employee('Ada', ['code']), employee('Pam', ['intake', 'plan']), employee('Hera', ['intake'])]

    const choice = resolveAnswerer(team)

    expect(choice.answerer?.name).toBe('Pam')
    expect(choice.skipped).toEqual([])
    expect(answererChain(team).map((e) => e.name)).toEqual(['Pam', 'Hera', 'Ada'])
  })

  it('picks a plan holder when nobody holds intake, like a lone Tech Lead in a team', () => {
    const team = [employee('Ada', ['code']), employee('Tess', ['plan', 'review'])]

    expect(resolveAnswerer(team).answerer?.name).toBe('Tess')
  })

  it('picks the first hired when nobody holds intake or plan, like capability-less custom roles', () => {
    const team = [employee('Una', []), employee('Ben', ['code'])]

    expect(resolveAnswerer(team).answerer?.name).toBe('Una')
  })

  it('picks the only Employee, whatever it holds', () => {
    expect(resolveAnswerer([employee('Solo', ['review'])]).answerer?.name).toBe('Solo')
  })

  it('picks nobody when there are no Employees', () => {
    expect(resolveAnswerer([])).toEqual({ answerer: null, first: null, skipped: [], override: null })
  })

  it('puts a valid boss override first', () => {
    const team = [employee('Pam', ['intake']), employee('Ada', ['code'])]

    const choice = resolveAnswerer(team, { overrideId: 'ada' })

    expect(choice.answerer?.name).toBe('Ada')
    expect(choice.override).toEqual({ id: 'ada', stale: null })
    expect(answererChain(team, 'ada').map((e) => e.name)).toEqual(['Ada', 'Pam'])
  })

  it('falls back to the chain when the override was fired, and says so', () => {
    const team = [employee('Pam', ['intake']), employee('Ada', ['code'])]

    const choice = resolveAnswerer(team, { overrideId: 'gone' })

    expect(choice.answerer?.name).toBe('Pam')
    expect(choice.override).toEqual({ id: 'gone', stale: 'fired' })
  })

  it('passes over a parked override to the chain, and says why', () => {
    const team = [employee('Pam', ['intake']), employee('Ada', ['code'])]

    const choice = resolveAnswerer(team, { overrideId: 'ada', unavailable: away({ ada: 'parked' }) })

    expect(choice.answerer?.name).toBe('Pam')
    expect(choice.override).toEqual({ id: 'ada', stale: 'unavailable' })
    expect(choice.skipped).toEqual([{ employee: team[1], reason: 'parked' }])
  })

  it('skips each unavailable Employee with its reason, in chain order', () => {
    const team = [
      employee('Pam', ['intake']),
      employee('Tess', ['plan']),
      employee('Ada', ['code']),
      employee('Ben', ['code']),
    ]

    const choice = resolveAnswerer(team, {
      unavailable: away({ pam: 'paused', tess: 'out_of_budget', ada: 'stopped' }),
    })

    expect(choice.answerer?.name).toBe('Ben')
    expect(choice.first?.name).toBe('Pam')
    expect(choice.skipped.map((s) => [s.employee.name, s.reason])).toEqual([
      ['Pam', 'paused'],
      ['Tess', 'out_of_budget'],
      ['Ada', 'stopped'],
    ])
  })

  it('answers nobody when everyone is unavailable, keeping who the message waits for', () => {
    const team = [employee('Pam', ['intake']), employee('Ada', ['code'])]

    const choice = resolveAnswerer(team, { unavailable: () => 'parked' })

    expect(choice.answerer).toBeNull()
    expect(choice.first?.name).toBe('Pam')
    expect(choice.skipped).toHaveLength(2)
  })
})

/**
 * T239: the boss dogfoods one monorepo called `tinycorp`. Frontend and Backend used to carry glob
 * filters over the repo *name* (`*front*`, `*api*`), which a monorepo matches nowhere, so every
 * ticket landed on the Tech Lead. They work in every repo now and specialise by area.
 */
describe('Who takes a ticket', () => {
  const monorepo = { repos: ['tinycorp'] }
  const team = () => [
    employee('Pam', ['intake', 'plan']),
    employee('Tess', ['plan', 'code', 'review']),
    employee('Fran', ['code'], { areas: ['src/renderer/**'] }),
    employee('Ben', ['code'], { areas: ['src/main/**', 'src/shared/**'] }),
  ]

  it('sends renderer work to the Frontend of a monorepo, not to the lead', () => {
    const ranked = rankAssignees(team(), { ...monorepo, paths: ['src/renderer/src/board/TicketCard.tsx'] })

    expect(ranked.map((e) => e.name)).toEqual(['Fran', 'Ben', 'Tess'])
  })

  it('sends main-process work to the Backend of the same repo', () => {
    expect(preferredAssignee(team(), { ...monorepo, paths: ['src/main/features/board/board.ts'] })?.name).toBe('Ben')
  })

  it('reads a label as the area when no path is planned yet', () => {
    expect(preferredAssignee(team(), { ...monorepo, labels: ['renderer'] })?.name).toBe('Fran')
    expect(preferredAssignee(team(), { ...monorepo, labels: ['shared'] })?.name).toBe('Ben')
  })

  it('reads a label that looks like a path as a path', () => {
    expect(preferredAssignee(team(), { ...monorepo, labels: ['src/main/app'] })?.name).toBe('Ben')
  })

  it('falls back to an engineer with no area before the lead, when nothing matches the areas', () => {
    const team = [
      employee('Tess', ['plan', 'code', 'review']),
      employee('Fran', ['code'], { areas: ['src/renderer/**'] }),
      employee('Dev', ['code']),
    ]

    expect(rankAssignees(team, { ...monorepo, paths: ['e2e/launch.spec.ts'] }).map((e) => e.name)).toEqual([
      'Dev',
      'Fran',
      'Tess',
    ])
  })

  it('gives it to the lead only when no engineer can take it', () => {
    const team = [employee('Tess', ['plan', 'code', 'review']), employee('Pam', ['intake', 'plan'])]

    expect(preferredAssignee(team, monorepo)?.name).toBe('Tess')
  })

  it('takes nobody who does not write code, and nobody with no Employee at all', () => {
    expect(preferredAssignee([employee('Pam', ['intake', 'plan', 'hire'])], monorepo)).toBeNull()
    expect(preferredAssignee([], monorepo)).toBeNull()
  })

  it('leaves out an engineer whose repo filter shuts them out of a repo the ticket touches', () => {
    const team = [
      employee('Fran', ['code'], { repoFilter: ['*web*'], areas: ['src/renderer/**'] }),
      employee('Tess', ['plan', 'code', 'review']),
    ]

    expect(rankAssignees(team, { repos: ['tinycorp'], paths: ['src/renderer/x.tsx'] }).map((e) => e.name)).toEqual([
      'Tess',
    ])
  })

  it('needs every repo of a two-repo ticket, since one Employee holds it all', () => {
    const team = [employee('Fran', ['code'], { repoFilter: ['web'] }), employee('Dev', ['code'])]

    expect(rankAssignees(team, { repos: ['web', 'api'] }).map((e) => e.name)).toEqual(['Dev'])
  })
})

describe('An area', () => {
  it('holds the paths under it, whatever the separator the caller used', () => {
    expect(matchesArea(['src/renderer/**'], { repos: [], paths: ['src/renderer/src/App.tsx'] })).toBe(true)
    expect(matchesArea(['src/renderer/**'], { repos: [], paths: ['src\\renderer\\src\\App.tsx'] })).toBe(true)
    expect(matchesArea(['src/renderer/**'], { repos: [], paths: ['src/main/index.ts'] })).toBe(false)
  })

  it('holds the folder under it when it names no glob', () => {
    expect(matchesArea(['packages/api'], { repos: [], paths: ['packages/api/src/db.ts'] })).toBe(true)
    expect(matchesArea(['packages/api'], { repos: [], paths: ['packages/apish/src/db.ts'] })).toBe(false)
  })

  it('stops a single star at the folder it is in, which is what tells it from **', () => {
    expect(matchesArea(['apps/*/src'], { repos: [], paths: ['apps/web/src/main.ts'] })).toBe(true)
    expect(matchesArea(['apps/*/src'], { repos: [], paths: ['apps/web/nested/src/main.ts'] })).toBe(false)
    expect(matchesArea(['apps/**/src'], { repos: [], paths: ['apps/web/nested/src/main.ts'] })).toBe(true)
  })

  it('matches nothing for an Employee that names none', () => {
    expect(matchesArea([], { repos: ['tinycorp'], paths: ['src/renderer/App.tsx'], labels: ['renderer'] })).toBe(false)
  })
})

describe('A filter that shuts someone out (T239)', () => {
  it('shuts out an engineer no repo of the Company matches', () => {
    const fran = employee('Fran', ['code'], { repoFilter: ['*web*'] })

    expect(shutOutOfEveryRepo(fran, ['tinycorp'])).toBe(true)
    expect(shutOutLine(fran.name)).toBe('Fran can\u2019t work in any of this Company\u2019s repos')
  })

  it('shuts nobody out once the filter matches a repo, or the Company has none yet', () => {
    expect(shutOutOfEveryRepo(employee('Fran', ['code'], { repoFilter: ['*web*'] }), ['acme-web'])).toBe(false)
    expect(shutOutOfEveryRepo(employee('Fran', ['code'], { repoFilter: EVERY_REPO }), ['tinycorp'])).toBe(false)
    expect(shutOutOfEveryRepo(employee('Fran', ['code'], { repoFilter: [] }), [])).toBe(false)
  })

  it('never shuts out somebody who does not code: a PM works in no repo on purpose', () => {
    expect(shutOutOfEveryRepo(employee('Pam', ['intake', 'plan', 'hire'], { repoFilter: [] }), ['tinycorp'])).toBe(
      false,
    )
  })
})
