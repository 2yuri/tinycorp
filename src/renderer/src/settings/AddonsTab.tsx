import {
  Code,
  Copy,
  Feather,
  FileCog,
  FolderGit2,
  GitPullRequest,
  Globe,
  House,
  KeyRound,
  type LucideIcon,
  MessageSquareText,
  RefreshCw,
  Search as SearchIcon,
  Shield,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import {
  type BuildStyle,
  LEAN_LADDER,
  LEAN_MEASURED,
  LEAN_MEASURED_CAVEAT,
  LEAN_NEVER_CUT,
} from '../../../shared/build-style'
import {
  CAVEMAN_CARD_RULES,
  CAVEMAN_EXAMPLE,
  CAVEMAN_HINT,
  CAVEMAN_INTENSITIES,
  CAVEMAN_LABEL,
  type CavemanIntensity,
  type CavemanLevel,
  cavemanMeasuredBlock,
  DEFAULT_CAVEMAN_INTENSITY,
  isCavemanIntensity,
} from '../../../shared/caveman'
import { inMachineWords } from '../../../shared/platform/machine-words'
import {
  SANDBOX_DESCRIPTION,
  SANDBOX_FOOT,
  SANDBOX_NAME,
  SANDBOX_NETWORK_STATE,
  SANDBOX_NETWORK_WHY,
  SANDBOX_ON_WINDOWS,
  SANDBOX_REACH,
  SANDBOX_SOURCE,
  SANDBOX_WHERE_LABEL,
  sandboxStatusWords,
  sandboxToggleEnabled,
} from '../../../shared/sandbox'
import type { SandboxView } from '../../../shared/sandbox/ipc'
import { hostPlatform } from '../chrome'
import { refreshIpcResource, resources } from '../ipc'
import { Badge, cx, Search, SegmentedControl, Toggle } from '../ui'
import '../ui/tailwind.css'
import { AppliesNextSession } from './AppliesNextSession'

const api = window.tinyCorp

/**
 * The kit's Search is a 40px pill; the frame draws this one as a 36px rounded field, because it
 * sits over a list of cards rather than in a filter bar (T206).
 *
 * The reach is an arbitrary variant, because a utility only styles the element that carries it, and
 * it names the part by the `data-slot` the kit puts there (T216) — a two-part selector, so it beats
 * the component's own one-class utility. The focused padding is written out beside the resting one
 * for the same reason the other way round: `focus-within:px-12` inside the kit is *also* a two-part
 * selector, so there the two weigh the same and only the last one stated wins.
 *
 * It took two more things until T216 and one more until T208: `\_` for each BEM underscore and a
 * `String.raw` template to keep it out of the runtime value, and before that an `!` on each one,
 * because every stylesheet was unlayered. None of the three is left.
 */
const SEARCH_FIELD =
  'grow-0 basis-420 [&_[data-slot=field-control]]:h-36 [&_[data-slot=field-control]]:rounded-sm [&_[data-slot=field-control]]:p-[0_13px] [&_[data-slot=field-control]]:focus-within:p-[0_13px]'

/** One add-on, as the list draws it and the search reads it. */
interface Addon {
  id: string
  name: string
  /** The pill beside the name: where the idea came from, and under what licence. */
  source: string
  description: string
  icon: LucideIcon
  on: boolean
  toggle(on: boolean): void
  /**
   * Why this add-on cannot be turned on yet, or null when it can. An add-on with no benchmark
   * behind it is offered and disabled rather than left out: the boss can read what it would do and
   * see that nobody has measured it (T261).
   */
  blocked?: string | null
  /** What the card shows under its head: this add-on's own panels. */
  body: ReactNode
}

/**
 * Add-ons (frames `ttODp` and `U8MYE`): the optional ways of working a Company can turn on, as a
 * searchable list with one card each.
 *
 * There are two — Lean builder (T194) and Caveman (T261). It is a list rather than a card because
 * a further add-on should be one more entry here and nothing else, and it is searchable for the
 * same reason.
 *
 * Every card saves as it changes, like the cards on Tokens: flipping an add-on is not a draft, and
 * it only takes at the next Session start anyway, so there is nothing to undo before then.
 */
export function AddonsTab() {
  const [style, setStyle] = useState<BuildStyle | null>(null)
  const [caveman, setCaveman] = useState<CavemanLevel | null>(null)
  /**
   * Which intensity the toggle would turn on. It is the card's own and not the engine's, because
   * an add-on that is off holds no intensity: writing one to settle the control would turn the
   * add-on on, which is the one thing the boss did not ask for.
   */
  const [intensity, setIntensity] = useState<CavemanIntensity>(DEFAULT_CAVEMAN_INTENSITY)
  const [sandbox, setSandbox] = useState<SandboxView | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([api.buildStyle.get(), api.caveman.get()]).then(([build, answer]) => {
      if (!live) return
      if (build.ok) setStyle(build.value)
      else setError(build.error)
      if (!answer.ok) return setError(answer.error)
      setCaveman(answer.value)
      if (isCavemanIntensity(answer.value)) setIntensity(answer.value)
    })
    // Where ai-jail stands. The engine detects once and remembers, so this costs a `PATH` walk on
    // the first tab open and nothing after it.
    void api.sandbox.read().then((read) => {
      if (!live) return
      if (read.ok) setSandbox(read.value)
      else setError(read.error)
    })
    return () => {
      live = false
    }
  }, [])

  if (!style || !caveman) return null

  /** An add-on written is not a Session event, so what the note reads is read again from here. */
  function saved<T>(result: { ok: true; value: T } | { ok: false; error: string }, keep: (value: T) => void) {
    if (!result.ok) return setError(result.error)
    setError(null)
    keep(result.value)
    refreshIpcResource(resources.staleSessions)
  }

  async function pickStyle(next: BuildStyle) {
    saved(await api.buildStyle.set(next), setStyle)
  }

  async function pickCaveman(next: CavemanLevel) {
    saved(await api.caveman.set(next), setCaveman)
  }

  async function toggleSandbox(on: boolean) {
    saved(await api.sandbox.setEnabled(on), (settings) => setSandbox((view) => (view ? { ...view, settings } : view)))
  }

  async function recheckSandbox() {
    const result = await api.sandbox.recheck()
    if (!result.ok) return setError(result.error)
    setError(null)
    setSandbox(result.value)
  }

  const measured = cavemanMeasuredBlock()
  const addons: Addon[] = [
    {
      id: 'lean-builder',
      name: 'Lean builder',
      source: 'ponytail · MIT',
      description:
        'Before writing code, every Employee climbs a ladder and stops at the first rung that holds. Less code, same safety.',
      icon: Feather,
      on: style === 'lean',
      toggle: (on) => void pickStyle(on ? 'lean' : 'standard'),
      body: (
        <>
          <LeanPanels />
          {/* An add-on is read at every spawn, so turning one on reaches a running Session at its
              next start; the note says so and offers the restart (T237). */}
          <AppliesNextSession setting="buildStyle" />
        </>
      ),
    },
    {
      id: 'caveman',
      name: 'Caveman',
      source: 'caveman · MIT',
      description:
        'Employees answer you in few words. Code, commands, paths, errors and warnings stay whole — and between themselves they talk as they always do.',
      icon: MessageSquareText,
      on: caveman !== 'off',
      toggle: (on) => void pickCaveman(on ? intensity : 'off'),
      // No results file, no switch: the rule that no token claim ships unmeasured, in the UI.
      blocked: measured.enabled ? null : measured.foot,
      body: (
        <>
          <CavemanPanels
            intensity={intensity}
            measured={measured}
            onIntensity={(next) => {
              setIntensity(next)
              // While it is off the control is a choice about later, and writing it would turn the
              // add-on on. While it is on, moving it is the setting.
              if (caveman !== 'off') void pickCaveman(next)
            }}
          />
          <AppliesNextSession setting="caveman" />
        </>
      ),
    },
  ]
  if (sandbox) {
    const words = sandboxStatusWords(sandbox.status)
    addons.push({
      id: 'sandbox',
      name: SANDBOX_NAME,
      source: SANDBOX_SOURCE,
      description: SANDBOX_DESCRIPTION,
      icon: Shield,
      on: sandbox.settings.enabled,
      toggle: (on) => void toggleSandbox(on),
      // No ai-jail, no switch — and on Windows itself there is nothing to install, so the reason
      // the boss reads is the frame's own sentence rather than an install that never happened.
      blocked: sandboxToggleEnabled(sandbox.status) ? null : words.body,
      body: (
        <>
          <SandboxPanels view={sandbox} onRecheck={() => void recheckSandbox()} />
          <AppliesNextSession setting="sandbox" />
        </>
      ),
    })
  }
  const shown = addons.filter((addon) => matchesQuery(addon, query))

  return (
    <div className="flex min-w-0 grow basis-full flex-col gap-14">
      <div className="flex items-center justify-between gap-16">
        <Search
          className={SEARCH_FIELD}
          placeholder="Search add-ons"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="shrink-0 text-11-5/14 text-muted-foreground">{countLine(addons)}</span>
      </div>
      {error && <p className="m-0 text-11-5 text-destructive">{error}</p>}
      {shown.map((addon) => (
        <AddonCard key={addon.id} addon={addon} />
      ))}
    </div>
  )
}

export function addonsTabSubtitle(companyName: string): string {
  return `Optional ways of working for every Employee in ${companyName}. Turning one off removes it at the next Session.`
}

/** `2 add-ons · 0 on`, as the frame writes it. */
function countLine(addons: Addon[]): string {
  const on = addons.filter((addon) => addon.on).length
  return `${addons.length} add-on${addons.length === 1 ? '' : 's'} · ${on} on`
}

/** What the search field matches: the name and the description, as the boss would type them. */
function matchesQuery(addon: Addon, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return true
  return `${addon.name} ${addon.description}`.toLowerCase().includes(wanted)
}

/**
 * One add-on: its head, its switch, and whatever that add-on has to show for itself.
 *
 * The card is a settings card drawn again in utilities, at the 18px padding every other settings
 * card takes and `ttODp` is measured at. `addons.css` asked for 16 and never got it: `.addon` and
 * `.settings-card` are the same specificity, and the one the bundler put last won. The stroke is
 * an inset ring rather than a border, so the 1px lands inside the padding instead of pushing the
 * content over — the same thing `.settings-card::after` was for.
 */
function AddonCard({ addon }: { addon: Addon }) {
  const Icon = addon.icon
  // A blocked add-on cannot be turned on; one that is somehow already on can always be turned off,
  // or a Company that got there another way would have no switch left to get back out with.
  const blocked = Boolean(addon.blocked) && !addon.on
  return (
    <section
      className="inset-ring-1 inset-ring-border flex flex-col gap-14 rounded-md bg-card p-18"
      aria-label={addon.name}
    >
      <div className="flex items-start gap-12">
        <span
          className="flex h-40 w-40 shrink-0 items-center justify-center rounded-sm bg-primary-subtle text-primary"
          aria-hidden
        >
          <Icon size={17} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-8">
            <h2 className="m-0 font-bold text-14 text-foreground">{addon.name}</h2>
            {/* Where the idea came from, and under what licence: a quiet pill, never a claim of our own. */}
            <span className="inline-flex h-18 items-center rounded-full bg-secondary px-8 font-medium text-11/18 text-muted-foreground">
              {addon.source}
            </span>
          </div>
          <p className="m-0 text-12/17 text-muted-foreground">{addon.description}</p>
        </div>
        <Toggle
          label={null}
          aria-label={addon.name}
          checked={addon.on}
          disabled={blocked}
          {...(blocked ? { title: addon.blocked ?? undefined } : {})}
          onChange={(event) => addon.toggle(event.target.checked)}
        />
      </div>
      {addon.body}
    </section>
  )
}

/** The all-caps label over a panel, as every settings frame draws one: 11/700, its box 13 tall. */
const PANEL_LABEL = 'text-11 font-bold uppercase tracking-[0.5px] text-muted-foreground'

/** Lean builder's own two panels: the ladder it climbs, and what a real benchmark found for it. */
function LeanPanels() {
  return (
    <div className="grid grid-cols-2 items-start gap-13">
      {/* The ladder's own gap: the frame tucks the first rung closer under its label than the
          panel beside it does. */}
      <div className="flex flex-col gap-5 rounded-sm bg-secondary px-16 py-14">
        <span className={PANEL_LABEL}>The ladder</span>
        <ol className="m-0 flex list-none flex-col gap-5 p-0 [counter-reset:addon-rung]">
          {LEAN_LADDER.map((rung) => (
            <li
              key={rung}
              className="relative pl-24 text-12-5/16 text-foreground [counter-increment:addon-rung] before:absolute before:left-0 before:w-12 before:text-right before:text-11/16 before:text-muted-foreground before:tabular-nums before:content-[counter(addon-rung)]"
            >
              {rung}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-9 rounded-sm bg-secondary px-16 py-14">
        <span className={PANEL_LABEL}>Measured before it was offered</span>
        {/* The three numbers, side by side and unboxed: the panel is already the box. */}
        <div className="grid grid-cols-3 gap-12">
          {LEAN_MEASURED.map((tile) => (
            <div key={tile.what} className="flex min-w-0 flex-col gap-2">
              <div className="font-bold text-20 text-foreground tracking-[-0.01em]">{tile.change}</div>
              <div className="text-11-5/14 text-muted-foreground">{tile.what}</div>
            </div>
          ))}
        </div>
        {/* The frame leaves a little more air under the numbers than between the rows around them. */}
        <p className="m-0 mt-2 text-11-5 text-muted-foreground">{LEAN_MEASURED_CAVEAT}</p>
        {/* What laziness never reaches: the frame's green shield and one wrapped line under it,
            looser than the note above — the frame gives this one two lines with air between them. */}
        <div className="flex items-start gap-8">
          <ShieldCheck className="mt-2 shrink-0 text-brand-success" size={13} aria-hidden />
          <p className="m-0 min-w-0 text-11-5/20 text-muted-foreground">Never cuts {LEAN_NEVER_CUT}</p>
        </div>
      </div>
    </div>
  )
}

/** The mark beside each of the three rules, in the order `U8MYE` draws them. */
const RULE_MARKS = [Users, Code, GitPullRequest]

/**
 * Caveman's panels (frame `U8MYE`): what changes in a message to the boss, and how far.
 *
 * They are drawn on `bg-muted` inside a ring where Lean builder's sit flat on `bg-secondary`,
 * because the frame gives this card two boxed panels — the left one holds two quoted messages, and
 * a quote needs a surface its own box can sit on.
 */
function CavemanPanels({
  intensity,
  measured,
  onIntensity,
}: {
  intensity: CavemanIntensity
  measured: ReturnType<typeof cavemanMeasuredBlock>
  onIntensity(next: CavemanIntensity): void
}) {
  return (
    <div className="grid grid-cols-2 items-start gap-13">
      <div className="inset-ring-1 inset-ring-border flex flex-col gap-8 rounded-md bg-muted p-14">
        <span className={PANEL_LABEL}>What changes, in a message to you</span>
        <Example who="Before" text={CAVEMAN_EXAMPLE.before} />
        <Example who={`Caveman · ${CAVEMAN_LABEL[intensity]}`} text={CAVEMAN_EXAMPLE.answer[intensity]} highlight />
        {CAVEMAN_CARD_RULES.map((rule, index) => {
          const Mark = RULE_MARKS[index] ?? Users
          return (
            <div key={rule} className="flex items-start gap-8">
              <Mark className="mt-2 shrink-0 text-muted-foreground" size={13} aria-hidden />
              <p className="m-0 min-w-0 text-11-5/16 text-muted-foreground">{rule}</p>
            </div>
          )
        })}
      </div>
      <div className="inset-ring-1 inset-ring-border flex flex-col gap-10 rounded-md bg-muted p-14">
        <span className={PANEL_LABEL}>Intensity</span>
        <SegmentedControl
          label="Intensity"
          name="caveman-intensity"
          value={intensity}
          options={CAVEMAN_INTENSITIES.map((one) => ({ value: one, label: CAVEMAN_LABEL[one] }))}
          onChange={onIntensity}
        />
        <p className="m-0 text-11-5/16 text-muted-foreground">{CAVEMAN_HINT}</p>
        <span className={PANEL_LABEL}>Measured before it was offered</span>
        <div className="grid grid-cols-3 gap-12">
          {measured.tiles.map((tile) => (
            <div key={tile.what} className="flex min-w-0 flex-col gap-2">
              <div className="font-bold text-20 text-foreground tracking-[-0.01em]">{tile.change}</div>
              <div className="text-11/14 text-muted-foreground">{tile.what}</div>
            </div>
          ))}
        </div>
        <p className="m-0 text-11/16 text-muted-foreground">{measured.foot}</p>
      </div>
    </div>
  )
}

/** One quoted message: who it is, and what it says. The Caveman one is the frame's filled box. */
function Example({ who, text, highlight = false }: { who: string; text: string; highlight?: boolean }) {
  return (
    <div
      className={
        highlight
          ? 'inset-ring-1 inset-ring-primary flex flex-col gap-4 rounded-sm bg-primary-subtle px-11 py-9'
          : 'inset-ring-1 inset-ring-border flex flex-col gap-4 rounded-sm bg-background px-11 py-9'
      }
    >
      <span className="font-bold text-10-5 text-muted-foreground uppercase tracking-[0.4px]">{who}</span>
      <p className="m-0 text-12/17 text-foreground">{text}</p>
    </div>
  )
}
/** The icon on each *What an Employee can reach* row, in {@link SANDBOX_REACH}'s own order. */
const REACH_ICONS: readonly LucideIcon[] = [FolderGit2, FileCog, KeyRound, Zap, House]

/**
 * The Sandbox add-on's two panels (frames `fBHiz` and `gJyAJ`): what a jailed Session can reach,
 * and where ai-jail stands on this computer.
 *
 * The right panel is the one that changes shape. Found, it is a version and a path; missing, it is
 * the line the boss runs, where we looked, and `Check again`. The `NETWORK` block below is **one
 * state** and says why in the boss's words — ai-jail cannot filter the network and still let a
 * Session reach TinyCorp on loopback, so the add-on guards the files and does not pretend otherwise.
 */
function SandboxPanels({ view, onRecheck }: { view: SandboxView; onRecheck(): void }) {
  const words = sandboxStatusWords(view.status)
  const found = view.status.state === 'found'
  // Every sentence here names the machine, and the machine's own word is the platform's (T265).
  const said = (text: string) => inMachineWords(text, hostPlatform())
  return (
    <div className="grid grid-cols-2 items-start gap-13">
      <div className="flex flex-col gap-9 rounded-sm bg-secondary px-16 py-14">
        <span className={PANEL_LABEL}>What an Employee can reach</span>
        <ul className="m-0 flex list-none flex-col gap-9 p-0">
          {SANDBOX_REACH.map((row, index) => {
            const Icon = REACH_ICONS[index] ?? Zap
            return (
              <li key={row.what} className="flex items-start gap-9">
                <Icon className="mt-2 shrink-0 text-muted-foreground" size={13} aria-hidden />
                <div className="flex min-w-0 flex-col gap-2">
                  <span className="font-bold text-12-5/16 text-foreground">{row.what}</span>
                  <span className="text-11-5/15 text-muted-foreground">{said(row.detail)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-9 rounded-sm bg-secondary px-16 py-14">
        <span className={PANEL_LABEL}>{said(SANDBOX_WHERE_LABEL)}</span>
        <div className="flex flex-wrap items-center gap-8">
          {/* The frame's pill with its leading dot is the kit's own Badge, in the two tones it
              already has: found is a success, and anything else is a warning the boss can act on. */}
          <Badge variant={found ? 'success' : 'warning'} className="px-9 py-3 text-11/[normal]">
            {words.title}
          </Badge>
          {/* Found, the body is a version and a path and reads as one; the other states are a sentence. */}
          <span className={cx('min-w-0 text-11-5 text-muted-foreground', found && 'font-code')}>{words.body}</span>
        </div>
        {/* Nothing to install on Windows itself, so the line and `Check again` are not drawn at all:
            there is no line that would help, and looking again would find the same nothing. */}
        {!found &&
          view.install.map((line) => (
            <div
              key={line.command}
              className="inset-ring-1 inset-ring-border flex items-center gap-8 rounded-sm bg-card px-10 py-7"
            >
              <span className="shrink-0 text-muted-foreground" aria-hidden>
                $
              </span>
              <code className="min-w-0 flex-1 truncate font-code text-11-5 text-foreground">{line.command}</code>
              <button
                type="button"
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                aria-label={`Copy the ${line.label} command`}
                onClick={() => void navigator.clipboard?.writeText(line.command)}
              >
                <Copy size={13} aria-hidden />
              </button>
            </div>
          ))}
        {!found && view.status.lookedIn.length > 0 && (
          <div className="flex items-center justify-between gap-8">
            <span className="flex min-w-0 items-center gap-6 text-11-5 text-muted-foreground">
              <SearchIcon className="shrink-0" size={12} aria-hidden />
              <span className="truncate font-code">Looked in: {view.status.lookedIn.join(', ')}</span>
            </span>
            <button
              type="button"
              className="inset-ring-1 inset-ring-border inline-flex shrink-0 cursor-pointer items-center gap-6 rounded-sm bg-card px-10 py-6 font-medium text-12/[normal] text-foreground hover:bg-secondary"
              onClick={onRecheck}
            >
              <RefreshCw size={12} aria-hidden />
              Check again
            </button>
          </div>
        )}
        <div className="flex flex-col gap-5">
          <span className={PANEL_LABEL}>Network</span>
          <span className="flex items-center gap-7 font-bold text-12-5/16 text-foreground">
            <Globe className="shrink-0 text-muted-foreground" size={13} aria-hidden />
            {SANDBOX_NETWORK_STATE}
          </span>
          <p className="m-0 text-11-5/15 text-muted-foreground">{said(SANDBOX_NETWORK_WHY)}</p>
        </div>
        <div className="flex flex-col gap-5">
          <span className={PANEL_LABEL}>On Windows</span>
          <p className="m-0 text-11-5/15 text-muted-foreground">{SANDBOX_ON_WINDOWS}</p>
        </div>
        <p className="m-0 text-11-5/15 text-muted-foreground">{SANDBOX_FOOT}</p>
      </div>
    </div>
  )
}
