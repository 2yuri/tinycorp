import type { LucideIcon } from 'lucide-react'
import { ChevronDown, LayoutGrid, MessageSquare, Pencil, Plus, Shuffle, Sparkles, SquareKanban, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AutonomyLevel } from '../../../shared/approvals'
import { PROVIDER_CATALOGUE, type Provider } from '../../../shared/domain/providers'
import type { RoleTemplate } from '../../../shared/domain/staff'
import type { Headcount } from '../../../shared/hiring'
import { modelLabel } from '../../../shared/staff/models'
import {
  addRoleLabel,
  addSeat,
  catalogInPresetOrder,
  type DraftSeat,
  draftNames,
  type NextStepIcon,
  type OfficePlan,
  officePlan,
  type RosterDraft,
  removeSeat,
  roleLine,
  seatNameError,
  shortModelLabel,
  updateSeat,
  wizardCatalog,
} from '../../../shared/staff/roster-draft'
import { resources, useIpcResource } from '../ipc'
import { CharacterPortrait } from '../sprites'
import { cx, focusOnMount, initialsOf } from '../ui'
import '../ui/tailwind.css'

/*
 * The Your-team step's classes (T210c), off frame `Desktop App / Onboarding / Team`. The wizard's
 * window sets the line box to the font's own, so sizes pin `/[normal]` unless a rule measured one.
 */
const TEAM = 'flex w-full shrink-0 items-start gap-20'
const ROSTER = 'flex min-w-0 flex-1 flex-col gap-10'
const SEAT = 'flex items-center gap-12 rounded-sm border border-border bg-card p-11'
const AVATAR =
  'flex h-38 w-38 shrink-0 items-center justify-center overflow-hidden rounded-full text-13/[normal] font-bold select-none'
const AVATAR_TONE: Record<string, string> = {
  primary: 'bg-primary-subtle text-status-info-foreground',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  error: 'bg-status-error text-status-error-foreground',
}
/* The seat's character stands in its avatar circle, feet on the rim. */
const CHARACTER = 'h-34 self-end'
const TEXT = 'flex min-w-0 flex-1 flex-col gap-3'
const LINE = 'flex min-h-21 items-center gap-8'
const NAME = 'overflow-hidden text-ellipsis whitespace-nowrap text-foreground text-14/[normal] font-bold'
const NAME_INPUT =
  'm-0 w-160 rounded-[6px] border border-ring bg-background px-6 py-1 font-sans text-foreground text-14/[normal] font-bold shadow-focus outline-none aria-invalid:border-destructive'
const CHIP =
  'shrink-0 rounded-full bg-secondary px-9 py-3 whitespace-nowrap text-soft-ink text-11/[normal] font-semibold'
const ICON =
  'm-0 flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'
const PERSONA = 'overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-11-5/[normal]'
const SEAT_ERROR = 'overflow-hidden text-ellipsis whitespace-nowrap text-status-error-foreground text-11-5/[normal]'
/* MODEL: a native select laid over the design's box, so the list is the platform's. */
const MODEL =
  'relative flex w-148 shrink-0 cursor-pointer items-center gap-7 rounded-sm border border-border bg-card px-9 py-7 text-muted-foreground focus-within:shadow-focus focus-within:outline-none [&_select]:absolute [&_select]:inset-0 [&_select]:h-full [&_select]:w-full [&_select]:cursor-pointer [&_select]:opacity-0'
const MODEL_VALUE = 'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground text-12-5/[normal]'
const ADD =
  'm-0 flex w-full cursor-pointer items-center justify-center gap-9 rounded-sm border border-border bg-card p-13 font-sans whitespace-nowrap text-soft-ink text-12-5/[normal] font-semibold hover:bg-secondary focus-visible:shadow-focus focus-visible:outline-none [&_svg]:text-muted-foreground'
const CATALOG = 'm-0 flex list-none flex-col gap-2 rounded-sm border border-border bg-card p-5'
const ROLE =
  'm-0 flex w-full cursor-pointer items-center gap-10 rounded-[6px] border-0 bg-transparent px-10 py-8 text-left font-sans text-[length:inherit] text-inherit hover:bg-secondary focus-visible:shadow-focus focus-visible:outline-none'
const ROLE_PERSONA = 'overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-11-5/[normal]'
const SUMMARY = 'flex w-320 shrink-0 flex-col gap-14 rounded-md border border-border bg-card p-19'
const SUMMARY_HEAD = 'flex flex-col gap-3'
const SUMMARY_TITLE = 'm-0 text-foreground text-15/[normal] font-bold'
const SUMMARY_SUB = 'text-muted-foreground text-11-5/[normal]'
const ROW = 'flex items-center gap-8'
const ROW_LABEL = 'flex-1 text-muted-foreground text-12-5/[normal]'
const ROW_VALUE =
  'max-w-180 overflow-hidden text-ellipsis whitespace-nowrap font-code text-foreground text-12/[normal] font-semibold'
const ROW_VALUE_OVER =
  'max-w-180 overflow-hidden text-ellipsis whitespace-nowrap font-code text-status-error-foreground text-12/[normal] font-semibold'
const BAR = 'flex h-8 overflow-hidden rounded-full bg-secondary'
const BAR_USED = 'h-full rounded-full bg-primary'
const BAR_USED_OVER = 'h-full rounded-full bg-destructive'
const OVER = 'text-status-error-foreground text-11-5/17'
const DIVIDER = 'h-1 shrink-0 bg-border'
const NEXT_LABEL = 'text-muted-foreground text-11/[normal] font-bold tracking-[0.6px]'
const NEXT = 'flex items-center gap-10 text-soft-ink text-12/17 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

const NEXT_ICON: Record<NextStepIcon, LucideIcon> = {
  desks: LayoutGrid,
  general: MessageSquare,
  ticket: SquareKanban,
}

/** Avatar colours in seat order, as the design gives them: primary, success, warning, error. */
const AVATAR_TONES = ['primary', 'success', 'warning', 'error'] as const

/** By the seat's number in its key, so a seat keeps its colour when another is removed. */
function seatTone(key: string): (typeof AVATAR_TONES)[number] {
  const n = Number(key.slice(key.lastIndexOf('-') + 1)) || 0
  return AVATAR_TONES[n % AVATAR_TONES.length]!
}

export interface TeamStepViewProps {
  roster: RosterDraft
  /** The Company's role catalog; empty while it loads. */
  catalog: RoleTemplate[]
  plan: OfficePlan
  onRename(key: string, name: string): void
  onModel(key: string, model: string): void
  onRemove(key: string): void
  onAddRole(role: RoleTemplate): void
  /** The engine's name generator, avoiding the draft's names. */
  suggestName(): Promise<string | null>
  /** Opens with the role catalog shown, for tests. */
  catalogOpen?: boolean
}

/** Step 3, Your team (design/html/onboarding-team.html, frame `Desktop App / Onboarding / Team`). */
export function TeamStepView(props: TeamStepViewProps) {
  const [catalogOpen, setCatalogOpen] = useState(props.catalogOpen ?? false)
  return (
    <div className={TEAM}>
      <div className={ROSTER}>
        {props.roster.map((seat) => (
          <SeatCard
            key={seat.key}
            seat={seat}
            tone={seatTone(seat.key)}
            roster={props.roster}
            onRename={(name) => props.onRename(seat.key, name)}
            onModel={(model) => props.onModel(seat.key, model)}
            onRemove={() => props.onRemove(seat.key)}
            suggestName={props.suggestName}
          />
        ))}
        <button
          type="button"
          className={ADD}
          aria-expanded={catalogOpen}
          onClick={() => setCatalogOpen((open) => !open)}
        >
          <Plus size={15} aria-hidden />
          {addRoleLabel(props.roster, props.catalog)}
        </button>
        {catalogOpen && (
          <ul
            className={CATALOG}
            aria-label="Role catalog"
            onKeyDown={(event) => event.key === 'Escape' && setCatalogOpen(false)}
          >
            {catalogInPresetOrder(props.catalog).map((role) => (
              <li key={role.id}>
                <button
                  type="button"
                  className={ROLE}
                  onClick={() => {
                    props.onAddRole(role)
                    setCatalogOpen(false)
                  }}
                >
                  <span className={CHIP}>{role.name}</span>
                  <span className={ROLE_PERSONA}>{roleLine(role)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <OfficeSummary plan={props.plan} />
    </div>
  )
}

function SeatCard(props: {
  seat: DraftSeat
  tone: (typeof AVATAR_TONES)[number]
  roster: RosterDraft
  onRename(name: string): void
  onModel(model: string): void
  onRemove(): void
  suggestName(): Promise<string | null>
}) {
  const { seat } = props
  const [draft, setDraft] = useState<string | null>(null)
  const error = draft === null ? null : seatNameError(props.roster, seat.key, draft)
  const commit = () => {
    if (draft !== null && !error) props.onRename(draft.trim())
    setDraft(null)
  }
  const shuffle = async () => {
    const name = await props.suggestName()
    if (name) setDraft(name)
  }

  return (
    <div className={SEAT} data-seat={seat.key}>
      <span className={cx(AVATAR, AVATAR_TONE[props.tone])} data-tone={props.tone} data-look={seat.sprite} aria-hidden>
        {/* The character this seat walks into the office on, read only here. */}
        <CharacterPortrait sprite={seat.sprite} className={CHARACTER} fallback={initialsOf(seat.name)} />
      </span>
      <div className={TEXT}>
        <div className={LINE}>
          {draft === null ? (
            <>
              <span className={NAME}>{seat.name}</span>
              <span className={CHIP}>{seat.role}</span>
              <button
                type="button"
                className={ICON}
                aria-label={`Rename ${seat.name}`}
                onClick={() => setDraft(seat.name)}
              >
                <Pencil size={13} aria-hidden />
              </button>
            </>
          ) : (
            <>
              <input
                className={NAME_INPUT}
                aria-label={`Name for the ${seat.role}`}
                aria-invalid={error ? true : undefined}
                title={error ?? undefined}
                ref={focusOnMount}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit()
                  if (event.key === 'Escape') setDraft(null)
                }}
              />
              <button
                type="button"
                className={ICON}
                aria-label="Suggest another name"
                // Keeps the name input focused, so a shuffled name can still be edited.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void shuffle()}
              >
                <Shuffle size={13} aria-hidden />
              </button>
              <span className={CHIP}>{seat.role}</span>
            </>
          )}
        </div>
        {error ? <span className={SEAT_ERROR}>{error}</span> : <span className={PERSONA}>{seat.persona}</span>}
      </div>
      {/*
        Every model there is, grouped by the product that runs it. The seat names no Provider of its
        own: a model belongs to exactly one (T139), so picking one moves the seat onto its product —
        and the boss is not held to whichever Provider the preset opened on (T169).
      */}
      <label className={MODEL} title={shortModelLabel(seat.model)}>
        <Sparkles size={13} aria-hidden />
        <span className={MODEL_VALUE}>{shortModelLabel(seat.model)}</span>
        <ChevronDown size={13} aria-hidden />
        <select
          aria-label={`Model for ${seat.name}`}
          value={seat.model ?? ''}
          onChange={(event) => props.onModel(event.target.value)}
        >
          {PROVIDER_CATALOGUE.map((entry) => (
            <optgroup key={entry.id} label={entry.name}>
              {entry.models.map((option) => (
                <option key={option.id} value={option.id}>
                  {/* The model and the effort it runs at: one entry per pair, so the name alone repeats. */}
                  {modelLabel(entry.id, option.id)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <button type="button" className={ICON} aria-label={`Remove ${seat.name}`} onClick={props.onRemove}>
        <X size={16} aria-hidden />
      </button>
    </div>
  )
}

function OfficeSummary({ plan }: { plan: OfficePlan }) {
  return (
    <aside className={SUMMARY} aria-label="Your office">
      <div className={SUMMARY_HEAD}>
        <h2 className={SUMMARY_TITLE}>Your office</h2>
        <p className={SUMMARY_SUB}>What opens when you finish setup.</p>
      </div>
      <div className={ROW}>
        <span className={ROW_LABEL}>Desks taken</span>
        <span className={plan.overHeadcount ? ROW_VALUE_OVER : ROW_VALUE} data-over={plan.overHeadcount || undefined}>
          {plan.desksTaken}
        </span>
      </div>
      <div className={ROW}>
        <span className={ROW_LABEL}>Repository</span>
        <span className={ROW_VALUE}>{plan.repository}</span>
      </div>
      {plan.desksFill !== null && (
        <div className={BAR} aria-hidden>
          <div
            className={plan.overHeadcount ? BAR_USED_OVER : BAR_USED}
            data-bar="used"
            style={{ width: `${plan.desksFill * 100}%` }}
          />
        </div>
      )}
      {plan.overHeadcount && (
        <p className={OVER}>More than the maximum headcount; raise it in Company settings or drop someone.</p>
      )}
      <div className={DIVIDER} />
      <span className={NEXT_LABEL}>WHAT HAPPENS NEXT</span>
      {plan.next.map((line) => {
        const Icon = NEXT_ICON[line.icon]
        return (
          <div key={line.icon} className={NEXT}>
            <Icon size={15} aria-hidden />
            <span>{line.text}</span>
          </div>
        )
      })}
    </aside>
  )
}

export interface TeamStepProps {
  roster: RosterDraft
  /** The Company's autonomy level, or null while it loads; Supervised changes what happens next. */
  autonomy: AutonomyLevel | null
  /** The Provider a seat added here starts on: the same one the preset's seats started on (T169). */
  provider: Provider
  /** Edits the wizard's roster; an update, as adding a role waits on the name generator. */
  onRoster(update: (roster: RosterDraft) => RosterDraft): void
}

/** The Your team step bound to the engine: it reads the catalog, headcount and repos, and writes nothing. */
export function TeamStep({ roster, autonomy, provider, onRoster }: TeamStepProps) {
  const api = window.tinyCorp
  // The Company takes a role when a seat asks for it (T240), so what this step picks *from* is the
  // built-ins, with the Company's own — the ones the draft already claimed — first.
  const catalog = wizardCatalog(useIpcResource(resources.roles))
  const repos = useIpcResource(resources.repos).map((repo) => repo.name)
  const [headcount, setHeadcount] = useState<Headcount | null>(null)

  useEffect(() => {
    const load = async () => {
      const count = await api.hiring.headcount()
      if (count.ok) setHeadcount(count.value)
    }
    void load()
    return api.staff.onChanged(() => void load())
  }, [])

  const suggestName = async () => {
    const result = await api.hiring.suggestName(draftNames(roster))
    return result.ok ? result.value : null
  }

  return (
    <TeamStepView
      roster={roster}
      catalog={catalog}
      plan={officePlan({ draft: roster, headcount, catalog, repos, autonomy })}
      onRename={(key, name) => onRoster((draft) => updateSeat(draft, key, { name }))}
      onModel={(key, model) => onRoster((draft) => updateSeat(draft, key, { model }))}
      onRemove={(key) => onRoster((draft) => removeSeat(draft, key))}
      onAddRole={(role) => {
        void (async () => {
          const name = await suggestName()
          onRoster((draft) => addSeat(draft, role, name ?? role.name, provider))
        })()
      }}
      suggestName={suggestName}
    />
  )
}
