import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { CAPABILITIES, matchesRepoFilter } from '../../../shared/domain/staff'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import { ROLE_TEMPLATES } from '../../../shared/staff/role-templates'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { migrate, migrations } from '../../core/engine/migrations'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { SPRITE_COUNT, toEmployee } from './staff'

const engines: CompanyEngine[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function companyInMemory() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return engine
}

/**
 * The Company's role of this name. A Company holds no roles until something needs one (T240), so
 * this takes the built-in — which is what hiring into it would have done anyway.
 */
function role(engine: CompanyEngine, name: string) {
  const template = ROLE_TEMPLATES.find((t) => t.name === name)
  if (!template) throw new Error(`no built-in role ${name}`)
  const found = engine.roles.ensure([template.id])[0]
  if (!found) throw new Error(`no role ${name}`)
  return found
}

describe('Role catalog', () => {
  it('starts a Company with no roles at all: the built-ins are a catalogue (T240)', () => {
    const engine = companyInMemory()

    expect(engine.roles.list()).toEqual([])
    expect(ROLE_TEMPLATES.map((t) => t.name)).toEqual([
      'PM',
      'PO',
      'Tech Lead',
      'Frontend',
      'Backend',
      'DevOps',
      'QA',
      'Security',
      'HR',
    ])
    for (const template of ROLE_TEMPLATES) {
      expect(template.persona.length).toBeGreaterThan(20)
      expect(template.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('takes only the roles the Employees it hires need', () => {
    const engine = companyInMemory()

    engine.employees.create({ name: 'Hera', roleId: 'pm' })
    engine.employees.create({ name: 'Ada', roleId: 'frontend' })
    engine.employees.create({ name: 'Vega', roleId: 'frontend' })

    expect(engine.roles.list().map((r) => r.name)).toEqual(['PM', 'Frontend'])
    expect(engine.roles.list().every((r) => r.seeded)).toBe(true)
  })

  it('creates a role from a built-in template, under the template’s own id', () => {
    const engine = companyInMemory()
    const qa = ROLE_TEMPLATES.find((t) => t.id === 'qa')!

    const created = engine.roles.create({ ...qa, templateId: 'qa' })

    expect(created).toEqual({ ...qa, seeded: true })
    expect(engine.roles.list()).toEqual([created])
    // The team presets and `/hire qa` name the role by that word, and it is still that word.
    expect(engine.employees.create({ name: 'Iris', roleId: 'qa' }).title).toBe('QA')
  })

  it('creates a second role from the same template under a fresh id', () => {
    const engine = companyInMemory()
    const qa = ROLE_TEMPLATES.find((t) => t.id === 'qa')!
    engine.roles.create({ ...qa, templateId: 'qa' })

    const manual = engine.roles.create({ ...qa, name: 'Manual QA', templateId: 'qa' })

    expect(manual.id).not.toBe('qa')
    expect(engine.roles.list().map((r) => r.id)).toEqual(['qa', manual.id])
  })

  it('creates a role from blank, which is nobody’s template', () => {
    const engine = companyInMemory()

    const designer = engine.roles.create({
      name: 'Designer',
      persona: '',
      capabilities: [],
      repoFilter: [],
      areas: [],
      mcpServers: [],
      skills: [],
    })

    expect(designer).toMatchObject({ name: 'Designer', persona: '', capabilities: [], seeded: false })
    expect(designer.id).not.toBe('')
    expect(engine.roles.list()).toEqual([designer])
  })

  it('gives seeded roles capabilities that match their job', () => {
    const engine = companyInMemory()

    expect(role(engine, 'PM').capabilities).toContain('intake')
    expect(role(engine, 'Tech Lead').capabilities).toContain('review')
    expect(role(engine, 'Frontend').capabilities).toEqual(['code'])
    expect(role(engine, 'QA').capabilities).toContain('review')
    expect(role(engine, 'HR').capabilities).toEqual(['hire'])
  })

  /**
   * T239: Frontend and Backend used to carry globs over the repo *name* — `*web*`, `*api*` — which
   * matched no monorepo, so in a Company with one repo called `tinycorp` only the Tech Lead could
   * work anywhere and every ticket landed on them. Everyone who codes now works in every repo and
   * specialises by area instead.
   */
  it('lets every seeded engineer into every repo, a monorepo included', () => {
    const engine = companyInMemory()

    for (const name of ['Frontend', 'Backend', 'Tech Lead', 'DevOps', 'QA']) {
      const template = role(engine, name)
      expect(matchesRepoFilter(template.repoFilter, 'tinycorp')).toBe(true)
      expect(matchesRepoFilter(template.repoFilter, 'acme-web')).toBe(true)
      expect(template.areas).toEqual([])
    }
    // Nobody who does not code is let into a repo, and that is not a filter shutting anyone out.
    expect(role(engine, 'HR').repoFilter).toEqual([])
    expect(role(engine, 'PM').repoFilter).toEqual([])
  })

  it('edits a seeded role', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM')

    const edited = engine.roles.update(pm.id, {
      persona: 'A terse PM who writes one-line tickets.',
      capabilities: ['intake', 'plan', 'code'],
      repoFilter: ['acme-*'],
      areas: [],
    })

    expect(edited).toMatchObject({
      id: pm.id,
      name: 'PM',
      persona: 'A terse PM who writes one-line tickets.',
      capabilities: ['intake', 'plan', 'code'],
      repoFilter: ['acme-*'],
      areas: [],
      seeded: true,
    })
    expect(role(engine, 'PM')).toEqual(edited)
  })

  it('creates a new role template', () => {
    const engine = companyInMemory()

    const designer = engine.roles.create({
      name: 'Designer',
      persona: 'Draws the screens before anyone codes them.',
      capabilities: ['plan'],
      repoFilter: ['*web*'],
      areas: [],
      mcpServers: [],
      skills: [],
    })

    expect(designer).toMatchObject({ name: 'Designer', seeded: false, capabilities: ['plan'] })
    expect(engine.roles.list()).toContainEqual(designer)
  })

  it('refuses a role with a blank or duplicate name', () => {
    const engine = companyInMemory()
    const base = {
      persona: 'x',
      capabilities: ['code' as const],
      repoFilter: ['*'],
      areas: [],
      mcpServers: [],
      skills: [],
    }

    role(engine, 'Backend')
    role(engine, 'PM')

    expect(() => engine.roles.create({ ...base, name: '  ' })).toThrow(/name/i)
    expect(() => engine.roles.create({ ...base, name: 'backend' })).toThrow(/already/i)
    expect(() => engine.roles.update(role(engine, 'QA').id, { name: 'PM' })).toThrow(/already/i)
    expect(engine.roles.list()).toHaveLength(3)
  })

  it('refuses unknown capabilities', () => {
    const engine = companyInMemory()

    expect(() =>
      engine.roles.create({
        name: 'Wizard',
        persona: 'x',
        capabilities: ['magic' as never],
        repoFilter: [],
        areas: [],
        mcpServers: [],
        skills: [],
      }),
    ).toThrow(/capabilit/i)
  })

  it('refuses to edit an unknown role', () => {
    const engine = companyInMemory()

    expect(() => engine.roles.update('nope', { name: 'X' })).toThrow(/unknown role/i)
  })

  it('keeps each Company’s catalog separate', () => {
    const engine = companyInMemory()
    engine.roles.create({
      name: 'Designer',
      persona: 'x',
      capabilities: ['plan'],
      repoFilter: [],
      areas: [],
      mcpServers: [],
      skills: [],
    })

    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    expect(engine.roles.list().map((r) => r.name)).not.toContain('Designer')
  })

  it('refuses to delete a role Employees hold, naming who holds it', () => {
    const engine = companyInMemory()
    engine.employees.create({ name: 'Ada', roleId: 'frontend' })
    engine.employees.create({ name: 'Vega', roleId: 'frontend' })

    expect(() => engine.roles.delete('frontend')).toThrow(
      'Frontend cannot be deleted: Ada and Vega are on it. Move them to another role first.',
    )
    expect(engine.roles.list().map((r) => r.id)).toEqual(['frontend'])
  })

  it('refuses to delete a role a former Employee could be rehired onto', () => {
    const engine = companyInMemory()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'frontend' })
    engine.hiring.fire(ada.id, 'moved on')

    expect(() => engine.roles.delete('frontend')).toThrow(/Ada can be rehired onto it/)
  })

  it('deletes a role once its Employees are reassigned, built-in or not', () => {
    const engine = companyInMemory()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'frontend' })
    engine.roles.ensure(['backend'])

    engine.roles.delete('frontend', { reassignTo: 'backend' })

    expect(engine.roles.list().map((r) => r.id)).toEqual(['backend'])
    expect(engine.employees.list()).toMatchObject([{ id: ada.id, roleId: 'backend', title: 'Backend' }])
    // The move is an edit, not a re-hire (T138): the desk and the character stay put.
    expect(engine.employees.list()[0]!.desk).toBe(ada.desk)
  })

  it('deletes a role nobody holds, and refuses an unknown one or a move onto itself', () => {
    const engine = companyInMemory()
    engine.roles.ensure(['qa'])

    engine.roles.delete('qa')

    expect(engine.roles.list()).toEqual([])
    expect(() => engine.roles.delete('qa')).toThrow(/unknown role/i)
    engine.roles.ensure(['qa'])
    expect(() => engine.roles.delete('qa', { reassignTo: 'qa' })).toThrow(/other than QA/)
  })

  it('removes the built-in roles nobody was ever hired into, and keeps the rest', () => {
    const engine = companyInMemory()
    engine.employees.create({ name: 'Hera', roleId: 'pm' })
    engine.roles.ensure(['qa', 'devops'])
    const designer = engine.roles.create({
      name: 'Designer',
      persona: 'x',
      capabilities: ['plan'],
      repoFilter: [],
      areas: [],
      mcpServers: [],
      skills: [],
    })

    expect(engine.roles.removeUnused()).toEqual(['QA', 'DevOps'])
    // A role the boss wrote themselves is not swept, however empty: only the built-ins are.
    expect(engine.roles.list().map((r) => r.id)).toEqual(['pm', designer.id])
    expect(engine.roles.removeUnused()).toEqual([])
  })

  it('leaves Security in the catalogue for a Company created since T240', () => {
    const engine = companyInMemory()

    // T241 seeds Security into every Company that already existed, and only those: a Company being
    // created runs its migrations before its own row lands, which is what the step tests for.
    expect(engine.roles.list()).toEqual([])
    expect(ROLE_TEMPLATES.map((t) => t.id)).toContain('security')
    expect(engine.employees.create({ name: 'Sable', roleId: 'security' }).title).toBe('Security')
    expect(engine.roles.list().map((r) => r.id)).toEqual(['security'])
  })

  it('still catches up a Company that existed before Security did', () => {
    const db = new DatabaseSync(':memory:')
    const upTo = (name: string) => migrations.slice(0, migrations.findIndex((step) => step.name === name) + 1)
    runMigrations(db, upTo('staff-tables'))
    db.prepare(`INSERT INTO role_template (id, name, persona, capabilities, repo_filter, seeded, position)
                VALUES ('qa', 'QA', 'x', '["review"]', '["*"]', 1, 0)`).run()
    db.prepare(`INSERT INTO company (id, name, created_at) VALUES ('c1', 'Acme', '2026-01-01')`).run()

    runMigrations(db, upTo('staff-security-role'))

    const names = (db.prepare('SELECT name FROM role_template ORDER BY position').all() as { name: string }[]).map(
      (row) => row.name,
    )
    expect(names).toEqual(['QA', 'Security'])
  })

  it('needs an open Company', () => {
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
    })
    engines.push(engine)

    expect(() => engine.roles.list()).toThrow(/no company is open/i)
    expect(() => engine.employees.list()).toThrow(/no company is open/i)
  })
})

describe('Employees', () => {
  it('starts with nobody employed', () => {
    const engine = companyInMemory()

    expect(engine.employees.list()).toEqual([])
  })

  it('hires from a role, copying its persona, capabilities and repo filter', () => {
    const engine = companyInMemory()
    const backend = role(engine, 'Backend')

    const ada = engine.employees.create({ name: 'Ada', roleId: backend.id })

    expect(ada).toMatchObject({
      name: 'Ada',
      roleId: backend.id,
      title: 'Backend',
      persona: backend.persona,
      capabilities: backend.capabilities,
      repoFilter: backend.repoFilter,
      provider: 'claude',
      permissionMode: 'skip-permissions',
    })
    expect(engine.employees.list()).toEqual([ada])
  })

  it('hires with a custom persona, capabilities, repo filter and permission mode', () => {
    const engine = companyInMemory()

    const juno = engine.employees.create({
      name: 'Juno',
      roleId: role(engine, 'DevOps').id,
      persona: 'Grumpy about YAML.',
      capabilities: ['code', 'review'],
      repoFilter: ['infra'],
      areas: [],
      provider: 'claude',
      permissionMode: 'interactive',
    })

    expect(juno).toMatchObject({
      title: 'DevOps',
      persona: 'Grumpy about YAML.',
      capabilities: ['code', 'review'],
      repoFilter: ['infra'],
      areas: [],
      permissionMode: 'interactive',
    })
  })

  it('accepts a one-Employee Company holding every capability', () => {
    const engine = companyInMemory()

    const solo = engine.employees.create({
      name: 'Solo',
      roleId: role(engine, 'PM').id,
      capabilities: [...CAPABILITIES],
      repoFilter: ['*'],
      areas: [],
    })

    expect(engine.employees.list()).toEqual([solo])
    expect([...solo.capabilities].sort()).toEqual([...CAPABILITIES].sort())
  })

  it('edits an Employee', () => {
    const engine = companyInMemory()
    const ada = engine.employees.create({ name: 'Ada', roleId: role(engine, 'Backend').id })

    const edited = engine.employees.update(ada.id, {
      name: 'Ada L.',
      persona: 'Loves proofs.',
      capabilities: ['code', 'review'],
      repoFilter: ['acme-api'],
      areas: [],
      permissionMode: 'interactive',
    })

    expect(edited).toEqual({
      ...ada,
      name: 'Ada L.',
      persona: 'Loves proofs.',
      capabilities: ['code', 'review'],
      repoFilter: ['acme-api'],
      areas: [],
      permissionMode: 'interactive',
      overrides: ['persona', 'capabilities', 'repoFilter'],
    })
    expect(engine.employees.list()).toEqual([edited])
  })

  it('moves an Employee to another role: the fields it followed take the new role’s (T138)', () => {
    const engine = companyInMemory()
    const frontend = role(engine, 'Frontend')
    const backend = role(engine, 'Backend')
    const ada = engine.employees.create({
      name: 'Ada',
      roleId: frontend.id,
      persona: 'Ada’s own persona.',
    })
    expect(ada.overrides).toEqual(['persona'])

    const moved = engine.employees.update(ada.id, { roleId: backend.id })

    // The persona was Ada’s own, so it stays hers and stays marked; everything else follows Backend.
    expect(moved).toMatchObject({
      roleId: backend.id,
      title: 'Backend',
      persona: 'Ada’s own persona.',
      capabilities: backend.capabilities,
      repoFilter: backend.repoFilter,
      mcpServers: backend.mcpServers,
      overrides: ['persona'],
    })
    expect(engine.employees.list()).toEqual([moved])
  })

  it('changing a role is not a re-hire: desk, character, name and model stay put (T138)', () => {
    const engine = companyInMemory()
    const ada = engine.employees.create({
      name: 'Ada',
      roleId: role(engine, 'Frontend').id,
      sprite: 3,
      model: 'opus-5-balanced',
    })

    const moved = engine.employees.update(ada.id, { roleId: role(engine, 'QA').id })

    expect(moved).toMatchObject({
      id: ada.id,
      name: 'Ada',
      desk: ada.desk,
      sprite: 3,
      provider: ada.provider,
      model: 'opus-5-balanced',
      createdAt: ada.createdAt,
    })
  })

  it('takes the edited fields over the new role’s when a save moves both (T138)', () => {
    const engine = companyInMemory()
    const ada = engine.employees.create({ name: 'Ada', roleId: role(engine, 'Frontend').id })
    const qa = role(engine, 'QA')

    const moved = engine.employees.update(ada.id, {
      roleId: qa.id,
      persona: 'Ada writes the repro first.',
      capabilities: qa.capabilities,
      repoFilter: qa.repoFilter,
      mcpServers: qa.mcpServers,
    })

    expect(moved).toMatchObject({
      title: 'QA',
      persona: 'Ada writes the repro first.',
      capabilities: qa.capabilities,
      overrides: ['persona'],
    })
  })

  it('follows the new role from then on, and the old one no longer reaches it (T138)', () => {
    const engine = companyInMemory()
    const frontend = role(engine, 'Frontend')
    const backend = role(engine, 'Backend')
    const ada = engine.employees.create({ name: 'Ada', roleId: frontend.id })

    engine.employees.update(ada.id, { roleId: backend.id })
    engine.roles.update(frontend.id, { persona: 'The Frontend role, rewritten.' })
    engine.roles.update(backend.id, { persona: 'The Backend role, rewritten.' })

    expect(engine.employees.list()[0]).toMatchObject({ persona: 'The Backend role, rewritten.' })
  })

  it('refuses a move to a role the catalog does not hold (T138)', () => {
    const engine = companyInMemory()
    const ada = engine.employees.create({ name: 'Ada', roleId: role(engine, 'PM').id })

    expect(() => engine.employees.update(ada.id, { roleId: 'nope' })).toThrow(/Unknown role/)
    expect(engine.employees.list()[0]).toEqual(ada)
  })

  it('does not change the fields an Employee overrode when their role template is edited', () => {
    const engine = companyInMemory()
    const qa = role(engine, 'QA')
    const grace = engine.employees.create({ name: 'Grace', roleId: qa.id, persona: 'Grace’s own persona.' })

    engine.roles.update(qa.id, { persona: 'Someone else entirely.' })

    expect(engine.employees.list()).toEqual([grace])
  })

  it('refuses a blank, duplicate, or unknown-role hire', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id
    engine.employees.create({ name: 'Ada', roleId: pm })

    expect(() => engine.employees.create({ name: ' ', roleId: pm })).toThrow(/name/i)
    expect(() => engine.employees.create({ name: 'ada', roleId: pm })).toThrow(/already/i)
    expect(() => engine.employees.create({ name: 'Bob', roleId: 'nope' })).toThrow(/unknown role/i)
    expect(() => engine.employees.create({ name: 'Bob', roleId: pm, provider: 'cursor' as never })).toThrow(/provider/i)
    expect(() => engine.employees.create({ name: 'Bob', roleId: pm, permissionMode: 'yolo' as never })).toThrow(
      /permission/i,
    )
    expect(engine.employees.list()).toHaveLength(1)
  })

  it('hires on Codex as readily as on Claude, with a model from Codex’s catalogue', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id

    const ada = engine.employees.create({ name: 'Ada', roleId: pm, provider: 'codex', model: 'gpt-6-astra-deep' })

    expect(ada.provider).toBe('codex')
    expect(ada.model).toBe('gpt-6-astra-deep')
    expect(() => engine.employees.create({ name: 'Bob', roleId: pm, provider: 'codex', model: 'opus-5-deep' })).toThrow(
      /unknown model/i,
    )
  })

  it('refuses to edit an unknown Employee or rename onto a colleague', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id
    engine.employees.create({ name: 'Ada', roleId: pm })
    const bob = engine.employees.create({ name: 'Bob', roleId: pm })

    expect(() => engine.employees.update('nope', { name: 'X' })).toThrow(/unknown employee/i)
    expect(() => engine.employees.update(bob.id, { name: 'ADA' })).toThrow(/already/i)
    expect(() => engine.employees.update(bob.id, { capabilities: ['fly' as never] })).toThrow(/capabilit/i)
  })

  it('gives every Employee their own desk and a sprite', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id

    const hired = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => engine.employees.create({ name, roleId: pm }))

    expect(new Set(hired.map((e) => e.desk)).size).toBe(hired.length)
    expect(hired.map((e) => e.desk)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(new Set(hired.map((e) => e.sprite)).size).toBe(Math.min(hired.length, CHARACTER_SHEETS))
  })

  it('hires with the character the boss picked', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id

    const picked = engine.employees.create({ name: 'Lyra', roleId: pm, sprite: 4 })

    expect(picked.sprite).toBe(4)
    expect(engine.employees.list().find((e) => e.id === picked.id)?.sprite).toBe(4)
  })

  it('refuses a character index outside the sheets', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id

    expect(() => engine.employees.create({ name: 'Lyra', roleId: pm, sprite: SPRITE_COUNT })).toThrow(/character/i)
    expect(() => engine.employees.create({ name: 'Lyra', roleId: pm, sprite: -1 })).toThrow(/character/i)
    expect(() => engine.employees.create({ name: 'Lyra', roleId: pm, sprite: 1.5 })).toThrow(/character/i)
  })

  it('changes an Employee’s character after they are hired, and leaves it alone otherwise', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id
    const ada = engine.employees.create({ name: 'Ada', roleId: pm, sprite: 4 })

    const relooked = engine.employees.update(ada.id, { sprite: 9 })
    const renamed = engine.employees.update(ada.id, { name: 'Ada L.' })

    expect(relooked.sprite).toBe(9)
    expect(renamed.sprite).toBe(9)
    expect(engine.employees.list().find((e) => e.id === ada.id)?.sprite).toBe(9)
  })

  it('refuses an edit to a character that is not one of the sheets', () => {
    const engine = companyInMemory()
    const ada = engine.employees.create({ name: 'Ada', roleId: role(engine, 'PM').id, sprite: 2 })

    expect(() => engine.employees.update(ada.id, { sprite: SPRITE_COUNT })).toThrow(/character/i)
    expect(() => engine.employees.update(ada.id, { sprite: -1 })).toThrow(/character/i)
    expect(() => engine.employees.update(ada.id, { sprite: 1.5 })).toThrow(/character/i)
    expect(() => engine.employees.update(ada.id, { sprite: 'two' as never })).toThrow(/character/i)
    expect(engine.employees.list().find((e) => e.id === ada.id)?.sprite).toBe(2)
  })

  it('lets two Employees wear the same character: the boss’s choice stands', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM').id
    const ada = engine.employees.create({ name: 'Ada', roleId: pm, sprite: 0 })
    const bob = engine.employees.create({ name: 'Bob', roleId: pm, sprite: 1 })

    const moved = engine.employees.update(bob.id, { sprite: ada.sprite })

    expect(moved.sprite).toBe(0)
    expect(engine.employees.list().map((e) => e.sprite)).toEqual([0, 0])
  })

  it('tells subscribers when the staff changes', () => {
    const engine = companyInMemory()
    const pm = role(engine, 'PM')
    let changes = 0
    engine.employees.onChange(() => changes++)

    const ada = engine.employees.create({ name: 'Ada', roleId: pm.id })
    engine.employees.update(ada.id, { name: 'Ada L.' })
    engine.roles.create({
      name: 'Designer',
      persona: 'x',
      capabilities: ['plan'],
      repoFilter: [],
      areas: [],
      mcpServers: [],
      skills: [],
    })
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    expect(changes).toBe(4)
  })

  it('keeps each Company’s staff separate', () => {
    const engine = companyInMemory()
    const acme = engine.currentCompany()!
    engine.employees.create({ name: 'Ada', roleId: role(engine, 'PM').id })

    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    expect(engine.employees.list()).toEqual([])

    engine.switchCompany(acme.id)
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Ada'])
  })
})

describe('Staff on disk', () => {
  it('keeps roles and Employees after the app restarts', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-'))
    tempDirs.push(folder)
    const recents = inMemoryRecents()
    const first = createCompanyEngine({ recents })
    first.createCompany({ folder, name: 'Acme' })
    const designer = first.roles.create({
      name: 'Designer',
      persona: 'Draws.',
      capabilities: ['plan'],
      repoFilter: ['*web*'],
      areas: [],
      mcpServers: [],
      skills: [],
    })
    const ada = first.employees.create({ name: 'Ada', roleId: designer.id })
    first.close()

    const second = createCompanyEngine({ recents })
    engines.push(second)
    second.openCompany(folder)

    expect(second.roles.list()).toContainEqual(designer)
    expect(second.roles.list()).toHaveLength(1)
    expect(second.employees.list()).toEqual([ada])
  })
})

describe('Repo filter', () => {
  it('matches repo names by glob, ignoring case', () => {
    expect(matchesRepoFilter(['*'], 'anything')).toBe(true)
    expect(matchesRepoFilter([], 'anything')).toBe(false)
    expect(matchesRepoFilter(['acme-*'], 'ACME-web')).toBe(true)
    expect(matchesRepoFilter(['acme-*'], 'other-acme-web')).toBe(false)
    expect(matchesRepoFilter(['api.v2'], 'apixv2')).toBe(false)
  })
})

/**
 * The T239 migration, against a Company that existed before it. It repairs the two seeded templates
 * that shipped a glob over the repo *name*, and only where they are still word for word what
 * shipped: a filter the boss wrote is the boss's, and an Employee already hired is never touched —
 * the screens offer them "Allow all repos" instead.
 */
describe('The areas migration', () => {
  /**
   * A Company as it stood before `staff-areas`: every step up to it, and the two roles with the
   * filters the seeded templates shipped. `staff-tables` seeded those rows until T240 made the
   * built-ins a catalogue, so the rows are written here — which is the only place they can come
   * from now, and what an old database really holds.
   */
  function asItWas(): DatabaseSync {
    const db = new DatabaseSync(':memory:')
    const upto = migrations.findIndex((migration) => migration.name === 'staff-areas')
    expect(upto).toBeGreaterThan(0)
    runMigrations(db, migrations.slice(0, upto))
    const seed = db.prepare(
      `INSERT INTO role_template (id, name, persona, capabilities, repo_filter, seeded, position)
       VALUES (?, ?, 'x', '["code"]', ?, 1, ?)`,
    )
    seed.run('frontend', 'Frontend', JSON.stringify(['*front*', '*web*', '*ui*', '*app*', '*client*']), 0)
    seed.run('backend', 'Backend', JSON.stringify(['*back*', '*api*', '*server*', '*service*', '*worker*']), 1)
    return db
  }

  const filterOf = (db: DatabaseSync, id: string) =>
    (db.prepare('SELECT repo_filter FROM role_template WHERE id = ?').get(id) as { repo_filter: string }).repo_filter

  it('lets the shipped Frontend and Backend into every repo', () => {
    const db = asItWas()
    expect(filterOf(db, 'frontend')).toContain('*front*')

    migrate(db)

    expect(filterOf(db, 'frontend')).toBe('["*"]')
    expect(filterOf(db, 'backend')).toBe('["*"]')
  })

  it('leaves a filter the boss edited exactly as the boss left it', () => {
    const db = asItWas()
    db.prepare('UPDATE role_template SET repo_filter = ? WHERE id = ?').run('["acme-web"]', 'frontend')

    migrate(db)

    expect(filterOf(db, 'frontend')).toBe('["acme-web"]')
  })

  it('reads an Employee written before it as working in every path of its repos', () => {
    const db = asItWas()
    db.prepare(
      `INSERT INTO employee (id, name, role_id, title, persona, capabilities, repo_filter, provider,
         permission_mode, desk, sprite, created_at)
       VALUES ('e1', 'Ada', 'frontend', 'Frontend', 'x', '["code"]', '["*web*"]', 'claude',
         'skip-permissions', 0, 0, '2026-09-01T00:00:00.000Z')`,
    ).run()

    migrate(db)

    const row = db.prepare('SELECT repo_filter, areas FROM employee WHERE id = ?').get('e1') as {
      repo_filter: string
      areas: string | null
    }
    expect(row).toEqual({ repo_filter: '["*web*"]', areas: null })
    expect(toEmployee(db.prepare('SELECT * FROM employee WHERE id = ?').get('e1') as never).areas).toEqual([])
  })
})
