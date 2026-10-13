import type { SignInStep } from '../../../shared/domain/providers'
import type { SignInState } from '../../../shared/usage/sign-in'

/** How one step is drawn: ticked, highlighted, or still ahead (frames `Tmldc`, `iA8Wm`). */
export type StepMark = 'done' | 'current' | 'todo'

/**
 * Each step's mark for where the sign-in stands. Every step is ticked once the login appeared; a
 * terminal that closed without one leaves the steps where they were, which is where it stopped.
 */
export function stepMarks(steps: readonly SignInStep[], state: SignInState, lastStep: number): StepMark[] {
  if (state.phase === 'signed-in') return steps.map(() => 'done')
  const at = state.phase === 'waiting' ? state.step : lastStep
  return steps.map((_, index) => (index < at ? 'done' : index === at ? 'current' : 'todo'))
}
