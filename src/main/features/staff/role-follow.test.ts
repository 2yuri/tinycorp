import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { ROLE_FOLLOW_MIGRATION } from './role-follow'
import { staffMigration } from './staff'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup(): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, provider }
}

function employee(engine: CompanyEngine, id: string) {
  const found = engine.employees.list().find((e) => e.id === id)
  if (!found) throw new Error(`no Employee ${id}`)
  return found
}

const backend = {
  persona: 'You build careful APIs and write tests first.',
  capabilities: ['code', 'review'] as const,
  repoFilter: ['api', 'worker'],
}

describe('Role edits propagate to Employees (decision 34)', () => {
  it('hires following every job field the role gives', () => {
    const { engine } = setup()

    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const role = engine.roles.ensure(['backend'])[0]!
    const bob = engine.employees.create({
      name: 'Bob',
      roleId: 'backend',
      persona: role.persona,
      capabilities: role.capabilities,
      repoFilter: role.repoFilter,
    })

    expect(ada.overrides).toEqual([])
    expect(bob.overrides).toEqual([])
  })

  it('records the fields a hire sets differently from the role as overridden', () => {
    const { engine } = setup()

    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', persona: 'A terse engineer.' })

    expect(ada.overrides).toEqual(['persona'])
    expect(employee(engine, ada.id).overrides).toEqual(['persona'])
  })

  it('rewrites persona, capabilities and repo filter of every Employee on the role that follows it', () => {
    const { engine } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const bob = engine.employees.create({ name: 'Bob', roleId: 'backend' })
    const cy = engine.employees.create({ name: 'Cy', roleId: 'frontend' })

    engine.roles.update('backend', { ...backend, capabilities: [...backend.capabilities] })

    for (const id of [ada.id, bob.id]) {
      expect(employee(engine, id)).toMatchObject({
        persona: backend.persona,
        capabilities: ['code', 'review'],
        repoFilter: ['api', 'worker'],
        overrides: [],
      })
    }
    expect(employee(engine, cy.id)).toMatchObject({ persona: cy.persona, repoFilter: cy.repoFilter })
  })

  it('leaves the fields an Employee overrode and updates the rest', () => {
    const { engine } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.employees.update(ada.id, { persona: 'Ada’s own persona.' })

    engine.roles.update('backend', { ...backend, capabilities: [...backend.capabilities] })

    expect(employee(engine, ada.id)).toMatchObject({
      persona: 'Ada’s own persona.',
      capabilities: ['code', 'review'],
      repoFilter: ['api', 'worker'],
      overrides: ['persona'],
    })
  })

  it('marks only the fields an edit changes, even when the editor sends every field', () => {
    const { engine } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    const edited = engine.employees.update(ada.id, {
      name: 'Ada L',
      persona: ada.persona,
      capabilities: ['code', 'review'],
      repoFilter: ada.repoFilter,
      permissionMode: 'interactive',
    })

    expect(edited.overrides).toEqual(['capabilities'])
    engine.roles.update('backend', { persona: 'New backend persona.', capabilities: ['code'] })
    expect(employee(engine, ada.id)).toMatchObject({
      persona: 'New backend persona.',
      capabilities: ['code', 'review'],
      overrides: ['capabilities'],
    })
  })

  it('keeps an override when the editor sends the overridden value back unchanged', () => {
    const { engine } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', repoFilter: ['api'] })

    const edited = engine.employees.update(ada.id, { repoFilter: ['api'], name: 'Ada' })

    expect(edited.overrides).toEqual(['repoFilter'])
  })

  it('follows the role again after an override is reset', () => {
    const { engine } = setup()
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', persona: 'Mine.', repoFilter: ['api'] })

    const reset = engine.employees.update(ada.id, { persona: 'Mine.', followRole: ['persona'] })

    expect(reset).toMatchObject({ persona: role.persona, overrides: ['repoFilter'] })
    expect(employee(engine, ada.id)).toMatchObject({ persona: role.persona, overrides: ['repoFilter'] })
    engine.roles.update('backend', { persona: 'Edited again.' })
    expect(employee(engine, ada.id).persona).toBe('Edited again.')
  })

  it('rejects an unknown field to follow', () => {
    const { engine } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(() => engine.employees.update(ada.id, { followRole: ['name' as never] })).toThrow('Unknown job field: name')
  })

  it('tells listeners the Employees changed when a role is edited', () => {
    const { engine } = setup()
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    let changes = 0
    engine.employees.onChange(() => changes++)

    engine.roles.update('backend', { persona: 'Edited.' })

    expect(changes).toBeGreaterThan(0)
  })

  it('writes the edited role into the Employee’s instructions at the next spawn', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    engine.sessions.stop(ada.id)

    engine.roles.update('backend', { persona: 'You are the API steward of Acme.', capabilities: ['code', 'hire'] })
    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('You are the API steward of Acme.')
    expect(text).toContain('Capabilities: `code`, `hire`.')
  })

  it('marks fields of Employees hired before the migration that already differ from their role', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, [staffMigration])
    // A Company from before T240 was seeded with the built-ins; this one holds the one it uses.
    db.prepare(
      `INSERT INTO role_template (id, name, persona, capabilities, repo_filter, seeded, position)
       VALUES ('backend', 'Backend', 'You are a backend engineer.', '["code"]', '["*api*"]', 1, 0)`,
    ).run()
    const insert = db.prepare(
      `INSERT INTO employee (id, name, role_id, title, persona, capabilities, repo_filter,
         provider, permission_mode, desk, sprite, created_at)
       SELECT ?, ?, id, name, COALESCE(?, persona), COALESCE(?, capabilities), COALESCE(?, repo_filter),
         'claude', 'skip-permissions', ?, 0, '2026-09-17' FROM role_template WHERE id = 'backend'`,
    )
    insert.run('same', 'Same', null, null, null, 0)
    insert.run('diff', 'Diff', 'Own persona.', null, '["api"]', 1)

    runMigrations(db, [staffMigration, ROLE_FOLLOW_MIGRATION])

    const overrides = db.prepare('SELECT id, overrides FROM employee ORDER BY id').all()
    expect(overrides).toEqual([
      { id: 'diff', overrides: '["persona","repoFilter"]' },
      { id: 'same', overrides: '[]' },
    ])
  })
})
