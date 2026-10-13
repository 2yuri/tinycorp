import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  DoorOpen,
  Info,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { AUTONOMY_LABEL, type AutonomyLevel } from '../../../shared/approvals'
import type { Company } from '../../../shared/company'
import { type Provider, pickDefaultProvider } from '../../../shared/domain/providers'
import type { OnboardingProgress } from '../../../shared/onboarding'
import { modelLabel } from '../../../shared/staff/models'
import { employeeCount, rosterHires } from '../../../shared/staff/roster-draft'
import {
  presetChips,
  presetModel,
  seatLabel,
  TEAM_PRESETS,
  type TeamPresetId,
  teamPreset,
} from '../../../shared/staff/team-presets'
import { LogoMark } from '../brand'
import { TitleBar } from '../chrome'
import { resources, useIpcResource } from '../ipc'
import { tildePath } from '../paths'
import { useEveryProvider } from '../preflight'
import { CHOICE_INPUT, cx } from '../ui'
import { RepositoriesStep } from './RepositoriesStep'
import { canLeaveRepositories } from './repositories-step-model'
import {
  nextStep,
  pickPreset,
  previousStep,
  restoreWizard,
  STEP_TEXT,
  stepEyebrow,
  stepStatus,
  WIZARD_STEPS,
  type WizardState,
} from './wizard-model'
import '../ui/tailwind.css'
import { draftPlanner, FirstTicketStep, useCatalog } from './FirstTicketStep'
import { TeamStep } from './TeamStep'

/*
 * The Setup wizard's classes (T210c), off frame `Desktop App / Onboarding / Preset`. The window
 * sets the line box to the font's own, so every size pins `/[normal]` unless the stylesheet
 * measured one. The three sizes with no leading in the scale — 15.5, 26 — set only the size, so
 * they are written bare.
 *
 * Where a state changes a property the base already sets — the selected preset's padding and
 * border, each footer button's background — the whole list is written out per state rather than
 * layered on top: two utilities for one property come from the same layer and have no order
 * between them.
 */
const WINDOW = 'flex h-screen w-screen flex-col overflow-clip bg-background font-sans text-foreground leading-[normal]'
const BODY = 'flex min-h-0 w-full flex-1'
const SPACER = 'flex-1'
const SPACER_STRETCH = 'flex-1 self-stretch'
const RAIL = 'flex h-full w-380 shrink-0 flex-col overflow-y-auto border-r border-border bg-card p-32'
const BRAND = 'flex shrink-0 items-center gap-12 pb-24'
const MARK = 'shrink-0'
const BRAND_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const NAME = 'overflow-hidden text-ellipsis whitespace-nowrap text-foreground text-16/[normal] font-bold'
const PATH = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-muted-foreground text-11-5/[normal]'
const DIVIDER = 'h-1 shrink-0 bg-border'
/* An `ol`: the list marker and the browser's own inline padding both have to go. */
const STEPS = 'm-0 flex shrink-0 list-none flex-col gap-4 px-0 pt-22 pb-0'
const STEP = 'flex items-center gap-12 rounded-sm px-12 py-10'
const STEP_CURRENT = cx(STEP, 'bg-secondary')
const DOT =
  'flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground text-12/[normal] font-bold'
const DOT_DONE =
  'flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-transparent bg-status-success text-status-success-foreground text-12/[normal] font-bold'
const DOT_CURRENT =
  'flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-transparent bg-primary text-primary-foreground text-12/[normal] font-bold'
const STEP_TEXT_BOX = 'flex min-w-0 flex-1 flex-col gap-1'
const STEP_TITLE = 'whitespace-nowrap text-muted-foreground text-13-5/[normal] font-semibold'
const STEP_TITLE_ON = 'whitespace-nowrap text-foreground text-13-5/[normal] font-semibold'
const STEP_SUB = 'text-muted-foreground text-11-5/[normal]'
const NOTE =
  'm-0 flex shrink-0 items-center gap-10 rounded-sm bg-card p-14 text-muted-foreground text-11-5/17 [&_svg]:shrink-0'
const MAIN = 'flex h-full min-w-0 flex-1 flex-col overflow-y-auto px-44 py-36'
/* The First ticket step centres a 720 column between two spacers. */
const MAIN_CENTRED = cx(MAIN, 'items-center')
const HEAD = 'flex shrink-0 flex-col gap-6 pb-26'
const HEAD_CENTRED = 'flex w-720 max-w-full shrink-0 flex-col items-center gap-8 pb-24 text-center'
const EYEBROW = 'text-muted-foreground text-11/[normal] font-bold tracking-[0.8px]'
const TITLE = 'm-0 text-heading-ink text-26 font-bold tracking-[-0.6px]'
const SUB = 'm-0 text-muted-foreground text-13-5/20'
const ERROR = 'm-0 shrink-0 pt-12 text-destructive text-12-5/[normal]'
const ERROR_CENTRED = 'm-0 shrink-0 self-stretch pt-12 text-destructive text-12-5/[normal]'
const FOOTER = 'flex shrink-0 items-center gap-10 pt-20'
const FOOTER_CENTRED = 'flex shrink-0 items-center gap-10 self-stretch pt-20'
const PRESETS = 'grid shrink-0 grid-cols-2 items-start gap-16'
const PRESET_BASE =
  'm-0 flex cursor-pointer flex-col gap-12 rounded-md bg-card text-left font-sans text-[length:inherit] text-inherit has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none'
const PRESET = cx(PRESET_BASE, 'border border-border p-19')
/* Selected takes a 2px border, and gives the extra pixel back from the padding. */
const PRESET_ON = cx(PRESET_BASE, 'border-2 border-primary p-18')
const PRESET_TOP = 'flex w-full items-center gap-12'
const TILE = 'flex h-36 w-36 shrink-0 items-center justify-center rounded-sm'
const TILE_MUTED = 'bg-card text-muted-foreground'
const TILE_TONE: Record<string, string> = {
  primary: 'bg-primary-subtle text-status-info-foreground',
  success: 'bg-status-success text-status-success-foreground',
}
const PRESET_NAME = 'flex-1 text-foreground text-15-5 font-bold'
const SELECTED_PILL =
  'flex shrink-0 items-center gap-5 rounded-full bg-primary px-10 py-4 text-primary-foreground text-11/[normal] font-semibold'
const PRESET_DESC = 'text-muted-foreground text-12-5/19'
const ROLES = 'flex flex-wrap items-center gap-7'
const CHIP = 'rounded-full bg-secondary px-10 py-5 whitespace-nowrap text-soft-ink text-11-5/[normal] font-semibold'
const PRESET_DIVIDER = 'h-1 w-full bg-border'
const SEATS = 'text-soft-ink text-12/[normal] font-semibold'
const DEFAULTS =
  'm-0 flex shrink-0 items-center gap-12 rounded-sm bg-card px-16 py-12 text-muted-foreground text-12/[normal] [&_svg]:shrink-0 [&_svg]:text-soft-ink'
const BUTTON =
  'm-0 flex shrink-0 cursor-pointer items-center justify-center gap-8 rounded-sm font-sans text-13-5/[normal] font-semibold whitespace-nowrap focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:opacity-50'
const BUTTON_SKIP = cx(BUTTON, 'border-0 bg-transparent px-14 py-9 text-muted-foreground hover:text-foreground')
const BUTTON_BACK = cx(
  BUTTON,
  'border border-border bg-transparent px-16 py-8 text-heading-ink [&:hover:not(:disabled)]:bg-card',
)
const BUTTON_CONTINUE = cx(
  BUTTON,
  'border-0 bg-primary px-18 py-9 text-primary-foreground shadow-button-primary hover:bg-primary-hover',
)

/** The title bar over the wizard. */
export function setupTitle(companyName: string): string {
  return `${companyName} — Setup`
}

const PRESET_ICON: Record<TeamPresetId, { icon: LucideIcon; tone: string }> = {
  'solo-builder': { icon: User, tone: 'plain' },
  'product-squad': { icon: Users, tone: 'primary' },
  'full-studio': { icon: Building2, tone: 'success' },
  'start-empty': { icon: SlidersHorizontal, tone: 'plain' },
}

function stepHead(
  { step, preset: presetId, roster }: WizardState,
  planner: string | null,
): { title: string; sub: string } {
  const preset = teamPreset(presetId)
  switch (step) {
    case 'preset':
      return {
        title: 'How should the office start?',
        sub: 'Pick a shape for the team. Every preset is just a starting roster — you can hire, fire and retune anyone later.',
      }
    case 'team':
      return {
        title: 'Your starting team',
        sub: `${employeeCount(roster.length)} from the ${preset.name} preset. Rename them, swap models or drop anyone you do not want yet.`,
      }
    case 'repositories':
      return {
        title: 'Which repositories can they touch?',
        sub: 'Employees only work inside repos you connect. Tell them what each one is; checks are optional and detected when possible.',
      }
    case 'first-ticket':
      return {
        title: 'Give them something to build',
        sub: `Describe the outcome in a sentence. ${planner ?? 'Your team'} breaks it into tickets, the board fills up and the office starts moving.`,
      }
    case 'company':
      return STEP_TEXT.company
  }
}

export interface SetupWizardViewProps {
  company: Company
  state: WizardState
  /** The Provider a seat starts on, named in the Team preset step's defaults line (T169). */
  provider: Provider
  /** The Company's autonomy level, or null while it loads. */
  autonomy: AutonomyLevel | null
  onPreset(preset: TeamPresetId): void
  onBack(): void
  onContinue(): void
  onSkip(): void
  /** Continue waits, e.g. on the Repositories step until a repo is connected. */
  continueDisabled?: boolean
  /** The draft's intake holder, named in the First ticket step's head. */
  planner?: string | null
  /** Why Finish failed, shown over the footer. */
  error?: string | null
  /** The step's own content, for the steps other modules draw; the Team preset step is drawn here. */
  children?: ReactNode
}

/** The setup wizard (design/html/onboarding-preset.html, frame `Desktop App / Onboarding / Preset`). */
export function SetupWizardView(props: SetupWizardViewProps) {
  const { company, state } = props
  const head = stepHead(state, props.planner ?? null)
  const last = nextStep(state) === null
  // The First ticket step centres one column between two spacers.
  const centred = state.step === 'first-ticket'
  return (
    <div className={WINDOW} data-pencil-name="Desktop App / Onboarding">
      <TitleBar title={setupTitle(company.name)} onToggleMaximize={() => void window.tinyCorp.shell.toggleMaximize()} />
      <div className={BODY}>
        <aside className={RAIL}>
          <div className={BRAND}>
            <LogoMark size={40} className={MARK} />
            <div className={BRAND_TEXT}>
              <span className={NAME}>{company.name}</span>
              <span className={PATH} title={company.folder}>
                {tildePath(company.folder)}
              </span>
            </div>
          </div>
          <div className={DIVIDER} />
          <ol className={STEPS} aria-label="Setup steps">
            {WIZARD_STEPS.map((step, index) => {
              const status = stepStatus(step, state.step)
              return (
                <li
                  key={step}
                  className={status === 'current' ? STEP_CURRENT : STEP}
                  // What `is-${status}` used to say in the class name.
                  data-status={status}
                  aria-current={status === 'current' ? 'step' : undefined}
                >
                  <span className={status === 'done' ? DOT_DONE : status === 'current' ? DOT_CURRENT : DOT}>
                    {status === 'done' ? <Check size={13} aria-label="Done" /> : index + 1}
                  </span>
                  <span className={STEP_TEXT_BOX}>
                    <span className={status === 'todo' ? STEP_TITLE : STEP_TITLE_ON}>{STEP_TEXT[step].title}</span>
                    <span className={STEP_SUB}>{STEP_TEXT[step].sub}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className={SPACER} />
          <p className={NOTE}>
            <Info size={15} aria-hidden />
            <span>Nothing here is permanent — hire, fire and retune from Company settings.</span>
          </p>
        </aside>

        <main className={centred ? MAIN_CENTRED : MAIN} data-centred={centred || undefined}>
          {centred && <div className={SPACER_STRETCH} />}
          <header className={centred ? HEAD_CENTRED : HEAD}>
            <span className={EYEBROW}>{stepEyebrow(state.step)}</span>
            <h1 className={TITLE}>{head.title}</h1>
            <p className={SUB}>{head.sub}</p>
          </header>

          {state.step === 'preset' ? (
            <PresetStep
              selected={state.preset}
              autonomy={props.autonomy}
              provider={props.provider}
              onPick={props.onPreset}
            />
          ) : (
            props.children
          )}

          <div className={centred ? SPACER_STRETCH : SPACER} />
          {props.error && (
            <p className={centred ? ERROR_CENTRED : ERROR} role="alert">
              {props.error}
            </p>
          )}
          <footer className={centred ? FOOTER_CENTRED : FOOTER}>
            {!last && (
              <button type="button" className={BUTTON_SKIP} data-action="skip" onClick={props.onSkip}>
                Skip setup
              </button>
            )}
            <div className={SPACER} />
            <button
              type="button"
              className={BUTTON_BACK}
              data-action="back"
              disabled={previousStep(state) === null}
              onClick={props.onBack}
            >
              <ChevronLeft size={15} aria-hidden />
              Back
            </button>
            <button
              type="button"
              className={BUTTON_CONTINUE}
              data-action="continue"
              disabled={props.continueDisabled}
              onClick={props.onContinue}
            >
              {last ? <DoorOpen size={15} aria-hidden /> : <ArrowRight size={15} aria-hidden />}
              {last ? 'Open the office' : 'Continue'}
            </button>
          </footer>
        </main>
      </div>
    </div>
  )
}

function PresetStep(props: {
  selected: TeamPresetId
  autonomy: AutonomyLevel | null
  /** The Provider every seat this preset proposes starts on: what this Mac is ready to run (T169). */
  provider: Provider
  onPick(id: TeamPresetId): void
}) {
  const name = useId()
  return (
    <>
      <div className={PRESETS} role="radiogroup" aria-label="Team preset">
        {TEAM_PRESETS.map((preset) => {
          const selected = preset.id === props.selected
          const { icon: Icon, tone } = PRESET_ICON[preset.id]
          // Read out of the `cx` call: a bare `'primary'` inside one is a class list as far as
          // `tailwind.test.ts` is concerned, and a tone name is not a class.
          const toneClasses = TILE_TONE[selected ? 'primary' : tone] ?? TILE_MUTED
          return (
            <label key={preset.id} className={selected ? PRESET_ON : PRESET} data-selected={selected || undefined}>
              <input
                type="radio"
                className={CHOICE_INPUT}
                name={name}
                checked={selected}
                onChange={() => props.onPick(preset.id)}
              />
              <span className={PRESET_TOP}>
                <span className={cx(TILE, toneClasses)}>
                  <Icon size={18} aria-hidden />
                </span>
                <span className={PRESET_NAME}>{preset.name}</span>
                {selected && (
                  <span className={SELECTED_PILL}>
                    <Check size={12} aria-hidden />
                    Selected
                  </span>
                )}
              </span>
              <span className={PRESET_DESC}>{preset.description}</span>
              <span className={ROLES}>
                {presetChips(preset).map((chip) => (
                  <span key={chip} className={CHIP}>
                    {chip}
                  </span>
                ))}
              </span>
              <span className={PRESET_DIVIDER} />
              <span className={SEATS}>{seatLabel(preset)}</span>
            </label>
          )
        })}
      </div>
      <p className={DEFAULTS}>
        <Sparkles size={15} aria-hidden />
        <span>
          {`Everyone starts on your company defaults — ${modelLabel(props.provider, presetModel(props.provider))}`}
          {props.autonomy ? `, ${AUTONOMY_LABEL[props.autonomy]} autonomy` : ''}. You tune each one in the next step.
        </span>
      </p>
    </>
  )
}

export interface SetupWizardProps {
  company: Company
  /** Where this Company's wizard was left: a reopened one comes back to the same step (T59). */
  progress: OnboardingProgress
  /** Leaves the wizard for the Company's Office, once Finish (or Skip setup) has marked it done. */
  onLeave(): void
}

/**
 * The wizard bound to the engine. It runs once, after Create Company (decision 39) — but not
 * necessarily in one sitting: every change is stored, so closing the app mid-setup and opening the
 * Company again comes back to the step it was left on (T59).
 */
export function SetupWizard(props: SetupWizardProps) {
  // The roster is built once, from what this Mac holds (T169). Until the preflight answers are
  // across the bridge there is no honest default to build it on, so the wizard waits rather than
  // propose four Employees on a product the boss does not have and swap it under them.
  const preflight = useEveryProvider()
  if (preflight === null) return null
  return <BoundWizard {...props} provider={pickDefaultProvider(preflight)} />
}

function BoundWizard({ company, progress, onLeave, provider }: SetupWizardProps & { provider: Provider }) {
  const api = window.tinyCorp
  const [state, setState] = useState<WizardState>(() => restoreWizard(progress.draft, provider))
  const autonomy = useIpcResource(resources.autonomy)
  const [connectedRepos, setConnectedRepos] = useState(0)
  // The Repositories step adds nothing until Continue, so the wizard holds what Continue will do.
  const [pendingRepos, setPendingRepos] = useState<{ count: number; commit(): Promise<void> }>({
    count: 0,
    commit: () => Promise.resolve(),
  })
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalog = useCatalog()

  // Every step, preset, roster edit and keystroke of the goal, kept for the next launch. Storing is
  // the engine's business: the wizard never waits on it and a failed write only costs the resume.
  useEffect(() => {
    void api.onboarding.save(state)
  }, [state])

  /** Finish: hires, starts Sessions and hands the goal over; skipping hires nobody. */
  async function finish(input: { hire: boolean; goal: string | null }) {
    if (finishing) return
    setFinishing(true)
    const result = await api.onboarding.finish({
      hires: input.hire ? rosterHires(state.roster) : [],
      goal: input.goal,
    })
    setFinishing(false)
    if (result.ok) return onLeave()
    // Skipping a wizard that was already finished still leaves it.
    if (!input.hire) return onLeave()
    setError(result.error)
  }

  const onFirstTicket = state.step === 'first-ticket'
  return (
    <SetupWizardView
      company={company}
      state={state}
      provider={provider}
      autonomy={autonomy}
      planner={draftPlanner(state.roster, catalog)}
      error={error}
      onPreset={(preset) => setState((before) => pickPreset(before, preset, provider))}
      onBack={() => {
        const previous = previousStep(state)
        if (previous) setState({ ...state, step: previous })
      }}
      onContinue={() =>
        void (async () => {
          if (state.step === 'repositories' && pendingRepos.count > 0) {
            try {
              await pendingRepos.commit()
            } catch (caught) {
              return setError(caught instanceof Error ? caught.message : String(caught))
            }
            setError(null)
          }
          const next = nextStep(state)
          if (next) setState({ ...state, step: next })
          else await finish({ hire: true, goal: state.goal })
        })()
      }
      onSkip={() => void finish({ hire: false, goal: null })}
      continueDisabled={
        finishing ||
        (state.step === 'repositories' && !canLeaveRepositories(connectedRepos, pendingRepos.count)) ||
        (onFirstTicket && !state.goal.trim())
      }
    >
      {state.step === 'team' && (
        <TeamStep
          roster={state.roster}
          autonomy={autonomy}
          provider={provider}
          onRoster={(update) => setState((before) => ({ ...before, roster: update(before.roster) }))}
        />
      )}
      {state.step === 'repositories' && (
        <RepositoriesStep company={company} onConnectedChange={setConnectedRepos} onPending={setPendingRepos} />
      )}
      {onFirstTicket && (
        <FirstTicketStep
          goal={state.goal}
          onGoal={(goal) => setState((before) => ({ ...before, goal }))}
          roster={state.roster}
          busy={finishing}
          onEmptyBoard={() => void finish({ hire: true, goal: null })}
        />
      )}
    </SetupWizardView>
  )
}
