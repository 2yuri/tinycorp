import { afterEach, describe, expect, it } from 'vitest'
import { PROVIDERS } from '../../../shared/domain/providers'
import { intakeHolder } from '../../../shared/domain/staff'
import { modelOption } from '../../../shared/staff/models'
import { ROLE_TEMPLATES } from '../../../shared/staff/role-templates'
import {
  DEFAULT_PRESET,
  presetChips,
  presetModel,
  seatLabel,
  TEAM_PRESETS,
  teamPreset,
} from '../../../shared/staff/team-presets'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
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

describe('team presets', () => {
  it('ships the four presets in order, Product squad by default', () => {
    expect(TEAM_PRESETS.map((preset) => preset.name)).toEqual([
      'Solo builder',
      'Product squad',
      'Full studio',
      'Start empty',
    ])
    expect(teamPreset(DEFAULT_PRESET).name).toBe('Product squad')
  })

  it('lists the roles and seat counts the cards show', () => {
    const cards = TEAM_PRESETS.map((preset) => [presetChips(preset), seatLabel(preset)])

    expect(cards).toEqual([
      [['Tech Lead'], '1 seat'],
      [['PM', 'Tech Lead', 'Frontend', 'Backend'], '4 seats'],
      [['+ QA', '+ DevOps', '+ HR', '+ PO'], '8 seats'],
      [['Nobody yet'], '0 seats'],
    ])
  })

  it('gives every seat a default name and persona, unique within its preset', () => {
    for (const preset of TEAM_PRESETS) {
      const names = preset.seats.map((seat) => seat.name)
      expect(new Set(names).size).toBe(names.length)
      for (const seat of preset.seats) {
        expect(seat.name.trim()).not.toBe('')
        expect(seat.persona.trim()).not.toBe('')
      }
    }
    expect(teamPreset('product-squad').seats.map((seat) => seat.name)).toEqual(['Hera', 'Orion', 'Ada', 'Vega'])
  })

  it('names built-in templates by their catalogue name and a known model', () => {
    const catalog = new Map(ROLE_TEMPLATES.map((role) => [role.id, role]))

    for (const seat of TEAM_PRESETS.flatMap((preset) => preset.seats)) {
      expect(catalog.get(seat.roleId)?.name).toBe(seat.role)
    }
    for (const provider of PROVIDERS) {
      expect(modelOption(provider, presetModel(provider))).not.toBeNull()
    }
  })

  it('hires into a new Company, with the PM holding intake in a squad', () => {
    for (const preset of TEAM_PRESETS) {
      const engine = newCompany()
      for (const seat of preset.seats) {
        engine.employees.create({ name: seat.name, roleId: seat.roleId, model: presetModel('claude') })
      }
      const staff = engine.employees.list()

      expect(staff.map((employee) => employee.title)).toEqual(preset.seats.map((seat) => seat.role))
      if (preset.id === 'product-squad' || preset.id === 'full-studio') expect(intakeHolder(staff)?.name).toBe('Hera')
      if (preset.id === 'solo-builder') expect(intakeHolder(staff)?.name).toBe('Orion')
    }
  })
})
