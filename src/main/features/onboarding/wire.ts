import type { CompanyContext, OpenCompany } from '../../core'
import { createOnboarding, type Onboarding, type OnboardingCompany } from './onboarding'

/** What the wizard needs of the Company it is setting up, beyond the Company itself. */
export interface OnboardingDeps {
  /** That Company's roster, the room the wizard posts in and what it may do unasked. */
  staff(entry: OpenCompany): { roles: OnboardingCompany['roles']; employees: OnboardingCompany['employees'] }
  chat(entry: OpenCompany): OnboardingCompany['chat']
  approvals(entry: OpenCompany): { level(): OnboardingCompany['autonomy'] }
  /** Starts (or parks) the Employee the wizard just hired. */
  startSession(employeeId: string): void
  /** The wizard is finished: the Launcher and the shell redraw. */
  onFinished(): void
  log(line: string): void
}

/** The onboarding feature, once it is wired. */
export interface OnboardingFeature {
  onboarding: Onboarding
}

/**
 * Wires the first-run wizard to the Company the boss is setting up (T59, T186).
 *
 * The wizard keeps nothing per Company in memory: where it stands is a row in that Company's own
 * database, so it resumes from the database on the next launch. Everything it needs is read at the
 * moment it is asked for, so a Company switch mid-wizard is the new Company's wizard, not the old
 * one's.
 */
export function register(ctx: CompanyContext, deps: OnboardingDeps): OnboardingFeature {
  const onboarding = createOnboarding({
    current: () => {
      const entry = ctx.currentEntry()
      return {
        db: entry.db,
        roles: deps.staff(entry).roles,
        employees: deps.staff(entry).employees,
        chat: deps.chat(entry),
        autonomy: deps.approvals(entry).level(),
        start: deps.startSession,
      }
    },
    onFinished: deps.onFinished,
    log: deps.log,
  })
  return { onboarding }
}

/** The setup wizard's face. */
export interface OnboardingFacade {
  /** The current Company's setup wizard: its Finish and whether it ran. */
  onboarding: Onboarding
}
