import { describe, expect, it } from 'vitest'
import { PROVIDERS, type Provider, pickDefaultProvider } from '../../../shared/domain/providers'
import type { RoleTemplate } from '../../../shared/domain/staff'
import { parseOnboardingDraft } from '../../../shared/onboarding'
import type { PreflightState, ProviderPreflight } from '../../../shared/providers/preflight'
import { providerForModel } from '../../../shared/staff/models'
import { addSeat, removeSeat, rosterFromPreset, updateSeat } from '../../../shared/staff/roster-draft'
import { presetModel, teamPreset } from '../../../shared/staff/team-presets'
import {
  nextStep,
  pickPreset,
  previousStep,
  restoreWizard,
  stepEyebrow,
  stepStatus,
  WIZARD_STEPS,
  type WizardState,
  wizardStart,
} from './wizard-model'

const at = (step: WizardState['step'], preset: WizardState['preset'] = 'product-squad'): WizardState => ({
  step,
  preset,
  roster: rosterFromPreset(teamPreset(preset), 'claude'),
  goal: '',
})

describe('setup wizard steps', () => {
  it('opens on the Team preset step with Product squad picked and the Company step done', () => {
    expect(wizardStart('claude')).toEqual({
      step: 'preset',
      preset: 'product-squad',
      roster: rosterFromPreset(teamPreset('product-squad'), 'claude'),
      goal: '',
    })
    expect(WIZARD_STEPS.map((step) => stepStatus(step, wizardStart('claude').step))).toEqual([
      'done',
      'current',
      'todo',
      'todo',
      'todo',
    ])
    expect(stepEyebrow('preset')).toBe('STEP 2 OF 5')
  })

  it('walks forward through every step and ends after First ticket', () => {
    const visited: string[] = []
    let state: WizardState | null = wizardStart('claude')
    while (state) {
      visited.push(state.step)
      const next = nextStep(state)
      state = next ? { ...state, step: next } : null
    }

    expect(visited).toEqual(['preset', 'team', 'repositories', 'first-ticket'])
  })

  it('skips Your team for Start empty, both ways, and marks it done when skipped', () => {
    expect(nextStep(at('preset', 'start-empty'))).toBe('repositories')
    expect(previousStep(at('repositories', 'start-empty'))).toBe('preset')
    expect(stepStatus('team', 'repositories')).toBe('done')
    expect(previousStep(at('repositories'))).toBe('team')
  })

  it('has no Back from the Team preset step: the Company already exists', () => {
    expect(previousStep(at('preset'))).toBeNull()
    expect(previousStep(at('team'))).toBe('preset')
    expect(previousStep(at('first-ticket'))).toBe('repositories')
  })

  it('carries the edited roster forward, and restarts it only for another preset', () => {
    const edited: WizardState = { ...at('team'), roster: removeSeat(at('team').roster, at('team').roster[0]!.key) }
    const back = { ...edited, step: previousStep(edited)! }

    expect(pickPreset(back, 'product-squad', 'claude')).toBe(back)
    expect(pickPreset(back, 'product-squad', 'claude').roster.map((seat) => seat.name)).toEqual([
      'Orion',
      'Ada',
      'Vega',
    ])
    expect(pickPreset(back, 'solo-builder', 'claude')).toMatchObject({ preset: 'solo-builder', step: 'preset' })
    expect(pickPreset(back, 'solo-builder', 'claude').roster.map((seat) => seat.name)).toEqual(['Orion'])
  })
})

describe('Resuming a wizard that was left unfinished (T59)', () => {
  it('opens at the stored step, with the preset, the roster edits and the goal still there', () => {
    const stored: WizardState = {
      ...at('repositories', 'full-studio'),
      goal: 'Migrate the API to Postgres',
    }
    stored.roster = updateSeat(stored.roster, stored.roster[0]!.key, { name: 'Athena', model: 'sonnet-5-fast' })

    expect(restoreWizard(stored, 'claude')).toEqual(stored)
  })

  it('starts at the Team preset step for a Company that stored nothing', () => {
    expect(restoreWizard(null, 'claude')).toEqual(wizardStart('claude'))
  })

  it('never resumes onto Company: it is step 1 and behind the wizard by the time it opens', () => {
    expect(restoreWizard(at('company'), 'claude')).toMatchObject({ step: 'preset' })
    expect(previousStep(restoreWizard(at('company'), 'claude'))).toBeNull()
  })

  it('moves a Start empty draft off Your team, the step that preset has no seats for', () => {
    expect(restoreWizard(at('team', 'start-empty'), 'claude')).toMatchObject({ step: 'repositories' })
    expect(restoreWizard(at('team', 'solo-builder'), 'claude')).toMatchObject({ step: 'team' })
  })

  it('stores what it resumes from: every step of the wizard survives the round trip', () => {
    for (const step of WIZARD_STEPS) {
      const state = { ...at(step), goal: 'Set up CI and a preview deploy' }

      // The engine keeps the state as JSON and reads it back through the same parser.
      const back = parseOnboardingDraft(JSON.parse(JSON.stringify(state)))

      expect(back).toEqual(state)
      expect(restoreWizard(back, 'claude')).toMatchObject({ preset: state.preset, goal: state.goal })
    }
  })
})

/**
 * A preset names roles and never a product (T169). On a machine that runs one CLI, every Employee
 * it proposes starts on that one — nothing here asks a CLI anything; the answers are the preflight
 * the main process already read.
 */
describe('The Provider a preset’s seats start on', () => {
  const machine = (states: Partial<Record<Provider, PreflightState>>): ProviderPreflight[] =>
    PROVIDERS.map((provider) => ({
      provider,
      state: states[provider] ?? 'missing',
      title: '',
      body: '',
      lead: '',
      commands: [],
      note: '',
      account: null,
      plan: null,
      checkedAt: '2026-09-22T09:00:00.000Z',
      hired: false,
    }))

  it('is the one this Mac can run, with that Provider’s own first model', () => {
    for (const only of PROVIDERS) {
      const provider = pickDefaultProvider(machine({ [only]: 'ready' }))
      const roster = wizardStart(provider).roster

      expect(provider, only).toBe(only)
      expect(
        roster.map((seat) => seat.model),
        only,
      ).toEqual(roster.map(() => presetModel(only)))
      // The model names the product that runs it (T139), so the seats are hired onto it.
      expect(new Set(roster.map((seat) => providerForModel(seat.model))), only).toEqual(new Set([only]))
    }
  })

  it('is the same one for a role added to the draft afterwards', () => {
    const last = PROVIDERS.at(-1)!
    const role: RoleTemplate = {
      id: 'qa',
      name: 'QA',
      persona: 'You break things.',
      capabilities: [],
      repoFilter: [],
      areas: [],
      mcpServers: [],
      skills: [],
      seeded: true,
    }

    const draft = addSeat(wizardStart(last).roster, role, 'Iris', last)

    expect(draft.at(-1)!.model).toBe(presetModel(last))
  })
})
