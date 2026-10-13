// A dev-only capture of Company settings against the design's own fixture, so the page can be
// compared with `design/screens/QgXdU.png` (General), `design/screens/V0brJM.png` (`?tab=office`),
// `design/screens/bB6VX.png` (`?tab=routing`), `design/screens/zpvHQ.png` (`?tab=environments`),
// `design/screens/Cg3a8.png` (`?tab=tokens`), `design/screens/ttODp.png` and
// `design/screens/U8MYE.png` (`?tab=addons`) and
// `design/screens/uApL8.png` (`?tab=integrations`).
// It stands in for the engine; nothing here ships.
import { type ReactNode, useEffect } from 'react'
import type { McpServerRow } from '../../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../../shared/catalogue/skills'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { TEMPORARY_ROOTS } from '../../../../shared/platform/temporary-folder'
import { DEFAULT_ROUND_LIMIT } from '../../../../shared/review'
import { DEFAULT_SECURITY_SCOPE } from '../../../../shared/review/security'
import { navigate } from '../../chrome/navigate'
import { SETTINGS_TABS, type SettingsTab } from '../../chrome/routes'
import * as fixture from './fixture'

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/**
 * Which Company the stub answers for. `full` is the frame's own — eight Employees, three repos,
 * two sign-ins, seven variables. The other two are states every real Company passes through and
 * no frame draws, which is how an undesigned empty state shipped twice (T181).
 */
type Data = 'full' | 'empty' | 'long' | 'temporary'

/** The data `?data=` asks for; anything else is the frame's own Company. */
function dataFromQuery(): Data {
  const asked = new URLSearchParams(window.location.search).get('data')
  return asked === 'empty' || asked === 'long' || asked === 'temporary' ? asked : 'full'
}

/**
 * Everything the shell and the settings page read, answered from the fixture.
 *
 * Every answer reads `?data=` when it is *called*, not when the stub is built: the screens bind the
 * preload API at import time, so one test file mounts the same modules against several states.
 */
function stub(): TinyCorpApi {
  const empty = () => dataFromQuery() === 'empty'
  const company = () =>
    dataFromQuery() === 'empty'
      ? fixture.emptyCompany
      : dataFromQuery() === 'long'
        ? fixture.longCompany
        : dataFromQuery() === 'temporary'
          ? fixture.temporaryCompany
          : fixture.company
  const pick = <T,>(full: T, none: T) => (empty() ? none : full)
  return {
    company: {
      current: () => Promise.resolve(company()),
      list: () => Promise.resolve([company(), ...fixture.companies.slice(1)]),
      // `?data=temporary` is decision 45's warning: a Company in a folder that can vanish on
      // restart, with `Move…` beside it. No frame draws it, and nothing else draws
      // `company-move.css` (T209).
      temporaryRoots: () => Promise.resolve(dataFromQuery() === 'temporary' ? TEMPORARY_ROOTS : []),
      update: () => ok(company()),
      attention: () => Promise.resolve([]),
      onAttentionChanged: never,
      onChanged: never,
    },
    staff: {
      employees: () => ok(pick(fixture.employees, [])),
      roles: () => ok([]),
      permissionDefault: () => ok('skip-permissions'),
      setPermissionDefault: (mode: string) => ok(mode),
      onChanged: never,
    },
    chat: {
      channels: () => ok(fixture.channels),
      unread: () => ok(pick(fixture.unread, fixture.noUnread)),
      draftedChannels: () => ok([]),
      bossInbox: () => ok([]),
      agentPairs: () => ok([]),
      onChanged: never,
    },
    board: { snapshot: () => Promise.resolve(pick(fixture.board, fixture.emptyBoard)), onChanged: never },
    repos: { list: () => ok(pick(fixture.repos, [])), onChanged: never },
    code: { list: () => ok([]), onChanged: never },
    // The drawer's `Memory · 42` row. A new Company has written nothing, and says 0.
    companyMemory: { counts: () => ok(pick(fixture.memoryCounts, fixture.emptyMemoryCounts)), onChanged: never },
    approvals: { list: () => ok([]), level: () => ok('managed'), onChanged: never },
    capacity: { get: () => ok(pick(fixture.capacity, fixture.emptyCapacity)), onChanged: never },
    notifications: { enabled: () => ok(true), delivery: () => ok(null), onFocus: never, onChanged: never },
    answerer: { get: () => ok(pick(fixture.answerer, fixture.emptyAnswerer)), onChanged: never },
    digest: {
      schedule: () => ok(fixture.digest),
      setSchedule: () => ok(fixture.digest),
      onChanged: never,
    },
    tests: {
      list: () => ok([]),
      settings: () => ok(pick(fixture.testing, fixture.emptyTesting)),
      setMode: () => ok(fixture.testing),
      setRepo: () => ok(fixture.testing),
      onChanged: never,
    },
    office: { room: () => ok('night-studio'), setRoom: (slug: string) => ok(slug), onChanged: never },
    // The Tokens tab (T179). RTK is found and on; a Company on its first day has no savings yet,
    // which is a card that says so rather than three zeroes.
    rtk: {
      read: () => ok(rtkView()),
      recheck: () => ok(rtkView()),
      setEnabled: () => ok(rtkView().settings),
      setPing: () => ok(rtkView().settings),
      // A machine with no RTK has nothing to report, whatever this Company's toggle says.
      savings: () => ok(rtkView().status.state === 'missing' || empty() ? null : fixture.rtkSavings),
      onChanged: never,
    },
    // What Employees remember (T193): the Company's own budget, which is per Company and not per
    // Employee, so the card needs nothing but this one number.
    notes: { budget: () => ok(fixture.notesBudget), setBudget: (tokens: number) => ok(tokens) },
    mcp: {
      list: () => ok(pick(fixture.mcpServers, fixture.noMcpServers)),
      // `?open=mcp-import` draws the Import from Claude Code dialog (T235, frame `qSIIY`) over the
      // tab. Nothing is read from a real config here: the fixture is the scan.
      importScan: () => ok(fixture.mcpImportPreview),
      importServers: () => ok([]),
      // Found on this machine (T242, frame `mPqN9`). Nothing on this machine is read here either:
      // the fixture is the scan, and the two adds answer with the row the engine would have made.
      found: () => ok(pick(fixture.mcpFound, [])),
      addFound: () => ok(fixture.mcpServers[0] as McpServerRow),
      addPreset: () => ok(fixture.mcpServers[0] as McpServerRow),
      onChanged: never,
    },
    skills: {
      list: () => ok(pick(fixture.skills, fixture.noSkills)),
      // Skills found on this machine (T253, frame `LBKv1`). Nothing on this machine is read here:
      // the fixture is the scan, and the add answers with the row the engine would have made.
      found: () => ok(pick(fixture.skillsFound, [])),
      addFound: () => ok(fixture.skills[0] as SkillRow),
      onChanged: never,
    },
    // The Usage button reads these on mount; without them the whole window fails to render (T80).
    usage: { read: () => ok(fixture.providerUsage), refresh: () => ok(fixture.providerUsage), onChanged: never },
    // Usage & routing reads all of its tab in one call (T173); the writes give the same back.
    routing: {
      get: () => ok(pick(fixture.routing, fixture.emptyRouting)),
      setRule: () => ok(fixture.routing),
      setMoveBack: () => ok(fixture.routing),
      setResumeAtReset: () => ok(fixture.routing),
      setRotateAccounts: () => ok(fixture.routing),
      setPinnedAccount: () => ok(fixture.routing),
      setEmployeeRule: () => ok(fixture.routing),
      setEmployeePin: () => ok(fixture.routing),
      addAccount: () => ok(fixture.routing),
      renameAccount: () => ok(fixture.routing),
      setDefaultAccount: () => ok(fixture.routing),
      removeAccount: () => ok(fixture.routing),
      login: () => ok(undefined),
      continueNow: () => ok(undefined),
      moveBackNow: () => ok(undefined),
      onChanged: never,
    },
    // Environments reads its whole tab in one call (T176); nothing here answers with a value,
    // because nothing in the app ever does without the OS asking who is there first.
    environments: {
      get: () => ok(pick(fixture.environments, fixture.emptyEnvironments)),
      setAskEveryUse: () => ok(fixture.environments),
      setAvailableToChecks: () => ok(fixture.environments),
      add: () => ok(fixture.environments),
      update: () => ok(fixture.environments),
      remove: () => ok(fixture.environments),
      setRepoDefault: () => ok(fixture.environments),
      pickEnvFile: () => ok(openFromQuery() === 'import' ? fixture.envImportPreview : null),
      importKeys: () => ok(fixture.environments),
      onChanged: never,
    },
    hiring: { headcount: () => ok(pick(fixture.headcount, fixture.emptyHeadcount)), onChanged: never },
    reviews: {
      roundLimit: () => ok(DEFAULT_ROUND_LIMIT),
      securityScope: () => ok(DEFAULT_SECURITY_SCOPE),
      onChanged: never,
    },
    // Add-ons (T194, T261). Both frames draw the add-on off, which is also every Company's
    // default: an add-on is offered, never assumed, so both states read the same here.
    buildStyle: { get: () => ok('standard'), set: (style: string) => ok(style) },
    caveman: { get: () => ok('off'), set: (level: string) => ok(level) },
    // The Sandbox add-on (T260). Frame `fBHiz` draws it on with ai-jail found, and `gJyAJ` draws
    // the same card on a computer that has none — the two states this panel really has.
    sandbox: {
      read: () => ok(pick(fixture.sandbox, fixture.emptySandbox)),
      recheck: () => ok(pick(fixture.sandbox, fixture.emptySandbox)),
      setEnabled: (enabled: boolean) => ok({ enabled }),
      onChanged: never,
    },
    // The three settings a Session bakes in at its spawn (T237). The frames draw the note after a
    // change, so the harness answers with the Employees the change has not reached yet.
    spawnSettings: {
      stale: () => ok(pick(fixture.staleSessions, [])),
      applyNow: () => ok({ restarted: [], waiting: [] }),
      onChanged: never,
    },
    // How Employees talk (T180). The frame draws a Company on Terse, which is also every
    // Company's default, so the empty state and the frame's own read the same here.
    voice: {
      colleague: () => ok('terse'),
      setColleague: (voice: string) => ok(voice),
      onChanged: never,
    },
    launcher: { setWindowLayout: () => Promise.resolve() },
    // Whether a newer build exists (T130); the fixture has one, so the line and the row both show.
    updates: {
      get: () => Promise.resolve(fixture.update),
      checkNow: () => Promise.resolve(fixture.update),
      openDownloadPage: () => Promise.resolve(),
      onChanged: never,
    },
    // The shell listens for the application menu; the harness has no menu to send one.
    shell: { platform: 'darwin', toggleMaximize: () => Promise.resolve(), onMenuCommand: never },
    // The onboarding gate is read before anything is routed (T59): a Company whose wizard is owed
    // opens into the wizard, and until the mark comes back `App` draws nothing at all. The fixture's
    // Company finished its wizard, so settings opens behind it.
    onboarding: { progress: () => ok(fixture.onboarding), save: () => ok(null), finish: () => ok(null) },
    // The Providers card reads this the moment the page mounts; without it the window renders
    // nothing at all, so no tab of this page can be captured (T135, T136).
    // `all` is the Providers card's and the fallback model picker's read: every Provider, not only
    // the hired ones. Without it Usage & routing throws on mount and the window comes back blank.
    preflight: {
      status: () => Promise.resolve([]),
      all: () => Promise.resolve([]),
      recheck: () => Promise.resolve([]),
      onChanged: never,
    },
  } as unknown as TinyCorpApi
}

/** Mounts the whole window on Company settings, as the frame shows it. */
export async function settingsCapture(): Promise<ReactNode> {
  // The stub goes in before the view modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  const { App } = await import('../../App')
  return (
    <Frame>
      <App />
    </Frame>
  )
}

/**
 * `?open=import` opens the Import .env preview over the Environments tab, which is part `c` of
 * frame `aD50i`, and `?open=mcp-import` the Import from Claude Code dialog over Integrations
 * (frame `qSIIY`). A headless capture cannot click, so the harness presses the button itself.
 */
function openFromQuery(): string | null {
  return new URLSearchParams(window.location.search).get('open')
}

/** What `?open=` presses: the button whose label holds this text. */
const OPENS: Record<string, string | undefined> = {
  import: 'Import .env',
  'mcp-import': 'Import from Claude Code',
  // The preset setup dialog (T242, frame `gue8i`), which opens from a tile rather than a button.
  'mcp-preset': 'GitHub',
}

/**
 * Which state of RTK the stub answers with (`?rtk=`), which is the four states of frame `p4np9V`:
 * found (the default), `missing`, `old` and `wsl`. A headless capture cannot uninstall a binary.
 */
function rtkView() {
  const asked = new URLSearchParams(window.location.search).get('rtk')
  if (asked === 'missing') return fixture.rtkMissing
  if (asked === 'old') return fixture.rtkTooOld
  if (asked === 'wsl') return fixture.rtkInWsl
  return dataFromQuery() === 'empty' ? fixture.emptyRtk : fixture.rtk
}

/** The tab `?tab=` names, so one capture page serves both frames. */
function tabFromQuery(): SettingsTab {
  const asked = new URLSearchParams(window.location.search).get('tab')
  return SETTINGS_TABS.find((tab) => tab === asked) ?? 'general'
}

/**
 * How tall the captured window is. The frames are drawn against 944, which is what this answers
 * unless `?height=` asks for more — a card below the fold, like the daily digest's, can then be
 * shot whole instead of clipped (T172).
 */
function heightFromQuery(): number {
  const asked = Number(new URLSearchParams(window.location.search).get('height'))
  return Number.isFinite(asked) && asked >= 944 ? asked : 944
}

/** The 1512x944 window the audit captures, opened on Company settings as a click would. */
function Frame({ children }: { children: ReactNode }) {
  useEffect(() => {
    // The shell starts on the Office; the same event the drawer's rows send opens settings.
    const tab = tabFromQuery()
    const timer = setTimeout(() => navigate({ view: 'settings', tab }))
    // The one thing a headless capture cannot do for itself: open a dialog that needs a press.
    const press = OPENS[openFromQuery() ?? '']
    const opening = press
      ? setTimeout(() => {
          const button = [...document.querySelectorAll('button')].find((candidate) =>
            candidate.textContent?.includes(press),
          )
          button?.click()
        }, 400)
      : undefined
    return () => {
      clearTimeout(timer)
      clearTimeout(opening)
    }
  }, [])
  return (
    <div style={{ position: 'relative', width: 1512, height: heightFromQuery(), overflow: 'hidden' }}>
      {children}
      <TrafficLights />
    </div>
  )
}

/** macOS draws these over the title bar's 120px slot; a browser capture has to stand in for them. */
function TrafficLights() {
  const dot = (background: string) => ({ width: 12, height: 12, borderRadius: '50%', background })
  return (
    <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8 }} aria-hidden>
      <span style={dot('#FF5F57')} />
      <span style={dot('#FEBC2E')} />
      <span style={dot('#28C840')} />
    </div>
  )
}
