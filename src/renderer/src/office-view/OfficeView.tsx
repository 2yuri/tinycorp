import { type RefObject, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CapacityInfo } from '../../../shared/capacity'
import type { Company } from '../../../shared/company'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { sandboxUnjailed } from '../../../shared/sandbox'
import { BudgetOverlay, useBudget, workingSessions } from '../budget'
import type { Route } from '../chrome'
import { navigate } from '../chrome'
import { EmployeeDrawer } from '../employee-drawer'
import { useSkills } from '../employees'
import { openHire } from '../hiring'
import { resources, useIpcResource } from '../ipc'
import { onNotificationFocus } from '../notifications'
import { BossDesk, Office, type OfficeHandle, useOfficeScene } from '../office'
import { useRoutingSettings } from '../routing'
import { useSessionStatuses } from '../sessions'
import { assignTask } from './assign-task'
import { ControlDock } from './ControlDock'
import { fallbackOffer } from './fallback-offer'
import { officeHeaderFacts } from './header-facts'
import { MapControls } from './MapControls'
import { OfficeHeader } from './OfficeHeader'
import { OfficeLegend } from './OfficeLegend'
import { useKeepAwake } from './use-keep-awake'
import { usePaused } from './use-paused'
import '../ui/tailwind.css'

export interface OfficeViewProps {
  company: Company
  onNavigate(route: Route): void
}

/** The Office view: the floor's header, the PixiJS office, the task bar and full screen. */
export function OfficeView(props: OfficeViewProps) {
  const employees = useEmployees()
  const skills = useSkills()
  const answerer = useAnswerer(employees)
  const capacity = useCapacity()
  const sessions = useSessionStatuses(employees)
  // The boss turned the jail on and this machine cannot give it (T260): the drawer says so.
  const sandbox = useIpcResource(resources.sandbox)
  const pause = usePaused()
  const scene = useOfficeScene(employees, props.company.boss.sprite)
  const facts = useMemo(() => officeHeaderFacts(scene.sprites), [scene.sprites])
  const [error, setError] = useState<string | null>(null)
  const { budget, now } = useBudget(props.company.id)
  // What the Company would do instead of waiting, and who it would move (T173, frame `tdI8o` c).
  const routing = useRoutingSettings()
  const continueOn = fallbackOffer(routing, sessions.statuses)
  // "Wait for the reset" hides the overlay until the limit is hit again.
  const [waited, setWaited] = useState<string | null>(null)

  const [terminalFor, setTerminalFor] = useState<string | null>(null)
  const [deskOpen, setDeskOpen] = useState(false)
  const closeTerminal = useCallback(() => setTerminalFor(null), [])
  const closeDesk = useCallback(() => setDeskOpen(false), [])
  const terminalEmployee = employees.find((e) => e.id === terminalFor)
  // A clicked notification about an Employee lands here and opens their terminal.
  useEffect(
    () => onNotificationFocus(props.company.id, 'employee', (focus) => setTerminalFor(focus.employeeId)),
    [props.company.id],
  )

  const office = useRef<OfficeHandle>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [_zoom, setZoom] = useState(1)
  const fullscreen = useFullscreen(canvas, () => office.current?.fit())
  // The coffee cup beside it decides whether this Mac may sleep while the office works (T99).
  const keepAwake = useKeepAwake()

  const running = Object.entries(sessions.statuses).filter(([, status]) => status !== 'off')

  async function submitTask(text: string) {
    const result = await assignTask(window.tinyCorp.chat.post, answerer?.id ?? null, text)
    setError(result && !result.ok ? result.error : null)
    return result?.ok ?? false
  }

  return (
    <section className={VIEW}>
      <OfficeHeader
        floor={props.company.name}
        facts={facts}
        capacity={budget && capacity ? { ...capacity, running: workingSessions(sessions.statuses) } : capacity}
        outOfBudget={!!budget}
        canPause={running.length > 0}
        onPauseAll={pause.pauseAll}
        paused={pause.paused}
        onResumeAll={pause.resumeAll}
        onHire={() => {
          props.onNavigate({ view: 'employees' })
          openHire()
        }}
      />
      {/* Split: the floor, and `Your desk` beside it when it is open (frame KP0yY). The panel takes
          its 420px from the canvas, so the office recentres into what is left instead of hiding
          under it. */}
      <div className="flex min-h-0 flex-1 basis-0 overflow-hidden">
        <div className={CANVAS} ref={canvas} data-out-of-budget={budget ? true : undefined}>
          <div className={MAP}>
            {/* The canvas is its own chunk (T211); the floor is the app's background until it lands. */}
            <Suspense fallback={null}>
              <Office
                ref={office}
                scene={scene}
                company={props.company}
                onZoom={setZoom}
                onSelect={(employeeId) => {
                  setDeskOpen(false)
                  setTerminalFor(employeeId)
                }}
                onBossDesk={() => {
                  setTerminalFor(null)
                  setDeskOpen(true)
                }}
              />
            </Suspense>
          </div>
          {(error ?? pause.error ?? sessions.error) && (
            <p className={ERROR} role="alert">
              {error ?? pause.error ?? sessions.error}
            </p>
          )}
          {budget && waited !== budget.exhaustedAt && (
            <BudgetOverlay
              budget={budget}
              now={now}
              resumesAutomatically={routing?.routing.resumeAtReset ?? true}
              continueOn={continueOn}
              onWait={() => setWaited(budget.exhaustedAt)}
            />
          )}
          <ControlDock answererName={answerer?.name ?? null} onSubmit={submitTask} />
          <OfficeLegend />
          <MapControls
            fullscreen={fullscreen.active}
            onFullscreen={fullscreen.toggle}
            keepAwake={keepAwake.state}
            onKeepAwake={keepAwake.setMode}
          />
          {deskOpen && <BossDesk companyId={props.company.id} onClose={closeDesk} />}
        </div>
      </div>
      {terminalEmployee && (
        <EmployeeDrawer
          key={terminalEmployee.id}
          employee={terminalEmployee}
          skills={skills}
          status={sessions.statuses[terminalEmployee.id] ?? 'off'}
          startedAt={sessions.startedAt[terminalEmployee.id] ?? null}
          providerReady={sessions.providerReady[terminalEmployee.id] ?? true}
          unjailed={sandboxUnjailed(sandbox.status, sandbox.settings)}
          subagents={sessions.subagents[terminalEmployee.id]}
          subSessions={sessions.subSessions[terminalEmployee.id]}
          routedTo={sessions.routedTo[terminalEmployee.id] ?? null}
          concurrencyCap={capacity?.concurrencyCap ?? null}
          state={scene.sprites.find((s) => s.employeeId === terminalEmployee.id)?.state ?? 'off'}
          onStart={() => sessions.start(terminalEmployee.id)}
          onStop={() => sessions.stop(terminalEmployee.id)}
          onClose={closeTerminal}
          onDm={() => {
            closeTerminal()
            navigate({ view: 'chat', channelId: dmChannelId(BOSS, terminalEmployee.id) })
          }}
        />
      )}
    </section>
  )
}

/*
 * The Office view (design/html/office.html layers `Top Bar`, `Office Canvas`), as utilities (T210f).
 *
 * `#0b1220` is the canvas's own floor colour, `#ffffff1f` the panel's stroke: two of the six
 * office-only colours the design uses that no token names. `office-view.css` kept them as custom
 * properties on `:root`; they are written where they are drawn now, because each is read in one or
 * two places and a `:root` in a screen's sheet is a token by the back door.
 */
/*
 * The room fills the view, and the view is this one list rather than the shell's over it: two
 * `overflow-*` utilities on one element are settled by the order Tailwind emitted them in, and the
 * office is the one view that does not scroll.
 */
const VIEW = 'relative flex min-h-0 flex-1 basis-0 flex-col overflow-hidden bg-[#0b1220]'

/** Office Canvas: the room, centred in whatever the window leaves. */
const CANVAS = 'relative flex min-h-0 flex-1 basis-0 items-center justify-center overflow-hidden bg-[#0b1220] p-24'

/** The room's own box, which full screen lets grow to the display. */
const MAP =
  'h-660 max-h-full w-1040 max-w-full shrink-0 overflow-hidden rounded-md border border-[#ffffff1f] bg-background [:fullscreen_&]:h-full [:fullscreen_&]:w-full'

const ERROR =
  'absolute top-12 left-1/2 m-0 -translate-x-1/2 rounded-sm bg-status-error px-12 py-6 text-12/normal text-status-error-foreground'

/** The Employee a task from the task bar goes to: who answers the boss (decision 41). */
function useAnswerer(employees: Employee[]): Employee | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const api = window.tinyCorp.answerer
    let live = true
    const refresh = async () => {
      const result = await api.get()
      if (live && result.ok) setId(result.value.answererId ?? result.value.waitingForId)
    }
    void refresh()
    const off = api.onChanged(() => void refresh())
    return () => {
      live = false
      off()
    }
  }, [])
  return employees.find((e) => e.id === id) ?? null
}

function useEmployees(): Employee[] {
  const [employees, setEmployees] = useState<Employee[]>([])
  useEffect(() => {
    const api = window.tinyCorp.staff
    let live = true
    const refresh = async () => {
      const result = await api.employees()
      if (live && result.ok) setEmployees(result.value)
    }
    void refresh()
    const off = api.onChanged(() => void refresh())
    return () => {
      live = false
      off()
    }
  }, [])
  return employees
}

function useCapacity(): CapacityInfo | null {
  const [info, setInfo] = useState<CapacityInfo | null>(null)
  useEffect(() => {
    const api = window.tinyCorp.capacity
    let live = true
    const refresh = async () => {
      const result = await api.get()
      if (live && result.ok) setInfo(result.value)
    }
    void refresh()
    const offCapacity = api.onChanged(() => void refresh())
    // The running count moves with Sessions, which capacity does not always announce.
    const offSessions = window.tinyCorp.sessions.onChanged(() => void refresh())
    return () => {
      live = false
      offCapacity()
      offSessions()
    }
  }, [])
  return info
}

/** Full screen for `element`, calling `onChange` once the size has settled either way. */
function useFullscreen(element: RefObject<HTMLElement | null>, onChange: () => void) {
  const [active, setActive] = useState(false)
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    const sync = () => {
      setActive(document.fullscreenElement !== null && document.fullscreenElement === element.current)
      // The stage resizes on the next frame; fit after it.
      requestAnimationFrame(() => requestAnimationFrame(() => latest.current()))
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [element])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void element.current?.requestFullscreen()
  }, [element])

  return { active, toggle }
}
