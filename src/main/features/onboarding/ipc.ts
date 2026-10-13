import { onboardingChannels } from '../../../shared/domain/channels'
import type { EmployeeInput } from '../../../shared/domain/staff'
import { type OnboardingFinish, parseOnboardingDraft } from '../../../shared/onboarding'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { OnboardingFacade } from './wire'

export interface OnboardingIpcOptions {
  ipc: IpcHandlerRegistry
  engine: OnboardingFacade
}

/** The setup wizard's Finish. Picks only the fields a hire may carry; the engine validates their values. */
export function registerOnboardingIpc({ ipc, engine }: OnboardingIpcOptions): void {
  ipc.handle(onboardingChannels.progress, () => attempt(() => engine.onboarding.progress()))
  ipc.handle(onboardingChannels.save, (_event, input) =>
    attempt(() => {
      const draft = parseOnboardingDraft(input)
      if (!draft) throw new Error('That is not a setup wizard step')
      engine.onboarding.save(draft)
      return null
    }),
  )
  ipc.handle(onboardingChannels.finish, (_event, input) => attempt(() => engine.onboarding.finish(finishInput(input))))
}

function finishInput(input: unknown): OnboardingFinish {
  if (!isRecord(input) || !Array.isArray(input['hires'])) throw new Error('Missing the team to hire')
  const { goal } = input
  if (goal !== null && goal !== undefined && typeof goal !== 'string') throw new Error('The goal must be text')
  return { hires: input['hires'].map(hireInput), goal: goal ?? null }
}

function hireInput(value: unknown): EmployeeInput {
  if (!isRecord(value)) throw new Error('Each hire needs a name and a role')
  const { name, roleId, model } = value
  if (typeof name !== 'string' || typeof roleId !== 'string') throw new Error('Each hire needs a name and a role')
  if (model !== undefined && model !== null && typeof model !== 'string') throw new Error('A model must be text')
  return { name, roleId, ...(model !== undefined && { model }) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
