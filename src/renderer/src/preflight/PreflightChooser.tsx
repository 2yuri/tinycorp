import { ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react'
import { useId, useState } from 'react'
import type { Boss } from '../../../shared/boss-profile'
import { PROVIDER_LABEL, type Provider, pickDefaultProvider } from '../../../shared/domain/providers'
import { type ProviderRuntime, parseRuntimeKey, sameRuntime } from '../../../shared/platform/wsl'
import type { PreflightState, PreflightStep, ProviderPreflight } from '../../../shared/providers/preflight'
import { Badge, Button, cx, ProviderMark, SegmentedControl, SHELL_BUTTON } from '../ui'
import { CommandBox } from './preflight-commands'
import '../ui/tailwind.css'

/*
 * The chooser's classes (T250), off frames `KB9AX` and `c8knu`. Written inside the Launcher's
 * window, which sets the line box to the font's own, so every size pins `/[normal]` unless the
 * stylesheet measured one.
 *
 * The two row fills are the frame's: an open row is `muted` behind a 1.5px `primary` stroke, a
 * closed one is nothing behind a 1px `border`. Their paddings differ by the half pixel their
 * strokes differ by, because the frame measures both from the row's outer edge and the content of
 * three stacked rows has to line up whichever one is open.
 */
const CARD = 'flex w-full shrink-0 flex-col gap-14 rounded-md border border-border bg-card p-19 font-sans'
const HEAD = 'flex flex-col gap-6'
const TITLE = 'm-0 text-foreground text-15/[normal] font-bold'
const SUB = 'm-0 text-muted-foreground text-13/16 font-normal'
const ROWS = 'flex flex-col gap-8'
const ROW = 'flex flex-col gap-12 rounded-md'
/* The open row's own rows, at the same 12 the header sits above them at. A `section` and not
 * a `div role="region"`: the element whose role carries the meaning is what the a11y rules ask
 * for, and it is what this repo writes everywhere else. */
const PANEL = 'flex flex-col gap-12'
const ROW_OPEN = 'border-[1.5px] border-primary bg-muted px-[12.5px] py-[10.5px]'
const ROW_CLOSED = 'border border-border bg-transparent px-13 py-11'
const ROW_HEAD = cx(SHELL_BUTTON, 'flex w-full items-center gap-10 p-0 font-sans focus-visible:rounded-sm')
const ROW_NAME = 'm-0 flex-1 truncate text-foreground text-13-5/[normal] font-bold'
const LEAD = 'm-0 text-muted-foreground text-13/16 font-normal'
/* Where the app looked, in the machine's own font. */
const LOOKED_IN = 'm-0 flex items-center gap-6 font-code text-muted-foreground text-11/[normal]'
const FOOTER = 'flex items-center gap-8'
const NOTE = 'm-0 flex-[0_1_340px] text-muted-foreground text-11-5/15 font-normal'
const NOTE_BUTTON = cx(
  NOTE,
  'cursor-pointer border-0 bg-transparent p-0 text-left font-sans hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:shadow-focus focus-visible:outline-none',
)
/* The segmented control of frame `c8knu`: its own track and option, the kit's own two states. */
const SEGMENTS = 'flex h-36 items-center gap-3 rounded-sm border border-border bg-muted p-3'
const SEGMENT =
  'inline-flex h-28 flex-[1_1_0] cursor-pointer items-center justify-center gap-6 rounded-sm border-0 font-sans text-12-5/[inherit]'

/** The head of the card: what the boss has to do, and that one of the three is enough. */
export const CHOOSER_TITLE = 'Set up a coding agent to start'
export const CHOOSER_SUB = 'One is enough: set up the one you pay for, and add the others any time.'

/**
 * The state in the badge's two words (frame `KB9AX`).
 *
 * A row is only ever drawn for a state that stops an Employee, and there are two of those: the CLI
 * is not here, or nobody is signed into it. Neither word names a product, because neither fact is
 * one.
 */
export function stateWord(state: PreflightState): string {
  return state === 'missing' ? 'Not installed' : 'Not signed in'
}

/**
 * One place a CLI can be installed, as the segmented control offers it (frame `c8knu`, T250).
 *
 * T167 drew every place at once, stacked and labelled. Three Providers of that do not fit the
 * 740px window, so the open row offers the places and draws one — which is the same answer, in the
 * room there is.
 */
export interface PreflightPlace {
  /** `Windows · PowerShell`, `WSL · Ubuntu · bash` — the segment's own label. */
  label: string
  /** Where this segment installs into, which is what the boss's own pick is matched against. */
  runtime: ProviderRuntime
  /** What that place's shell draws: `>` in PowerShell, `$` in a Linux one. */
  prompt: string
  /** Install, and then sign in, both typed in this place and behind {@link prompt}. */
  commands: string[]
}

/**
 * The places out of one Provider's steps: one per install row, each carrying the one sign-in row
 * after it, because the login belongs to the installation and not to the machine.
 *
 * Empty for a machine with one place — a Mac, a Linux desktop, a Windows with no WSL — where the
 * adapter writes no steps at all and the row draws its lead and its commands as it always has.
 */
export function preflightPlaces(steps: readonly PreflightStep[] | undefined): PreflightPlace[] {
  const rows = steps ?? []
  const signIn = rows.find((step) => step.kind === 'sign-in')
  return rows.flatMap((step) =>
    step.kind === 'install' && step.runtime
      ? [
          {
            label: step.hint ? `${step.label} · ${step.hint}` : step.label,
            runtime: step.runtime,
            prompt: step.prompt,
            commands: [step.command, ...(signIn ? [signIn.command] : [])],
          },
        ]
      : [],
  )
}

/**
 * Which segment the open row starts on.
 *
 * It is `chooseRuntime`'s own order and for its own reason: the place the boss picked for this
 * Provider in Your profile, then the one they picked for the team on the first launch (T249), and
 * each of them only while this machine still offers it — a segment naming a place that is not
 * there is a command the boss cannot type.
 *
 * **The last resort is not `chooseRuntime`'s.** That one prefers Windows for a boss who has chosen
 * nothing at all, because a Session that can start on the machine the app runs on has no distro to
 * wake and no path to translate — and a boss who *has* chosen is never moved off their place at all
 * (T258), which is why a card with one segment on it is a card about that place. This
 * screen is the other question — where the boss is going to *install* something — and a machine
 * with a distro on it is a machine whose boss went to the trouble of installing one, which is
 * where their toolchain is.
 */
export function defaultPlace(
  places: readonly PreflightPlace[],
  picked: ProviderRuntime | null = null,
  teamDefault: ProviderRuntime | null = null,
): number {
  const offered = (runtime: ProviderRuntime | null) =>
    runtime ? places.findIndex((place) => sameRuntime(place.runtime, runtime)) : -1
  const wsl = () => places.findIndex((place) => place.runtime.kind === 'wsl')
  const found = [offered(picked), offered(teamDefault), wsl(), 0].find((index) => index !== -1)
  return found ?? 0
}

/**
 * The row that starts open: the Provider closest to working — the first that is merely signed out,
 * else the catalogue's first. It is {@link pickDefaultProvider}'s own order, and it is the same
 * question, so it is the same answer rather than a second rule that could drift from it.
 */
export function firstOpenProvider(blocked: readonly ProviderPreflight[]): Provider | null {
  const picked = pickDefaultProvider(blocked)
  return (blocked.find((check) => check.provider === picked) ?? blocked[0])?.provider ?? null
}

export interface PreflightChooserProps {
  /** Every Provider there is, all of them blocked, in catalogue order. */
  blocked: readonly ProviderPreflight[]
  /**
   * The boss's own profile, for where they said the team runs (T249). Null before it is read, and
   * on a machine that never asked — a Mac has one place and none of this shows.
   */
  boss: Boss | null
  checking: boolean
  onRecheck(): void
  onDismiss?: (() => void) | undefined
}

/**
 * One card with a row per Provider, when no CLI on this machine can run an Employee and nobody is
 * hired on any of them yet (T250, frames `KB9AX` and `c8knu`).
 *
 * Three full cards is what this used to be, and it read as three errors stacked in a scroller when
 * the boss has exactly one thing to do: set up a coding agent, any of them. So the rows are an
 * accordion with one open — the one closest to working — and the boss opens another when the one
 * they pay for is not it.
 *
 * Every word in the open row is the Provider's own, written by its adapter and carried here as
 * data; this file names no product.
 */
export function PreflightChooser({ blocked, boss, checking, onRecheck, onDismiss }: PreflightChooserProps) {
  const [open, setOpen] = useState<Provider | null>(() => firstOpenProvider(blocked))
  /** Null while the boss has not picked a place: whichever segment the open row's own default is. */
  const [place, setPlace] = useState<number | null>(null)
  const ids = useId()

  return (
    <section className={CARD} data-ui="Choose a Provider" aria-label={CHOOSER_TITLE}>
      <div className={HEAD}>
        <h2 className={TITLE}>{CHOOSER_TITLE}</h2>
        <p className={SUB}>{CHOOSER_SUB}</p>
      </div>
      <div className={ROWS}>
        {blocked.map((check) => (
          <ProviderRow
            key={check.provider}
            check={check}
            open={check.provider === open}
            id={`${ids}-${check.provider}`}
            place={place}
            picked={parseRuntimeKey(boss?.providerRuntimes[check.provider])}
            teamDefault={parseRuntimeKey(boss?.defaultRuntime)}
            onOpen={() => {
              setOpen(check.provider)
              setPlace(null)
            }}
            onPlace={setPlace}
          />
        ))}
      </div>
      <div className={FOOTER}>
        {onDismiss ? (
          <button type="button" className={NOTE_BUTTON} title="Open TinyCorp anyway" onClick={onDismiss}>
            {note(blocked)}
          </button>
        ) : (
          <p className={NOTE}>{note(blocked)}</p>
        )}
        <Button icon={RefreshCw} disabled={checking} onClick={onRecheck}>
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      </div>
    </section>
  )
}

/** The promise beside `Check again`. Every blocked answer carries the same line, so the first will do. */
function note(blocked: readonly ProviderPreflight[]): string {
  return blocked[0]?.note ?? ''
}

interface ProviderRowProps {
  check: ProviderPreflight
  open: boolean
  /** The prefix the header and its panel are named by, so the panel says which row it belongs to. */
  id: string
  /** The segment the boss picked here and now, or null for this row's own default. */
  place: number | null
  /** Where the boss put this Provider in Your profile, and where they put the team (T249). */
  picked: ProviderRuntime | null
  teamDefault: ProviderRuntime | null
  onOpen(): void
  onPlace(place: number): void
}

/** One Provider's row: its logo and name, the state, and — while it is open — what to type. */
function ProviderRow({ check, open, id, place, picked, teamDefault, onOpen, onPlace }: ProviderRowProps) {
  const places = preflightPlaces(check.steps)
  const chosen = places[place ?? defaultPlace(places, picked, teamDefault)] ?? places[0]
  const Chevron = open ? ChevronUp : ChevronDown
  return (
    <div
      className={cx(ROW, open ? ROW_OPEN : ROW_CLOSED)}
      data-ui="Provider Row"
      data-provider={check.provider}
      data-state={check.state}
    >
      <button
        type="button"
        id={`${id}-header`}
        className={ROW_HEAD}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onOpen}
      >
        <ProviderMark provider={check.provider} size={20} />
        <span className={ROW_NAME}>{PROVIDER_LABEL[check.provider]}</span>
        <Badge variant="warning">{stateWord(check.state)}</Badge>
        <Chevron size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <section id={`${id}-panel`} className={PANEL} aria-labelledby={`${id}-header`}>
          {chosen ? (
            <>
              {/* One place is not a choice: a machine with no WSL gets the commands and no track. */}
              {places.length > 1 && (
                <SegmentedControl
                  label="Where to install it"
                  value={places.indexOf(chosen)}
                  options={places.map((one, index) => ({ value: index, label: one.label }))}
                  onChange={onPlace}
                  classes={{ track: SEGMENTS, option: SEGMENT }}
                />
              )}
              <CommandBox commands={chosen.commands} prompt={chosen.prompt} className="bg-background" />
            </>
          ) : (
            <>
              {check.lead && <p className={LEAD}>{check.lead}</p>}
              <CommandBox commands={check.commands} className="bg-background" />
            </>
          )}
          {check.lookedIn && (
            <p className={LOOKED_IN}>
              <Search size={12} aria-hidden />
              {check.lookedIn}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
