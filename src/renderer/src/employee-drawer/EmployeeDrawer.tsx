import {
  BookOpen,
  CirclePlay,
  MessageSquare,
  Play,
  Settings2,
  Shield,
  ShieldOff,
  Sparkles,
  Square,
  SquareTerminal,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react'
import { type ReactNode, type PointerEvent as ReactPointerEvent, Suspense, useEffect, useState } from 'react'
import type { SkillRow } from '../../../shared/catalogue/skills'
import type { Subtask } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import type { SpriteState } from '../../../shared/office/projection'
import { SANDBOX_DRAWER_UNJAILED } from '../../../shared/sandbox'
import type { SessionHandoff, SessionRouting, SessionStatus } from '../../../shared/session'
import { modelLabel } from '../../../shared/staff/models'
import type { SubSessionInfo } from '../../../shared/sub-sessions'
import type { SubagentInfo } from '../../../shared/subagents'
import { useInbox } from '../inbox'
import { resources, useIpcResource } from '../ipc'
import { RoutingChip } from '../routing'
import { LiveTerminal, RtkChip } from '../terminal'
import { Avatar, Badge, Button, cx, EmptyState, Tabs, Toast } from '../ui'
import { ChatsPanel, useEmployeeChats } from './ChatsPanel'
import { unreadTotal } from './chats-model'
import {
  COPY_HANDOFF_LABEL,
  copiedLine,
  type DrawerTab,
  formatUptime,
  handoffBlocked,
  openTickets,
  PERMISSION_META_LABEL,
  providerMeta,
  roleLine,
  STATE_BADGE,
  sessionMeta,
  skillsItem,
  startBlocked,
} from './drawer-model'
import { clampWidth, rememberedWidth, rememberWidth } from './drawer-width'
import { NotesPanel, useNotes } from './NotesPanel'
import { SubagentStrip } from './SubagentStrip'
import { terminalOf } from './subagents-model'
import { PILL, TicketCard } from './TicketCard'
import '../ui/tailwind.css'

const sessionApi = window.tinyCorp.sessions

const UPTIME_TICK_MS = 30_000
/** How long the copied toast stays up. */
const COPIED_MS = 3000

export interface EmployeeDrawerProps {
  employee: Employee
  status: SessionStatus
  /** When the running Session started; null while off. */
  startedAt: string | null
  /** The Employee's state as the office shows it. */
  state: SpriteState
  /** Whether the Employee's Provider can be started on this machine. Assumed so when unknown. */
  providerReady?: boolean
  /** The Company's skill catalogue, for the strip's skills item (T137). */
  skills?: readonly SkillRow[] | undefined
  /** The subagents its running Session reports (T162). None draws no strip. */
  subagents?: readonly SubagentInfo[] | undefined
  /** The Sessions it started of its own (T163); picking one's chip shows that Session's terminal. */
  subSessions?: readonly SubSessionInfo[] | undefined
  /** The Company's concurrency cap, for the seat line under the strip; null when not known. */
  concurrencyCap?: number | null
  onStart(): void
  onStop(): void
  onClose(): void
  /** Opens the boss's DM with the Employee in Chat. */
  onDm(): void
  /** The tab the drawer opens on; Terminal by default. */
  defaultTab?: DrawerTab
  /**
   * Where this Employee is working while its own Provider is out (T173); null while it is on its
   * own. It draws the chip of frame `tdI8o` under the meta strip.
   */
  routedTo?: SessionRouting | null
  /**
   * The Company turned the Sandbox add-on on and this Employee's Sessions are starting without it
   * (T260) — on Windows itself, where ai-jail does not run. It is a word on the meta strip the
   * drawer already draws, because the boss asked for something this Employee is not getting.
   */
  unjailed?: boolean
}

/**
 * The Employee drawer (`design/html/employee-drawer.html`, 440 wide). It floats over the content's
 * right edge; the sidebar stays visible.
 *
 * `line-height: normal` is on the drawer root, as the sheet had it, and everything inside inherits
 * it — which is why each size-only list below says `/[normal]` rather than taking the type scale's
 * own leading. `employee-drawer__handoff` stays in its list: `handoff.dom.test.tsx` clicks it.
 *
 * `top-108` was `.shell .employee-drawer { top: calc(44px + 64px) }` — the **shell** deciding where
 * the drawer sits, from outside it, which no utility can express. T210f took `shell.css` away, so
 * the sum sits on the drawer instead: the 44px title bar (`chrome/TitleBar.tsx`) and the 64px content
 * header (`SHELL_HEADER`), which are the two things it opens below. The capture harnesses give it
 * `position: static`, so none of them reads it.
 */
export const DRAWER =
  'employee-drawer fixed top-108 right-0 bottom-0 z-10 flex max-w-screen flex-col border-l border-border bg-card font-sans leading-[normal] shadow-employee-drawer'

const HANDLE =
  'absolute inset-y-0 -left-4 z-1 m-0 w-8 cursor-col-resize border-0 touch-none hover:bg-[color-mix(in_srgb,var(--primary)_35%,transparent)]'

const HEAD = 'flex shrink-0 items-center gap-12 border-b border-border px-16 py-14'

const NAME = 'm-0 whitespace-nowrap font-bold text-16/[normal] tracking-[-0.2px] text-foreground'

const ROLE = 'overflow-hidden text-ellipsis whitespace-nowrap font-normal text-11-5/[normal] text-muted-foreground'

/* The state dot's tone. A map rather than four rules, so the colour cannot be decided by which of
   two same-specificity utilities Tailwind happens to emit last. `quiet` is what the sheet's own
   base rule drew. */
const PILL_DOT = {
  live: '[&_[data-slot=badge-dot]]:bg-brand-success',
  wait: '[&_[data-slot=badge-dot]]:bg-brand-warning',
  stop: '[&_[data-slot=badge-dot]]:bg-brand-danger',
  quiet: '[&_[data-slot=badge-dot]]:bg-brand-text-muted',
} satisfies Record<'live' | 'wait' | 'stop' | 'quiet', string>

const CLOSE =
  'm-0 flex size-18 shrink-0 cursor-pointer rounded-xs border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

const META = 'flex shrink-0 items-center gap-8 border-b border-border bg-card px-16 py-10 text-muted-foreground'

const META_ITEM = 'flex shrink-0 items-center gap-5 whitespace-nowrap font-semibold text-11-5/[normal]'

const UPTIME = 'whitespace-nowrap font-code font-normal text-11/[normal]'

/*
 * The handoff button (frames `zOVl6`, `NnYV6`): 22px, after the uptime. Its icon is the primary
 * colour while a Session can be handed over and the strip's own grey while it cannot.
 */
const HANDOFF =
  'employee-drawer__handoff flex size-22 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border bg-transparent p-0 text-primary hover:not-disabled:bg-muted disabled:cursor-default disabled:text-muted-foreground'

/* The copied toast floats under the meta strip, over whichever tab is open. */
const COPIED =
  'absolute top-108 right-16 left-16 z-2 [&_[data-slot=toast-message]]:font-code [&_[data-slot=toast-message]]:text-12'

/*
 * The frame rasterises the tab row at 41 — a 40 tall tab over the rule — where the HTML export's
 * 12/11 padding comes out at 44 in a browser, because a button pads its line box out by one each side
 * and the count badge lifts the row again. The height pins it: 12 + a 16px line + 10 + the 2px
 * underline, with the badge centred on the line as the frame draws it.
 */
const TABS =
  'shrink-0 gap-4 border-b border-border px-16 shadow-none [&_[data-slot=tab]]:h-40 [&_[data-slot=tab]]:gap-6 [&_[data-slot=tab]]:border-b-2 [&_[data-slot=tab]]:border-b-transparent [&_[data-slot=tab]]:px-10 [&_[data-slot=tab]]:pt-12 [&_[data-slot=tab]]:pb-10 [&_[data-slot=tab]]:font-medium [&_[data-slot=tab]]:text-13 [&_[data-slot=tab]]:text-muted-foreground [&_[data-slot=tab][data-active]]:border-b-border-strong [&_[data-slot=tab][data-active]]:font-bold [&_[data-slot=tab][data-active]]:text-foreground'

const COUNT = 'h-18 min-w-18 bg-secondary px-5 font-bold text-9 text-soft-ink'

/*
 * The Memory tab draws its own bar and padding, edge to edge, so it takes the panel flush.
 *
 * `PANEL_FLUSH` is a **whole list, not an override.** `.--flush` used to say `gap: 0; padding: 0`
 * and win by coming later in the sheet; two padding utilities on one element are settled by
 * Tailwind's own emission order instead, and `p-0` loses to `px-14 py-12` — which put the drawer's
 * Memory tab 15px in from the edge until the pixel table caught it. Zero gap and zero padding are
 * what a `div` does anyway, so the flush list simply does not ask for them.
 *
 * Both are exported because the capture harnesses mount the panel themselves, and a second copy of
 * these numbers is exactly the drift T196 spent an afternoon on.
 */
export const PANEL = 'flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-14 py-12'

export const PANEL_FLUSH = 'flex min-h-0 flex-1 flex-col overflow-hidden'

/* The frame's buttons are 34 tall: 9px of padding around a 16px line. */
/**
 * Where the ticket card sits under the terminal: never more than 40% of the drawer, so an opened
 * checklist scrolls inside the card rather than taking the terminal's rows (TI-2).
 */
const TICKET_SLOT = 'flex max-h-[40%] min-h-0 shrink-0 flex-col px-14 pt-0 pb-12'

const FOOTER =
  'flex shrink-0 items-center gap-10 border-t border-border px-14 py-12 [&_[data-slot=button]]:text-13/16 [&_[data-slot=button]_svg]:size-14'

/* The frame rasterises Stop at 132x34 with its stroke inside the 9px 14px padding, as the kit does. */
const SESSION = 'px-13 py-8'

/* Inert as designed, not dimmed (decision 31). */
const PROVIDER = 'px-12 py-9 disabled:opacity-100'

/** The Employee drawer (design/html/employee-drawer.html): header, session meta, tabs and footer actions. */
/**
 * The Employee drawer: header, session meta, tabs and footer actions.
 *
 * Whoever opens it keys it by Employee: another Employee is another drawer, on its own default tab,
 * with no subagent picked and its own conversations, and a key says all of that at once (T211).
 */
export function EmployeeDrawer(props: EmployeeDrawerProps) {
  const { employee, status } = props
  const [tab, setTab] = useState<DrawerTab>(props.defaultTab ?? 'terminal')
  const [width, setWidth] = useState(() => rememberedWidth(window.innerWidth))
  const [error, setError] = useState<string | null>(null)
  const [pickedSubagent, setPickedSubagent] = useState<string | null>(null)
  const inbox = useInbox(employee.id)
  const notes = useNotes(employee.id, employee.name, status)
  const chats = useEmployeeChats(employee.id)
  const unread = unreadTotal(chats.conversations)
  const snapshot = useIpcResource(resources.board)
  const tickets = openTickets(snapshot?.tickets ?? [], employee.id)
  const epicOf = (epicId: number | null) => snapshot?.epics.find((epic) => epic.id === epicId) ?? null
  const now = useNow(UPTIME_TICK_MS)
  const uptime = formatUptime(props.startedAt, now)
  const badge = STATE_BADGE[props.state]
  const running = status !== 'off'
  const providerReady = props.providerReady ?? true
  const skills = skillsItem(employee, props.skills ?? [])
  const blocked = startBlocked(employee.provider, providerReady)
  // A sub-session's chip swaps in its own terminal; everything else leaves the Employee's on screen.
  const terminalId = terminalOf(employee.id, props.subSessions ?? [], pickedSubagent)
  const skips = employee.permissionMode === 'skip-permissions'
  // The command that opens this Session in the boss's own terminal (T164), built by the Provider.
  const handoff = useHandoff(employee.id, status)
  const handoffOff = handoffBlocked(status)
  const [copied, setCopied] = useState<string | null>(null)

  async function copyHandoff() {
    if (handoff === null || handoffOff !== null || !(await copyText(handoff.command))) return
    setCopied(copiedLine(handoff.shown))
  }

  useEffect(() => {
    if (copied === null) return
    const timer = setTimeout(() => setCopied(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape belongs to the terminal; close with Cmd/Ctrl+Escape.
      if (event.key === 'Escape' && (event.metaKey || event.ctrlKey)) props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])

  function toggle(subtask: Subtask) {
    void window.tinyCorp.board
      .apply({ kind: 'updateSubtask', id: subtask.id, changes: { done: !subtask.done } })
      .then((result) => setError(result.ok ? null : result.error))
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => setWidth(clampWidth(window.innerWidth - e.clientX, window.innerWidth))
    const up = (e: PointerEvent) => {
      rememberWidth(clampWidth(window.innerWidth - e.clientX, window.innerWidth))
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <aside className={DRAWER} style={{ width }} aria-label={`${employee.name}’s drawer`} data-testid="employee-drawer">
      <hr className={HANDLE} aria-orientation="vertical" title="Drag to resize" onPointerDown={startDrag} />
      <header className={HEAD}>
        <Avatar name={employee.name} person={{ id: employee.id, sprite: employee.sprite }} className="rounded-sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-8">
            <h2 className={NAME}>{employee.name}</h2>
            <Badge variant="neutral" className={cx(PILL, 'text-11', PILL_DOT[badge.tone])}>
              {badge.label}
            </Badge>
          </div>
          <div className={ROLE}>{roleLine(employee)}</div>
        </div>
        <button type="button" className={CLOSE} aria-label="Close" title="Close (Ctrl+Esc)" onClick={props.onClose}>
          <X size={18} aria-hidden />
        </button>
      </header>

      <div className={META}>
        <Meta icon={<CirclePlay size={13} aria-hidden />}>{sessionMeta(status)}</Meta>
        <Meta icon={<TerminalIcon size={13} aria-hidden />}>{providerMeta(employee.provider, providerReady)}</Meta>
        <Meta icon={skips ? <ShieldOff size={13} aria-hidden /> : <Shield size={13} aria-hidden />}>
          {PERMISSION_META_LABEL[employee.permissionMode]}
        </Meta>
        {/* The frame's strip is Session · Provider · Permission · uptime; a chosen model earns its own item. */}
        {employee.model !== null && (
          <Meta icon={<Sparkles size={13} aria-hidden />}>{modelLabel(employee.provider, employee.model)}</Meta>
        )}
        {/* An Employee holding skills says how many; on a Provider that reads none it says that. */}
        {skills !== null && <Meta icon={<BookOpen size={13} aria-hidden />}>{skills}</Meta>}
        {/* The add-on is on for the Company and this Session is not getting it (T260). */}
        {props.unjailed && <Meta icon={<ShieldOff size={13} aria-hidden />}>{SANDBOX_DRAWER_UNJAILED}</Meta>}
        <span className="flex-1" />
        {uptime !== null && (
          <span className={UPTIME} title={`Session started ${props.startedAt}`}>
            {uptime}
          </span>
        )}
        {/*
          The handoff button (frame `zOVl6`), after the uptime. It copies; it runs nothing. A
          Provider that builds no command hands back null and there is no button at all.
        */}
        {handoff !== null && (
          <button
            type="button"
            className={HANDOFF}
            aria-label={handoffOff ?? COPY_HANDOFF_LABEL}
            title={handoffOff ?? COPY_HANDOFF_LABEL}
            disabled={handoffOff !== null}
            onClick={() => void copyHandoff()}
          >
            <SquareTerminal size={13} aria-hidden />
          </button>
        )}
      </div>

      {/* Off its own Provider: where it is, and the way back before the reset (T173). */}
      {props.routedTo && <RoutingChip routing={props.routedTo} employeeId={employee.id} now={new Date(now)} />}

      {copied && (
        <Toast className={COPIED}>
          {/* The line wraps between words, never inside a flag, as the frame breaks it. */}
          {copied.split(' ').map((word, index) => (
            <span key={index} className="whitespace-pre">
              {index > 0 && ' '}
              {word}
            </span>
          ))}
        </Toast>
      )}

      <Tabs
        className={TABS}
        value={tab}
        onChange={(id) => setTab(id as DrawerTab)}
        items={[
          { id: 'terminal', label: 'Terminal' },
          { id: 'ticket', label: 'Ticket' },
          {
            id: 'chats',
            label: (
              <>
                Chats
                {unread > 0 && (
                  <Badge variant="count" className={COUNT}>
                    {unread}
                  </Badge>
                )}
              </>
            ),
          },
          { id: 'memory', label: 'Memory' },
        ]}
      />

      {(error ?? blocked) && (
        <p className="mt-8 mr-14 mb-0 ml-14 shrink-0 text-12/[normal] text-destructive" role="alert">
          {error ?? blocked}
        </p>
      )}

      {/* xterm arrives with the first drawer of the session (T211); the box is empty for that tick. */}
      <Suspense fallback={null}>
        <LiveTerminal
          key={terminalId}
          employeeId={terminalId}
          active={tab === 'terminal'}
          onError={setError}
          header={
            <>
              {/* What RTK cut of what this Employee read (T179). Nothing at all when it is off. */}
              <RtkChip />
              <SubagentStrip
                employeeName={employee.name}
                status={status}
                subagents={props.subagents ?? []}
                subSessions={props.subSessions ?? []}
                concurrencyCap={props.concurrencyCap ?? null}
                picked={pickedSubagent}
                onPick={setPickedSubagent}
                now={now}
              />
            </>
          }
        />
      </Suspense>
      {tab === 'terminal' && tickets[0] && (
        <div className={TICKET_SLOT}>
          <TicketCard
            ticket={tickets[0]}
            companyKey={inbox.companyKey}
            epic={epicOf(tickets[0].epicId)}
            onToggle={toggle}
            foldable
          />
        </div>
      )}
      {tab === 'ticket' && (
        <div className={PANEL} role="tabpanel">
          {tickets.length === 0 ? (
            <EmptyState title="No open ticket" body={`${employee.name} has nothing open on the board.`} />
          ) : (
            tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                companyKey={inbox.companyKey}
                epic={epicOf(ticket.epicId)}
                onToggle={toggle}
              />
            ))
          )}
        </div>
      )}
      {tab === 'chats' && <ChatsPanel chats={chats} employee={employee} inbox={inbox} />}
      {tab === 'memory' && (
        <div className={PANEL_FLUSH} role="tabpanel">
          <NotesPanel notes={notes} />
        </div>
      )}

      <footer className={FOOTER}>
        {running ? (
          <Button variant="outline" size="sm" icon={Square} className={SESSION} onClick={props.onStop}>
            Stop Session
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            icon={Play}
            className={SESSION}
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={props.onStart}
          >
            Start Session
          </Button>
        )}
        <span className="flex-1" />
        {/* Provider switching is out of scope in v1 (decision 31): shown as designed, inert. */}
        <Button
          variant="ghost"
          size="sm"
          icon={Settings2}
          className={PROVIDER}
          disabled
          title="Switching Provider comes after v1"
        >
          Provider
        </Button>
        <Button variant="primary" size="sm" icon={MessageSquare} className="px-14 py-9" onClick={props.onDm}>
          DM {employee.name}
        </Button>
      </footer>
    </aside>
  )
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className={META_ITEM}>
      {icon}
      {children}
    </span>
  )
}

/**
 * The handoff command for this Employee, reread whenever its Session starts or stops: a Session
 * that has never run has none, and the first one gives the Employee one. Null while it has none.
 */
function useHandoff(employeeId: string, status: SessionStatus): SessionHandoff | null {
  const [handoff, setHandoff] = useState<SessionHandoff | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a Session starting or stopping is what gives the Employee a handoff, as the doc above says.
  useEffect(() => {
    let live = true
    void sessionApi.handoffCommand(employeeId).then((result) => {
      if (live) setHandoff(result.ok ? result.value : null)
    })
    return () => {
      live = false
    }
  }, [employeeId, status])
  return handoff
}

/** The clipboard, which a window without one simply does not have. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
