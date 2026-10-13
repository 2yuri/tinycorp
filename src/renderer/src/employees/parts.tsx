import {
  ChartNoAxesColumn,
  Check,
  EllipsisVertical,
  FolderGit2,
  Gauge,
  IdCard,
  Pencil,
  ShieldCheck,
  TriangleAlert,
  UserRoundPlus,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { CapacityInfo } from '../../../shared/capacity'
import type { Employee } from '../../../shared/domain/staff'
import type { ProviderPreflight } from '../../../shared/providers/preflight'
import { ViewHeader } from '../chrome'
import { type ModelChoice, ModelPicker } from '../model-picker'
import {
  Alert,
  Avatar,
  type AvatarPerson,
  Button,
  cx,
  DropdownMenu,
  focusOnMount,
  MenuItem,
  Textarea,
  useDismiss,
} from '../ui'
import { type CardState, capBadge, type DotTone, type HireProposal, type LoadRow } from './model'
import '../ui/tailwind.css'

/** The design's small status pill: a dot and a label on the secondary surface. */
export function Pill({ tone, size = 'sm', children }: { tone: DotTone; size?: 'sm' | 'md'; children: ReactNode }) {
  return (
    <span className={cx(PILL, size === 'md' ? 'text-11/normal' : 'text-10-5/normal')}>
      <span className={cx(DOT, DOT_TONE[tone])} aria-hidden />
      <span data-ui="Pill">{children}</span>
    </span>
  )
}

/** The square avatar the design calls Sprite: an Employee's character on their own accent. */
export function Sprite({
  name,
  person,
  size,
}: {
  name: string
  /** The Employee it stands for; null for a candidate who is not hired yet. */
  person?: AvatarPerson | null
  size: 'card' | 'candidate' | 'message'
}) {
  return <Avatar name={name} person={person} className={cx(SPRITE, SPRITE_SIZE[size])} />
}

export function CapChip({ children }: { children: ReactNode }) {
  return (
    <span data-ui="Chip" className={cx(CHIP, CAP_CHIP)}>
      {children}
    </span>
  )
}

export function RepoChip({ children, icon = true }: { children: ReactNode; icon?: boolean }) {
  return (
    // Repo chips sit after the spacer; a name too long for the card truncates rather than clips.
    <span
      data-ui="Chip"
      className={cx(CHIP, REPO_CHIP, 'min-w-0 shrink [&_svg]:shrink-0 [&_svg]:text-muted-foreground')}
    >
      {icon && <FolderGit2 size={11} aria-hidden />}
      <span className="min-w-0 overflow-hidden text-ellipsis">{children}</span>
    </span>
  )
}

/** Fills the shell's content header: title, cap badge and subtitle; the concurrency cap control and Hire. */
export function EmployeesHeader(props: {
  capacity: CapacityInfo | null
  onSetCap(cap: number): void
  /** Opens the Roles list in the side panel (T240). */
  onRoles?: (() => void) | undefined
  onHire(): void
}) {
  const badge = props.capacity && capBadge(props.capacity)
  return (
    <ViewHeader
      title="Employees"
      badge={
        badge ? (
          <Pill tone={badge.tone} size="md">
            {badge.label}
          </Pill>
        ) : undefined
      }
      subtitle="Roles are data — edit a template and every Employee on it follows."
    >
      <EmployeesActions {...props} />
    </ViewHeader>
  )
}

export function EmployeesActions(props: {
  capacity: CapacityInfo | null
  onSetCap(cap: number): void
  onRoles?: (() => void) | undefined
  onHire(): void
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex items-center gap-12">
      {props.onRoles && (
        <Button
          variant="ghost"
          size="toolbar"
          icon={IdCard}
          className="px-12 py-8 text-muted-foreground"
          onClick={props.onRoles}
        >
          Roles
        </Button>
      )}
      <div className="relative">
        <Button
          variant="ghost"
          size="toolbar"
          icon={Gauge}
          className="px-12 py-8 text-muted-foreground"
          aria-expanded={editing}
          disabled={!props.capacity}
          onClick={() => setEditing((open) => !open)}
        >
          Concurrency cap
        </Button>
        {editing && props.capacity && (
          <CapEditor
            cap={props.capacity.concurrencyCap}
            onDone={(cap) => {
              setEditing(false)
              if (cap !== null && cap !== props.capacity?.concurrencyCap) props.onSetCap(cap)
            }}
          />
        )}
      </div>
      <Button icon={UserRoundPlus} onClick={props.onHire}>
        Hire Employee
      </Button>
    </div>
  )
}

function CapEditor({ cap, onDone }: { cap: number; onDone(cap: number | null): void }) {
  const [draft, setDraft] = useState(String(cap))
  const commit = () => onDone(Number.isInteger(Number(draft)) && Number(draft) >= 1 ? Number(draft) : null)
  return (
    <DropdownMenu className="absolute top-[calc(100%+6px)] right-0 z-20 w-240 gap-8 p-12">
      <label className="flex items-center justify-between gap-8 font-semibold text-13/normal text-foreground">
        Sessions at once
        <input
          ref={focusOnMount}
          className={CAP_INPUT}
          type="number"
          min={1}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') onDone(null)
          }}
        />
      </label>
      <span className="text-12/17 text-muted-foreground">Employees beyond the cap wait parked for a seat.</span>
    </DropdownMenu>
  )
}

export interface CardMenu {
  running: boolean
  onEdit(): void
  onStart(): void
  onStop(): void
  onFire(): void
}

/** One Employee: avatar, name, role, state, persona, capability and repo chips. Click opens the drawer. */
export function EmployeeCard(props: {
  employee: Employee
  state: CardState
  repos: string[]
  /**
   * Said under the chip row when this Employee's filter lets them into no repo of the Company
   * (T239): the chip row's `no repos` is the fact, and this is what it costs.
   */
  shutOut?: string | null
  /** Opens the Employee drawer; former Employees have none. */
  onOpen?(): void
  menu?: CardMenu
  /** Replaces the state badge, e.g. a Rehire button for former Employees. */
  action?: ReactNode
}) {
  const { employee, state } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = props.menu
  // Escape and a pointer down outside close it; the trigger is named so its own click still toggles.
  const dismiss = useDismiss<HTMLDivElement, HTMLButtonElement>(menuOpen, () => setMenuOpen(false))
  return (
    <article
      className={cx(CARD, state.dimmed && 'opacity-78')}
      data-employee={employee.id}
      onContextMenu={
        menu &&
        ((event) => {
          event.preventDefault()
          setMenuOpen(true)
        })
      }
    >
      {props.onOpen && (
        // The whole card opens the drawer; its content lets clicks through except its own controls.
        <button
          type="button"
          data-card="open"
          className={CARD_OPEN}
          aria-label={`Open ${employee.name}`}
          onClick={props.onOpen}
        />
      )}
      <div className="flex w-full items-center gap-11">
        <Sprite name={employee.name} person={{ id: employee.id, sprite: employee.sprite }} size="card" />
        <div className={NAMES}>
          <span data-ui="Name" className={NAME}>
            {employee.name}
          </span>
          <span data-ui="Role" className={ROLE}>
            {employee.title}
          </span>
        </div>
        {menu && (
          // A zero-width slot, so the hidden menu button takes no room in the head.
          <span className="relative -mr-11 h-24 w-0">
            <button
              type="button"
              ref={dismiss.trigger}
              data-card="menu-button"
              className={MORE}
              aria-label={`More for ${employee.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <EllipsisVertical size={15} aria-hidden />
            </button>
          </span>
        )}
        {props.action ?? <Pill tone={state.tone}>{state.label}</Pill>}
      </div>
      {menu && menuOpen && (
        <DropdownMenu ref={dismiss.popover} data-card="menu" className="absolute top-44 right-14 z-10 min-w-170">
          {props.onOpen && <MenuItem label="Open" onClick={() => (setMenuOpen(false), props.onOpen?.())} />}
          <MenuItem label="Edit" onClick={() => (setMenuOpen(false), menu.onEdit())} />
          {menu.running ? (
            <MenuItem label="Stop Session" onClick={() => (setMenuOpen(false), menu.onStop())} />
          ) : (
            <MenuItem label="Start Session" onClick={() => (setMenuOpen(false), menu.onStart())} />
          )}
          <MenuItem label="Fire…" destructive onClick={() => (setMenuOpen(false), menu.onFire())} />
        </DropdownMenu>
      )}
      {employee.persona && (
        <p data-ui="Persona" className={PERSONA}>
          {employee.persona}
        </p>
      )}
      <div data-ui="Chip Row" className="flex w-full min-w-0 items-center gap-10 overflow-hidden">
        {employee.capabilities.map((c) => (
          <CapChip key={c}>{c}</CapChip>
        ))}
        <span data-ui="Spacer" className={SPACER} />
        {props.repos.map((repo) => (
          <RepoChip key={repo} icon={!repo.startsWith('+')}>
            {repo}
          </RepoChip>
        ))}
      </div>
      {props.shutOut && (
        <p data-ui="Shut Out" className={SHUT_OUT} role="alert">
          <TriangleAlert size={12} aria-hidden />
          {props.shutOut}
        </p>
      )}
    </article>
  )
}

/** The right-hand panel frame: a 64px head, a scrolling body and an optional footer. */
export function SidePanel(props: {
  title: ReactNode
  sub?: ReactNode
  badge?: ReactNode
  footer?: ReactNode
  children: ReactNode
  label: string
}) {
  return (
    <aside className={PANEL} aria-label={props.label}>
      <div className="flex h-64 shrink-0 items-center gap-10 border-b border-b-border px-16">
        <div className="flex min-w-0 flex-1 basis-0 flex-col gap-1">
          <div data-ui="Panel Title" className="whitespace-nowrap font-bold text-15/normal text-foreground">
            {props.title}
          </div>
          {props.sub !== undefined && (
            <div data-ui="Panel Subtitle" className="truncate font-normal text-11/normal text-muted-foreground">
              {props.sub}
            </div>
          )}
        </div>
        {props.badge}
      </div>
      <div className={PANEL_BODY}>{props.children}</div>
      {props.footer !== undefined && (
        <div className="flex shrink-0 items-center gap-10 border-t border-t-border px-16 py-14">{props.footer}</div>
      )}
    </aside>
  )
}

/** A pending hire proposal, decided here: approving hires, rejecting needs a reason. */
export function HireProposalPanel(props: {
  proposal: HireProposal
  channelName: string
  time: string
  load: LoadRow[] | null
  repos: string[]
  autonomy: string | null
  /** Set when the hire would go above the maximum headcount. */
  headcount?: string | null
  effect: string | null
  error: string | null
  onApprove(): void
  onReject(reason: string): void
  /** Opens the proposal editor; absent when the proposal cannot be edited (a rehire). */
  onEdit?: (() => void) | undefined
  /** Changes the proposal's model before it is decided; the Provider comes with it. */
  onModel(model: string | null): void
  /** Every Provider's cached preflight answer, for the model picker; null until it is read. */
  preflight?: readonly ProviderPreflight[] | null
}) {
  const { proposal } = props
  const { candidate, requester } = proposal
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <SidePanel
      label="Hire proposal"
      title="Hire proposal"
      sub={`#${props.channelName} · thread from ${requester.name}`}
      badge={
        <Pill tone="warning" size="md">
          {proposal.pendingCount > 1 ? `Pending · 1 of ${proposal.pendingCount}` : 'Pending'}
        </Pill>
      }
      footer={
        <>
          <Button
            variant="outline"
            icon={X}
            className="flex-1 basis-0"
            disabled={rejecting && !reason.trim()}
            onClick={() => (rejecting ? props.onReject(reason.trim()) : setRejecting(true))}
          >
            Reject
          </Button>
          <Button icon={Check} className="flex-1 basis-0" onClick={props.onApprove}>
            Approve &amp; hire
          </Button>
        </>
      }
    >
      {/* Proposer message */}
      <div className="flex shrink-0 gap-10">
        <Sprite name={requester.name} person={requester.person} size="message" />
        <div className="flex min-w-0 flex-1 basis-0 flex-col gap-4">
          <div className="flex items-center gap-7 whitespace-nowrap">
            <span className="font-bold text-13/normal text-foreground">{requester.name}</span>
            <span data-ui="Message Role" className="font-semibold text-10-5/normal text-muted-foreground">
              {requester.label}
            </span>
            <span className="font-normal text-10-5/normal text-muted-foreground">{props.time}</span>
          </div>
          <p data-ui="Message Text" className={MESSAGE}>
            {proposal.approval.reason}
          </p>
        </div>
      </div>

      {props.load && (
        <div className={LOAD}>
          <div className="flex items-center gap-7 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
            <ChartNoAxesColumn size={14} aria-hidden />
            <span className={LOAD_TITLE}>TEAM LOAD · read from the board</span>
          </div>
          {props.load.map((row) => (
            <div key={row.label} className="flex items-center gap-8">
              <span data-ui="Load Label" className={LOAD_LABEL}>
                {row.label}
              </span>
              <span className={SPACER} />
              <span data-ui="Load Value" className={cx(LOAD_VALUE, row.strong ? 'font-bold' : 'font-normal')}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Proposed Employee */}
      <div className={CANDIDATE}>
        <div className="flex items-center gap-11">
          <Sprite name={candidate.name} person={candidate.person} size="candidate" />
          <div className={NAMES}>
            <span data-ui="Name" className={NAME}>
              {candidate.name}
            </span>
            <span data-ui="Candidate Role" className="whitespace-nowrap font-normal text-11/normal text-foreground">
              {candidate.roleLine}
            </span>
          </div>
          <button
            type="button"
            className="flex shrink-0 border-0 bg-transparent p-0 text-foreground disabled:cursor-default"
            disabled={!props.onEdit}
            aria-label="Edit the proposed Employee"
            title={props.onEdit ? 'Edit the proposed Employee' : 'A rehire comes back as they were'}
            onClick={props.onEdit}
          >
            <Pencil size={15} aria-hidden />
          </button>
        </div>
        {candidate.persona && <p className={CANDIDATE_PERSONA}>{candidate.persona}</p>}
        <div className="flex flex-wrap items-center gap-6">
          {candidate.capabilities.map((c) => (
            <span key={c} data-ui="Chip" className={cx(CHIP, CARD_CAP)}>
              {c}
            </span>
          ))}
          {props.repos.map((r) => (
            <span key={r} data-ui="Chip" className={cx(CHIP, CARD_REPO)}>
              {r}
            </span>
          ))}
          <span data-ui="Chip" className={cx(CHIP, CARD_PROVIDER)}>
            {candidate.provider}
          </span>
          <span data-ui="Chip" className={cx(CHIP, CARD_PROVIDER)}>
            {candidate.modelLabel}
          </span>
        </div>
        <ModelPicker
          provider={candidate.providerId}
          value={candidate.model}
          preflight={props.preflight ?? null}
          who={candidate.name}
          onChange={(choice: ModelChoice) => props.onModel(choice.model)}
        />
      </div>

      {props.autonomy && (
        <div className={AUTONOMY}>
          <ShieldCheck size={15} aria-hidden />
          <span data-ui="Autonomy" className="flex-1 basis-0 font-semibold text-12/17">
            {props.autonomy}
          </span>
        </div>
      )}

      {props.headcount && (
        <Alert variant="warning" title="Above the maximum headcount" className="shrink-0">
          {props.headcount}
        </Alert>
      )}

      {props.effect && (
        <p data-ui="Effect" className={EFFECT}>
          {props.effect}
        </p>
      )}

      {rejecting && (
        <div className={REJECT}>
          <Textarea
            autoFocus
            label="Why not?"
            helper="Your reason goes to the proposer in the thread."
            value={reason}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={() => (setRejecting(false), setReason(''))}>
            Keep it open
          </Button>
        </div>
      )}
      {props.error && (
        <p className={PANEL_ERROR} role="alert">
          {props.error}
        </p>
      )}
    </SidePanel>
  )
}

/*
 * The Employees view (design/html/staff.html, frame `TWLl3`), as utilities (T210f).
 *
 * `#cbd5e1` and `#475569` are the design's Slate 300 and 600: the soft ink the cards and the panel
 * read, and the stronger stroke a hovered card and the candidate box take. The token set has no
 * name for either, so they are written where they draw. The pill also renders in the shell header,
 * which is why its ink cannot be inherited from the view.
 */
const PILL =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-9 py-3 font-semibold text-[#cbd5e1]'

const DOT = 'h-6 w-6 shrink-0 rounded-full'

/** Every tone, so the dot never carries two fills in one layer. */
const DOT_TONE: Record<DotTone, string> = {
  success: 'bg-brand-success',
  danger: 'bg-brand-danger',
  warning: 'bg-brand-warning',
  muted: 'bg-brand-text-muted',
}

/** The square avatar the design calls Sprite, in the three sizes the screen draws it. */
const SPRITE = 'rounded-sm bg-secondary text-[#cbd5e1]'

const SPRITE_SIZE = {
  card: 'h-38 w-38 text-13/normal',
  candidate: 'h-36 w-36 text-13/normal',
  message: 'h-30 w-30 text-11/normal',
}

/*
 * One chip, and the four the screen draws. The surface, the face and the box are on the variant and
 * never on the base: two utilities of the same property on one element are settled by the order
 * Tailwind emitted them in, not by the order they are written.
 */
const CHIP = 'inline-flex shrink-0 items-center gap-5 whitespace-nowrap rounded-full font-normal text-10-5/normal'

const CAP_CHIP = 'bg-secondary px-9 py-3 font-code text-foreground'

const REPO_CHIP = 'bg-secondary px-8 py-3 font-code text-[#cbd5e1]'

/** The same chips on the candidate box, which is already the secondary surface. */
const CARD_CAP = 'bg-card px-9 py-3 font-code text-foreground'

const CARD_REPO = 'bg-card px-9 py-3 font-code text-[#cbd5e1]'

/** A provider's name is a word of ours, not a path: the frame sets it in the sans. */
const CARD_PROVIDER = 'bg-card px-9 py-3 font-sans text-[#cbd5e1]'

const SPACER = 'h-1 flex-1 basis-0'

const CAP_INPUT =
  'w-64 rounded-sm border border-input bg-background px-8 py-6 font-code text-13/normal text-foreground focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none'

/**
 * One Employee's card.
 *
 * Two rules the stylesheet made about the card as a whole, kept as arbitrary variants because they
 * are about what is inside it: everything but the click target lets clicks through, and the card
 * with its menu open sits above its neighbours — a dimmed card's own opacity makes it a stacking
 * context, which would otherwise trap the menu under the next card in the grid.
 *
 * **The menu is excluded from the `none` rule as well as named in an `auto` one** (T223). It is a
 * direct child of the card, so both rules match that one element with the same specificity, and
 * which of them wins is then Tailwind's emission order rather than anything said here — `none`
 * last, which put `pointer-events: none` on the open popover and every row in it. Edit did nothing,
 * and the menu could not be closed either, because it never got the events that close it. The
 * stylesheet this came from had the two in the other order, which is the whole of the difference.
 * Two rules that cannot both match cannot be decided by an order.
 */
const CARD =
  'relative flex min-w-0 flex-col gap-11 rounded-md border border-border bg-card p-14 has-[[data-card=open]:hover]:border-[#475569] has-[[data-card=menu]]:z-20 [&>*:not([data-card=open]):not([data-card=menu])]:pointer-events-none [&_[data-card=action]]:pointer-events-auto [&_[data-card=menu-button]]:pointer-events-auto [&_[data-card=menu]]:pointer-events-auto'

const CARD_OPEN =
  'absolute inset-0 m-0 cursor-pointer rounded-[inherit] border-0 bg-transparent p-0 focus-visible:shadow-focus focus-visible:outline-none'

/** Hidden until the card is under the pointer or holds the focus, or its own menu is open. */
const MORE =
  'absolute top-0 right-11 flex h-24 w-24 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-secondary p-0 text-muted-foreground opacity-0 hover:text-foreground aria-expanded:opacity-100 [[data-employee]:focus-within_&]:opacity-100 [[data-employee]:hover_&]:opacity-100'

const NAMES = 'flex min-w-0 flex-1 basis-0 flex-col gap-2'

const NAME = 'truncate font-bold text-15/normal text-foreground'

const ROLE = 'truncate font-semibold text-11-5/normal text-muted-foreground tracking-[0.3px]'

const PERSONA = 'm-0 font-normal text-12/18 text-muted-foreground'

/** The card's one warning line, in the warning ink the kit's Alert uses (T239). */
const SHUT_OUT =
  'm-0 flex w-full items-center gap-6 font-normal text-11/16 text-status-warning-foreground [&_svg]:shrink-0'

/** The right-hand panel: 404px, the card surface, a 64px head and a scrolling body. */
const PANEL = 'flex w-404 min-h-0 shrink-0 flex-col border-l border-l-border bg-card'

const PANEL_BODY =
  'flex min-h-0 flex-1 basis-0 flex-col gap-14 overflow-y-auto p-16 [&_[data-slot=empty-state]]:my-auto'

const MESSAGE = 'm-0 whitespace-pre-wrap font-normal text-12-5/19 text-[#cbd5e1]'

const LOAD = 'flex shrink-0 flex-col gap-9 rounded-sm border border-border bg-card p-12'

const LOAD_TITLE = 'whitespace-nowrap font-bold text-10/normal text-muted-foreground tracking-[0.8px]'

const LOAD_LABEL = 'whitespace-nowrap font-normal text-12/normal text-[#cbd5e1]'

const LOAD_VALUE = 'whitespace-nowrap font-code text-11-5/normal text-muted-foreground'

const CANDIDATE = 'flex shrink-0 flex-col gap-10 rounded-sm border border-[#475569] bg-secondary p-13'

const CANDIDATE_PERSONA = 'm-0 font-normal text-12/18 text-[#cbd5e1]'

const AUTONOMY =
  'flex shrink-0 items-center gap-9 rounded-sm bg-secondary px-12 py-10 text-muted-foreground [&_svg]:shrink-0'

const EFFECT = 'm-0 font-normal text-11-5/17 text-muted-foreground'

const REJECT = 'flex flex-col items-end gap-4 [&_[data-slot=field]]:self-stretch'

/** In the panel the error is the last thing in a gapped column, so it needs no margin of its own. */
const PANEL_ERROR = 'm-0 text-12/normal text-status-error-foreground'
