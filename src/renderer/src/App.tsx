import { useCallback, useEffect, useRef, useState } from 'react'
import type { Company } from '../../shared/company'
import type { Result } from '../../shared/domain/result'
import { SETUP_WINDOW_TITLE } from '../../shared/platform/windows-machine'
import { onOpenTicket, openTicket } from './board'
import { budgetTitle, useBudget } from './budget'
import {
  ContentHeader,
  HOME,
  listenForCloseRequests,
  onNavigate,
  type Route,
  requestLeave,
  reviewWindowTitle,
  SHELL,
  SHELL_BODY,
  SHELL_MAIN,
  TitleBar,
  testingWindowTitle,
  VIEW_LABEL,
  windowTitle,
} from './chrome'
import { useCompanyMove } from './company-move'
import { useCompanyRemoval } from './company-removal'
import { openHire } from './hiring'
import { resources, useIpcResource } from './ipc'
import { Launcher, type LauncherStep } from './launcher'
import { useNotificationClicks } from './notifications'
import { toggleLegend } from './office-view'
import { SetupWizard, setupTitle, useOnboarding } from './onboarding'
import { PreflightScreen, preflightTakesTheWindow, useDismissOnEscape, usePreflight } from './preflight'
import { onOpenReview, openReview, ReviewScreen, type ReviewTarget } from './review'
import {
  CompanyRail,
  type MenuCommandDeps,
  RouteView,
  runMenuCommand,
  ScreenBoundary,
  Sidebar,
  ticketToReview,
  useCompanyAttention,
  useShellData,
  viewHeading,
} from './shell'
import { onOpenTesting, TestingScreen, type TestingTarget } from './testing'
import { ShellUpdateNotice } from './updates'
import { useWindowsMachine, WindowsSetupStep, windowsSetupTakesTheWindow } from './windows-setup'
import './ui/tailwind.css'

const api = window.tinyCorp.company

export function App() {
  const [current, setCurrent] = useState<Company | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // The Launcher over an open Company, and whether its Create step was opened from that Company.
  const [launcher, setLauncher] = useState<{ step: LauncherStep; fromCompany: boolean } | null>(null)
  const [route, setRoute] = useState<Route>(HOME)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [pendingTicket, setPendingTicket] = useState<number | null>(null)
  // The Review screen (T75) fills the content area over whichever view is open, until it closes.
  const [review, setReview] = useState<ReviewTarget | null>(null)
  // The Testing screen (T174) fills the content area the same way, over whichever view is open.
  const [testing, setTesting] = useState<TestingTarget | null>(null)
  const routeRef = useRef(route)
  routeRef.current = route
  const data = useShellData(current?.id ?? null)
  const attention = useCompanyAttention()
  // A Company that never finished its setup wizard opens into it, wherever it was opened from, and
  // at the step it was left on (T59). Finish and Skip set the mark, and the Office opens behind it.
  const setup = useOnboarding(current?.id ?? null)
  const { budget } = useBudget(current?.id ?? null)
  useNotificationClicks()
  const removal = useCompanyRemoval()
  // Move Company… from the File menu (#223) is the same move Company settings' warning offers.
  const move = useCompanyMove()
  // Nothing here runs without the CLIs this Company's Employees are hired on (T129, T135), so the
  // app says so before it draws. The cards take the window once and let go the moment they are
  // dismissed or the answers come back good.
  const preflight = usePreflight()
  /**
   * The first launch on Windows (T249): where the team runs, and what the right button does. It
   * comes *before* the preflight, because the answer changes which CLI the preflight is even about:
   * a boss who says WSL here is asked about the one inside the distro, not the one on the Windows
   * `PATH`, and saving the answer re-asks.
   *
   * It does not dismiss: there is no Skip, and `Escape` is not wired to it.
   */
  const boss = useIpcResource(resources.bossProfile)
  const windows = useWindowsMachine()
  const showWindowsSetup = windowsSetupTakesTheWindow(windows.machine, boss)
  const [preflightDismissed, setPreflightDismissed] = useState(false)
  const showPreflight = !showWindowsSetup && preflightTakesTheWindow(preflight.preflight, preflightDismissed)
  const dismissPreflight = useCallback(() => setPreflightDismissed(true), [])
  useDismissOnEscape(showPreflight ? dismissPreflight : null)

  const refresh = useCallback(async () => {
    const [nextCurrent, nextList] = await Promise.all([api.current(), api.list()])
    setCurrent(nextCurrent)
    setCompanies(nextList)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    return api.onChanged(() => void refresh())
  }, [refresh])

  // A clicked notification opens the view that shows it; that view then takes the focus.
  useEffect(
    () =>
      window.tinyCorp.notifications.onFocus(({ focus }) =>
        setRoute(focus.kind === 'thread' ? { view: 'chat', channelId: focus.channelId } : { view: 'office' }),
      ),
    [],
  )

  // Every route the boss asks for goes through here, so a view holding something unsaved can ask
  // them first (T122); with nothing to ask, the route happens at once.
  const go = useCallback((next: Route) => {
    requestLeave(next, () => {
      setReview(null)
      setTesting(null)
      setRoute(next)
    })
  }, [])

  // A view asks for another one, e.g. the Employee drawer's DM button opening Chat. Leaving for
  // another view closes the Review screen, which sits over whichever view is open.
  useEffect(() => onNavigate(go), [go])

  // A ticket, a `#prs` card, a board card or an Inbox row opens the Review screen.
  useEffect(
    () =>
      onOpenReview((target) => {
        setTesting(null)
        setReview(target)
      }),
    [],
  )

  // The same, for a ticket in Testing: its board card, its Inbox row, or the agent's evidence card.
  useEffect(
    () =>
      onOpenTesting((target) => {
        setReview(null)
        setTesting(target)
      }),
    [],
  )

  // ⌘W: the view the boss is in closes what it has open — a Files tab (T121) — and with nothing
  // of its own to close the key falls through here, to leaving the Company for the Launcher.
  useEffect(() => listenForCloseRequests(() => setLauncher({ step: 'list', fromCompany: false })), [])

  /**
   * Every application-menu item whose work belongs to the window (#223). The menu sends the
   * command; this does the very thing the boss's own button does, through a ref so the menu never
   * has to resubscribe as the view changes.
   */
  const menuDeps = useRef<MenuCommandDeps | null>(null)
  menuDeps.current = {
    navigate: go,
    openReview: (ticketId) => openReview({ ticketId }),
    reviewTicket: () => ticketToReview(data.board, data.code),
    openHire,
    newCompany: () => openCreate(),
    openCompany: () => void openExisting(),
    openRecent: (companyId) => void switchTo(companyId),
    moveCompany: () => {
      if (current) move.move(current)
    },
    toggleLegend,
    sessions: window.tinyCorp.sessions,
    staff: window.tinyCorp.staff,
    onError: setError,
  }
  useEffect(
    () =>
      window.tinyCorp.shell.onMenuCommand((command) => {
        const deps = menuDeps.current
        if (deps) void runMenuCommand(command, deps)
      }),
    [],
  )
  // A move that failed says so where every other Company error is said.
  useEffect(() => {
    if (move.error) setError(move.error.message)
  }, [move.error])

  // A `#12` link opens the board first, then hands the ticket over once the board listens.
  useEffect(
    () =>
      onOpenTicket((id) => {
        if (routeRef.current.view === 'board') return
        setPendingTicket(id)
        setRoute({ view: 'board' })
      }),
    [],
  )
  useEffect(() => {
    if (route.view !== 'board' || pendingTicket === null) return
    setPendingTicket(null)
    openTicket(pendingTicket)
  }, [route, pendingTicket])

  // With no Company open the window is the Launcher; the rail's `+` and New Company open its Create step.
  const showLauncher = loaded && (!current || launcher !== null)
  const launcherStep: LauncherStep = launcher?.step ?? 'list'
  const showWizard = !showLauncher && current !== null && setup.incomplete

  // Out of budget, the Office's title says so (design/html/out-of-budget.html); the Launcher is the app's.
  const title = showWindowsSetup
    ? SETUP_WINDOW_TITLE
    : showLauncher
      ? windowTitle(null, route)
      : showWizard
        ? setupTitle(current.name)
        : current && review
          ? reviewWindowTitle(current, review.ticketId)
          : current && testing
            ? testingWindowTitle(current, testing.ticketId)
            : current && budget && route.view === 'office'
              ? budgetTitle(current.name)
              : windowTitle(current?.name ?? null, route)
  useEffect(() => {
    document.title = title
  }, [title])

  async function run(action: Promise<Result<Company>>) {
    const result = await action
    setError(result.ok ? null : result.error)
    return result.ok
  }

  async function switchTo(id: string) {
    if (await run(api.switchTo(id))) setRoute(HOME)
  }

  useEffect(() => {
    // `PreflightScreen` and the Windows step are the Launcher's own window, so they keep its size.
    const launcherSized = showLauncher || showPreflight || showWindowsSetup
    if (loaded) void window.tinyCorp.launcher.setWindowLayout(launcherSized ? 'launcher' : 'company')
  }, [loaded, showLauncher, showPreflight, showWindowsSetup])

  function openCreate() {
    setLauncher({ step: 'create', fromCompany: true })
  }

  async function openExisting() {
    const folder = await api.pickFolder()
    if (folder && (await run(api.open(folder)))) setRoute(HOME)
  }

  const heading = current ? viewHeading(route, current, data) : null

  if (!loaded) return null
  // Asked once, on the first launch on Windows, before anything else this app would draw (T249).
  if (showWindowsSetup && windows.machine) {
    return (
      <WindowsSetupStep
        machine={windows.machine}
        boss={boss}
        onRecheck={() => windows.recheck()}
        onDone={(answers) => void window.tinyCorp.profile.update({ ...answers, windowsSetupDone: true })}
      />
    )
  }
  // The cards take the window once, before anything else, and let go the moment they are dismissed
  // or the answers are good; the rest of the app opens behind them either way.
  if (showPreflight) {
    return (
      <PreflightScreen
        blocked={preflight.blocked}
        boss={boss}
        checking={preflight.checking}
        onRecheck={preflight.recheck}
        onDismiss={dismissPreflight}
      />
    )
  }
  if (showLauncher) {
    return (
      <Launcher
        current={current}
        step={launcherStep}
        onStep={(step) => setLauncher({ step, fromCompany: false })}
        onCancelCreate={() =>
          setLauncher(launcher?.fromCompany && current ? null : { step: 'list', fromCompany: false })
        }
        onClose={(switched) => {
          setLauncher(null)
          if (switched) setRoute(HOME)
        }}
        onCreated={() => {
          // A Company is created with its wizard unfinished, so it opens into it on its own.
          setLauncher(null)
          setRoute(HOME)
        }}
      />
    )
  }
  if (showWizard && setup.progress) {
    return (
      <SetupWizard
        company={current}
        progress={setup.progress}
        onLeave={() => {
          // Finish marked the wizard done, so reading the mark again opens the Office for good.
          setup.reload()
          setRoute({ view: 'office' })
        }}
      />
    )
  }
  // Between a Company becoming current and its mark coming back, neither screen is the right one —
  // but the window is: the title bar, the rail and the sidebar stay, and only the view waits.
  // Returning nothing here blanked the whole window on every switch, which read as a flicker (T287).

  return (
    <div className={SHELL}>
      <TitleBar
        title={title}
        notice={<ShellUpdateNotice />}
        onToggleSidebar={current ? () => setSidebarOpen((open) => !open) : undefined}
        onToggleMaximize={() => void window.tinyCorp.shell.toggleMaximize()}
      />
      <div className={SHELL_BODY}>
        <CompanyRail
          companies={companies}
          currentId={current?.id ?? null}
          onSwitch={(id) => void switchTo(id)}
          onCreate={openCreate}
          onMenu={removal.openMenu}
          attention={attention}
        />
        {removal.overlay}
        {current && sidebarOpen && (
          <Sidebar
            company={current}
            companies={companies}
            data={data}
            route={route}
            onNavigate={go}
            onSwitch={(id) => void switchTo(id)}
            onCreate={openCreate}
            onOpen={() => void openExisting()}
          />
        )}
        <main className={SHELL_MAIN}>
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
          {current && heading && !setup.loading && (
            <ContentHeader title={heading.title} subtitle={heading.subtitle}>
              {/* One broken screen never takes the app with it (T128); a new key is a cleared crash. */}
              <ScreenBoundary
                key={`${current.id}:${review ? 'review' : testing ? 'testing' : route.view}`}
                route={review ? 'review' : testing ? 'testing' : route.view}
                where={`${review ? 'Review' : testing ? 'Testing' : VIEW_LABEL[route.view]} · ${current.name}`}
              >
                {review ? (
                  <ReviewScreen key={review.ticketId} target={review} onClose={() => setReview(null)} />
                ) : testing ? (
                  <TestingScreen key={testing.ticketId} target={testing} onClose={() => setTesting(null)} />
                ) : (
                  <RouteView route={route} company={current} onNavigate={go} />
                )}
              </ScreenBoundary>
            </ContentHeader>
          )}
        </main>
      </div>
    </div>
  )
}
