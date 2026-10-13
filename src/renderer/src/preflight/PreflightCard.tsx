import { Check, LogIn, Monitor, RefreshCw, Search, SquareTerminal, TriangleAlert } from 'lucide-react'
import { WINDOWS_LABEL } from '../../../shared/platform/wsl'
import type { PreflightStep, ProviderPreflight } from '../../../shared/providers/preflight'
import { openSignIn } from '../sign-in'
import { Button, cx, ProviderMark } from '../ui'
import { COMMANDS, CommandRow } from './preflight-commands'
import '../ui/tailwind.css'

/*
 * The preflight card's classes (T210c), off frames `uSaf3` and `c8knu`. The card is drawn inside
 * the Launcher's window, which sets the line box to the font's own, so every size pins
 * `/[normal]` unless the stylesheet measured one — the body on 16px and the note on 15px.
 */
const CARD = 'flex w-full shrink-0 flex-col gap-14 rounded-md border border-border bg-card p-19 font-sans'
const HEAD = 'flex items-center gap-10'
const CHIP = 'flex h-30 w-30 shrink-0 items-center justify-center rounded-sm'
const CHIP_TONE: Record<string, string> = {
  warning: 'bg-status-warning text-status-warning-foreground',
  success: 'bg-status-success text-status-success-foreground',
}
const TITLE = 'm-0 text-foreground text-15/[normal] font-bold'
const BODY = 'm-0 text-muted-foreground text-13/16 font-normal'
/* The box of frame `uSaf3`, which is `muted` on a card whose own fill is `card`. */
const CARD_COMMANDS = cx(COMMANDS, 'bg-muted')
const FOOTER = 'flex items-center gap-8'
const NOTE = 'm-0 flex-[0_1_340px] text-muted-foreground text-11-5/15 font-normal'
const NOTE_BUTTON = cx(
  NOTE,
  'cursor-pointer border-0 bg-transparent p-0 text-left font-sans hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:shadow-focus focus-visible:outline-none',
)
const STEPS = 'flex flex-col gap-12'
const STEP = 'flex flex-col gap-6'
const STEP_LABEL = 'm-0 flex items-center gap-6 text-foreground text-12/[normal]'
const STEP_HINT = 'text-muted-foreground font-normal'
/* Where the app looked, in the machine's own font. */
const LOOKED_IN = 'm-0 flex items-center gap-6 font-code text-muted-foreground text-11-5/[normal]'

export interface PreflightCardProps {
  check: ProviderPreflight
  /** Whether `Check again` is out right now. */
  checking: boolean
  onRecheck(): void
  /**
   * Leaves the cards for the rest of the app. With one, the note beside `Check again` is the
   * button that keeps its own promise: the app still opens.
   */
  onDismiss?: (() => void) | undefined
  /**
   * Whether this card carries the last row — the note and `Check again`. Two Providers in trouble
   * are two cards and one check, so only the last card of a screen draws it.
   */
  footer?: boolean
}

/**
 * What one Provider's CLI on this machine cannot do, and the commands that fix it (T129, T135,
 * frame `uSaf3`): a warning chip, the product's logo and a title, the sentence, the commands one
 * per row behind a `$`, and `Check again` beside the line saying the rest of the app still opens.
 *
 * It is the card a Company's own Employees get, one per Provider they are hired on that cannot
 * run. Before the first hire there is nobody to stop and the screen draws the chooser instead
 * (`PreflightChooser`, T250).
 *
 * Every word in it is the Provider's own, written by its adapter and carried here as data — this
 * file names no product, and draws the second one exactly as it draws the first.
 */
export function PreflightCard({ check, checking, onRecheck, onDismiss, footer = true }: PreflightCardProps) {
  return (
    <section
      className={CARD}
      data-ui="Provider Status"
      data-provider={check.provider}
      data-state={check.state}
      aria-label={check.title}
    >
      <div className={HEAD}>
        <span className={cx(CHIP, CHIP_TONE[tone(check)])} aria-hidden>
          {check.state === 'ready' ? <Check size={16} /> : <TriangleAlert size={16} />}
        </span>
        {/* The product's own logo where this repo ships one, its generic mark where not. The
            chip beside it is the state, which no logo can say. */}
        <ProviderMark provider={check.provider} size={18} />
        <h2 className={TITLE}>{check.title}</h2>
      </div>
      <p className={BODY}>{check.lead ? `${check.body} ${check.lead}` : check.body}</p>
      {check.steps && check.steps.length > 0 ? (
        <div className={STEPS}>
          {check.steps.map((step) => (
            <StepRow key={`${step.label}-${step.command}`} step={step} />
          ))}
        </div>
      ) : (
        check.commands.length > 0 && (
          <div className={CARD_COMMANDS}>
            {check.commands.map((command) => (
              <CommandRow key={command} command={command} />
            ))}
          </div>
        )
      )}
      {check.lookedIn && (
        <p className={LOOKED_IN}>
          <Search size={13} aria-hidden />
          {check.lookedIn}
        </p>
      )}
      {footer && (
        <div className={FOOTER}>
          {onDismiss ? (
            <button type="button" className={NOTE_BUTTON} title="Open TinyCorp anyway" onClick={onDismiss}>
              {check.note}
            </button>
          ) : (
            <p className={NOTE}>{check.note}</p>
          )}
          {signsIn(check) && (
            <Button icon={LogIn} onClick={() => openSignIn({ provider: check.provider, accountId: null })}>
              Sign in
            </Button>
          )}
          <Button
            variant={signsIn(check) ? 'secondary' : 'primary'}
            icon={RefreshCw}
            disabled={checking}
            onClick={onRecheck}
          >
            {checking ? 'Checking…' : 'Check again'}
          </Button>
        </div>
      )}
    </section>
  )
}

/**
 * One labelled row (frame `c8knu`, T167): the place, the shell it is typed in, and the command
 * under them. A Windows with WSL has two right answers, and a row that did not say which is which
 * would have the boss paste a PowerShell line into bash.
 */
function StepRow({ step }: { step: PreflightStep }) {
  const Icon = step.kind === 'sign-in' ? LogIn : step.label === WINDOWS_LABEL ? Monitor : SquareTerminal
  return (
    <div className={STEP}>
      <p className={STEP_LABEL}>
        <Icon size={13} aria-hidden />
        <strong>{step.label}</strong>
        {step.hint && <span className={STEP_HINT}>· {step.hint}</span>}
      </p>
      <CommandRow command={step.command} prompt={step.prompt} boxed />
    </div>
  )
}

/**
 * Whether the card offers the sign-in modal (T263): a CLI that is here but signed out, or signed in
 * on a billed key. One that is not installed has nothing to sign in yet.
 */
function signsIn(check: ProviderPreflight): boolean {
  return check.state === 'signed-out' || check.state === 'warning'
}

function tone(check: ProviderPreflight): 'warning' | 'success' {
  return check.state === 'ready' ? 'success' : 'warning'
}
