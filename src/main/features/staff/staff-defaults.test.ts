import { rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { migrations } from '../../core/engine/migrations'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { defaultPermissionMode, setDefaultPermissionMode } from './staff-defaults'

/**
 * The Company-wide permission mode (T164). It is what a hire takes when nobody names one — the form,
 * HR's hiring tools and the setup wizard all leave the field out — so what matters is that the
 * answer is the same everywhere, and that a Company that existed before the setting keeps running
 * the way it already did.
 */

const engines: CompanyEngine[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function companyInMemory(): CompanyEngine {
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return engine
}

function hire(engine: CompanyEngine, name: string) {
  const roleId = engine.roles.ensure(['frontend'])[0]!.id
  return engine.employees.create({ name, roleId })
}

describe('the Company’s permission default', () => {
  it('is skip-permissions until the boss changes it: what every Employee already ran with', () => {
    const engine = companyInMemory()

    expect(engine.employees.permissionDefault()).toBe('skip-permissions')
  })

  it('is what a hire that names no mode takes, and it changes what the next hire takes', () => {
    const engine = companyInMemory()

    expect(hire(engine, 'Ada').permissionMode).toBe('skip-permissions')

    engine.employees.setPermissionDefault('interactive')

    expect(hire(engine, 'Grace').permissionMode).toBe('interactive')
  })

  it('leaves everyone already on staff with the mode they have', () => {
    const engine = companyInMemory()
    const ada = hire(engine, 'Ada')

    engine.employees.setPermissionDefault('interactive')

    expect(engine.employees.list().find((e) => e.id === ada.id)?.permissionMode).toBe('skip-permissions')
  })

  it('never overrides a hire that names its own mode', () => {
    const engine = companyInMemory()
    engine.employees.setPermissionDefault('interactive')
    const roleId = engine.roles.ensure(['pm'])[0]!.id

    const hired = engine.employees.create({ name: 'Ada', roleId, permissionMode: 'skip-permissions' })

    expect(hired.permissionMode).toBe('skip-permissions')
  })

  it('refuses a mode the app does not know rather than storing it', () => {
    const engine = companyInMemory()

    expect(() => engine.employees.setPermissionDefault('yolo' as never)).toThrow(/permission mode/i)
    expect(engine.employees.permissionDefault()).toBe('skip-permissions')
  })

  it('tells the screens watching staff, so the hire form opens on what was just saved', () => {
    const engine = companyInMemory()
    let changes = 0
    engine.employees.onChange(() => changes++)

    engine.employees.setPermissionDefault('interactive')

    expect(changes).toBeGreaterThan(0)
  })
})

describe('the migration behind it', () => {
  it('reads skip-permissions out of a Company stored before the setting existed', () => {
    const db = new DatabaseSync(':memory:')
    // A Company as it stood before T164 added the table: every migration up to that one.
    const at = migrations.findIndex((m) => m.name === 'staff-company-defaults')
    expect(at).toBeGreaterThan(0)
    runMigrations(db, migrations.slice(0, at))

    runMigrations(db, migrations)

    expect(defaultPermissionMode(db)).toBe('skip-permissions')
  })

  it('keeps what the boss set across a second run of the migrations', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, migrations)
    setDefaultPermissionMode(db, 'interactive')

    runMigrations(db, migrations)

    expect(defaultPermissionMode(db)).toBe('interactive')
  })
})
