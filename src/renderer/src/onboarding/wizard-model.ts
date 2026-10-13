import type { Provider } from '../../../shared/domain/providers'
import { type OnboardingDraft, WIZARD_STEPS, type WizardStep } from '../../../shared/onboarding'
import { rosterFromPreset } from '../../../shared/staff/roster-draft'
import { DEFAULT_PRESET, type TeamPresetId, teamPreset } from '../../../shared/staff/team-presets'

// The steps are stored, so the engine and the wizard read one list (T59).
export { WIZARD_STEPS, type WizardStep }

export const STEP_TEXT: Record<WizardStep, { title: string; sub: string }> = {
  company: { title: 'Company', sub: 'Named and pointed at a folder' },
  preset: { title: 'Team preset', sub: 'Pick the shape of the office' },
  team: { title: 'Your team', sub: 'Names and models' },
  repositories: { title: 'Repositories', sub: 'Where the work actually happens' },
  'first-ticket': { title: 'First ticket', sub: 'Give them something to build' },
}

export type StepStatus = 'done' | 'current' | 'todo'

/**
 * Everything the wizard holds between steps — and everything the engine stores for it, so a boss
 * who closes the app mid-setup comes back to the step they were on (T59).
 */
export type WizardState = OnboardingDraft

/**
 * Where the wizard opens: Create Company (step 1) is behind it, the Team preset step is next.
 *
 * `provider` is what this Mac is ready to run (T169). The wizard waits for that answer before it
 * builds a roster, so no seat is ever proposed on a product the boss does not have and then
 * quietly swapped under them.
 */
export function wizardStart(provider: Provider): WizardState {
  return {
    step: 'preset',
    preset: DEFAULT_PRESET,
    roster: rosterFromPreset(teamPreset(DEFAULT_PRESET), provider),
    goal: '',
  }
}

/**
 * The state a stored draft reopens on. Anything the wizard cannot stand on is nudged forward rather
 * than refused: it is a saved step, not an instruction, and a boss must never be stuck on a step
 * whose Back and Continue lead nowhere.
 */
export function restoreWizard(draft: OnboardingDraft | null, provider: Provider): WizardState {
  if (!draft) return wizardStart(provider)
  // Company is step 1 and behind the wizard: it is already created by the time the wizard opens.
  if (draft.step === 'company') return { ...draft, step: 'preset' }
  // `Start empty` hires nobody, so Your team is not one of its steps.
  if (draft.step === 'team' && draft.preset === 'start-empty') return { ...draft, step: 'repositories' }
  return draft
}

/** Picking another preset starts its roster again; picking the same one keeps the edits. */
export function pickPreset(state: WizardState, preset: TeamPresetId, provider: Provider): WizardState {
  if (preset === state.preset) return state
  return { ...state, preset, roster: rosterFromPreset(teamPreset(preset), provider) }
}

/** `STEP 2 OF 5`. */
export function stepEyebrow(step: WizardStep): string {
  return `STEP ${WIZARD_STEPS.indexOf(step) + 1} OF ${WIZARD_STEPS.length}`
}

/** Steps before the current one are done, including one skipped over. */
export function stepStatus(step: WizardStep, current: WizardStep): StepStatus {
  const at = WIZARD_STEPS.indexOf(step)
  const now = WIZARD_STEPS.indexOf(current)
  return at < now ? 'done' : at === now ? 'current' : 'todo'
}

/** The step Continue opens; `Start empty` has nobody to name, so it skips Your team. Null after the last step. */
export function nextStep(state: WizardState): WizardStep | null {
  if (state.step === 'preset' && state.preset === 'start-empty') return 'repositories'
  return WIZARD_STEPS[WIZARD_STEPS.indexOf(state.step) + 1] ?? null
}

/** The step Back opens; null on the first step the wizard shows, as the Company is already created. */
export function previousStep(state: WizardState): WizardStep | null {
  if (state.step === 'repositories' && state.preset === 'start-empty') return 'preset'
  const previous = WIZARD_STEPS[WIZARD_STEPS.indexOf(state.step) - 1]
  return previous && previous !== 'company' ? previous : null
}
