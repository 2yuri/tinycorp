import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  nativeImage,
  type OpenDialogOptions,
  powerSaveBlocker,
  safeStorage,
  shell,
} from 'electron'
import { CHECK_EVERY_MS, REPO_URL } from '../shared/app/updates'
import {
  activityChannels,
  answererChannels,
  approvalChannels,
  boardChannels,
  capacityChannels,
  chatChannels,
  codeChannels,
  companyChannels,
  companyMemoryChannels,
  digestChannels,
  editorsChannels,
  environmentChannels,
  filesChannels,
  inboxChannels,
  keepAwakeChannels,
  mcpChannels,
  notificationChannels,
  officeChannels,
  planningChannels,
  preflightChannels,
  profileChannels,
  repoChannels,
  restorePointChannels,
  reviewChannels,
  routingChannels,
  rtkChannels,
  sandboxChannels,
  sessionChannels,
  shellChannels,
  signInChannels,
  skillChannels,
  spawnSettingsChannels,
  staffChannels,
  testChannels,
  updateChannels,
  usageChannels,
  voiceChannels,
} from '../shared/domain/channels'
import { PROVIDERS, type Provider, pickDefaultProvider } from '../shared/domain/providers'
import { FORGE_COMMAND, type Forge } from '../shared/forges'
import { parseRuntimeKey } from '../shared/platform/wsl'
import type { ProviderPreflight } from '../shared/providers/preflight'
import { preflightRefusal } from '../shared/providers/preflight'
import { RTK_COMMAND } from '../shared/rtk'
import { AI_JAIL_COMMAND, type SandboxPlan } from '../shared/sandbox'
import { capturePageInHiddenWindow } from './app/app-capture'
import { appIconPath, applyAppIdentity } from './app/app-identity'
import { bossName } from './app/boss-name'
import { bossProfileFile } from './app/boss-profile-file'
import { registerCrashIpc } from './app/crash-ipc'
import { crashLog, guardProcess } from './app/crash-log'
import { endToEndRun } from './app/e2e-mode'
import { createKeepAwake } from './app/keep-awake'
import { keepAwakeFile } from './app/keep-awake-file'
import { registerKeepAwakeIpc } from './app/keep-awake-ipc'
import { registerLauncherIpc, WINDOW_SIZES } from './app/launcher-ipc'
import {
  createApplicationMenu,
  electronMenuHost,
  engineMenuFacts,
  engineMenuRecents,
  sendToWindow,
  watchMenuEngine,
} from './app/menu/application-menu'
import { recentsFile } from './app/recents-file'
import { adoptFormerUserData } from './app/rename-migration'
import { askWhoIsThere } from './app/reveal-prompt'
import { registerShellIpc } from './app/shell-ipc'
import { holdSingleInstance } from './app/single-instance'
import { SMOKE_READY, SMOKE_READY_FILE, SMOKE_TIMEOUT_MS, smokeRun } from './app/smoke-run'
import { runInBackground } from './app/tray/background'
import { createElectronMenuBarItem } from './app/tray/electron-tray'
import { createMenuBar, engineTrayFacts, watchEngine } from './app/tray/menu-bar'
import { createUpdateCheck } from './app/update-check'
import { registerUpdatesIpc } from './app/updates-ipc'
import { windowChrome } from './app/window-chrome'
import { applyWindowPolicy } from './app/window-policy'
import { readWindowsMachine } from './app/windows-machine'
import { registerWindowsMachineIpc } from './app/windows-machine-ipc'
import { createCompanyEngine, startCompanyMcpServer } from './core/engine'
import { registerActivityIpc } from './features/activity'
import { registerApprovalIpc } from './features/approvals'
import { registerBoardIpc } from './features/board'
import { registerMcpIpc, registerSkillsIpc } from './features/catalogue'
import { registerChatIpc, registerVoiceIpc } from './features/chat'
import { registerCodeIpc } from './features/code'
import {
  createCompanyLogos,
  missingMarksFile,
  pruneMissingCompanies,
  registerCompanyIpc,
  registerCompanyMoveIpc,
  registerProfileIpc,
} from './features/company'
import { registerEnvironmentsIpc } from './features/environments'
import {
  createEditors,
  desktopFileTools,
  desktopPathTools,
  editorChoiceFile,
  registerEditorsIpc,
  registerFilesIpc,
  registerLanguageIpc,
  registerPathsIpc,
} from './features/files'
import { registerHiringIpc } from './features/hiring'
import { registerAnswererIpc, registerInboxIpc } from './features/inbox'
import { registerCompanyMemoryIpc, registerNotesIpc } from './features/memory'
import {
  nativeNotificationsSupported,
  openNotificationSettings,
  registerNotificationIpc,
  showNativeNotification,
} from './features/notifications'
import { registerOfficeIpc } from './features/office'
import { registerOnboardingIpc } from './features/onboarding'
import { registerDigestIpc, registerPlanningIpc } from './features/planning'
import {
  createRemoteFor,
  createRepoInspector,
  detectRepoOnDisk,
  initialiseRepo,
  planRepoStart,
  registerRepoIpc,
  remoteOffers,
} from './features/repos'
import { registerRestorePointsIpc } from './features/restore-points'
import { registerReviewIpc } from './features/review'
import { registerRtkIpc } from './features/rtk'
import { registerSandboxIpc } from './features/sandbox'
import {
  registerBuildStyleIpc,
  registerCapacityIpc,
  registerCavemanIpc,
  registerSessionIpc,
  registerSpawnSettingsIpc,
  registerTerminalIpc,
} from './features/sessions'
import { registerStaffIpc } from './features/staff'
import { registerTestingIpc } from './features/testing'
import {
  accountsFile,
  createProviderUsage,
  createSignIns,
  outagesFile,
  providerLogins,
  registerRoutingIpc,
  registerSignInIpc,
  registerUsageIpc,
  resetFromUsage,
  signInPty,
  signInReaders,
} from './features/usage'
import { createForgeAdapters, teamForgeRunner } from './forges'
import {
  addedEnv,
  adoptLoginShellPath,
  createGitRunner,
  createGitService,
  forgetCliPaths,
  healthUrlOf,
  hostUrlFor,
  isWsl,
  memorySecrets,
  nodePtySpawn,
  type PtySpawnOptions,
  platformSecrets,
  type RunCli,
  runCli,
  secretBackend,
  setTeamRuntime,
  startPowerSaveBlocker,
  teamHomeFolder,
  wslHomeFolders,
  wslRunCli,
} from './platform'
import {
  clearSessionFiles,
  createPreflight,
  createProviderAdapters,
  createProviderRuntimes,
  HOOK_TOKEN_HEADER,
  refreshProviderAdapters,
  registerPreflightIpc,
  startHookReceiver,
} from './providers'
import { fakeProviderAdapters } from './providers/testing'

/** A Provider that has been asked. One that has not says nothing, rather than guessing for it. */
const isAnswer = (entry: ProviderPreflight | null): entry is ProviderPreflight => entry !== null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    // No Company is open at launch, so the window starts as the 680×740 Launcher; opening a
    // Company grows it to the shell's 1512×944 (launcher-ipc). The renderer draws the 44px title
    // bar around the traffic lights.
    ...WINDOW_SIZES.launcher,
    title: 'TinyCorp',
    icon: appIconPath(),
    backgroundColor: '#0F172A',
    // The platform's own frame is hidden and the renderer draws the bar; on Windows and Linux the
    // minimise, maximise and close buttons come back as an overlay in the design's colours (T166).
    ...windowChrome(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  // The app's own page: the dev server when `pnpm dev` started it, the built document otherwise.
  const appUrl =
    process.env['ELECTRON_RENDERER_URL'] ?? pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
  // What this window may load, and nothing else: the guard is attached before the first page is.
  applyWindowPolicy(window, appUrl)
  void window.loadURL(appUrl)
  return window
}

/**
 * One copy of the app, asked for before anything is read or written (T252). A second copy quits
 * here; the first is brought forward instead. Every platform behaves the same way.
 */
const onlyCopy = holdSingleInstance({ app, showWindow: () => void showWindow() })

// The Dock, the app switcher and the menu bar are set before the first window exists.
applyAppIdentity()
// Opened from the Finder, the app has launchd's PATH: widen it before any CLI is looked up.
adoptLoginShellPath()

void app.whenReady().then(async () => {
  // Another copy already has the lock: this process is quitting and opens nothing.
  if (!onlyCopy) return
  // TinyCorp was called better-office; its userData folder is adopted once, before anything reads it.
  adoptFormerUserData(app.getPath('userData'))
  /**
   * Whether `pnpm test:e2e` started this process (T189). It moves four seams and nothing else —
   * the Provider adapters, the update check, the usage read and the secret store — so the screens
   * an end-to-end run drives are the screens a boss gets. A packaged build ignores the variable:
   * this is false everywhere a boss is.
   *
   * The secret store is the fourth for the reason `e2e/fixtures.ts` gives for the temp folders
   * (T218): a run that adds a variable would otherwise write to the boss's own login keychain,
   * and on a CI runner with no keyring `safeStorage` would refuse the write and every Environments
   * test would be a test of what a machine with no keyring looks like.
   */
  const e2e = endToEndRun({ packaged: app.isPackaged, env: process.env })
  /**
   * The boss's profile, read straight from its file here rather than through the engine: where
   * each Provider runs is the boss's pick (T167), and the receivers below have to be listening
   * before the engine that would serve it exists.
   */
  const bossProfile = bossProfileFile(join(app.getPath('userData'), 'boss-profile.json'))
  /**
   * Where every Provider's CLI is on this machine (T167). On a Mac this is one `PATH` walk per
   * Provider; on Windows it also looks inside WSL, holds the boss's pick when a CLI is in both
   * places, and says where the receivers have to listen so a Session in a distro can reach them.
   */
  const runtimes = createProviderRuntimes({
    picked: (provider) => parseRuntimeKey(bossProfile.read()?.providerRuntimes?.[provider]),
    // Where the team runs, for every Provider the boss has not placed by hand (T249).
    teamDefault: () => parseRuntimeKey(bossProfile.read()?.defaultRuntime),
  })
  /**
   * **Where the team runs is now where everything runs** (T259). T167 put a Provider's Session inside
   * a distro and left git, `gh`, `rtk`, a repo's run command and a test run on Windows — a mixed team,
   * whose worst seam is that a worktree's `gitdir:` link is absolute and only the git that wrote it
   * can follow it. Said once, here, before anything spawns; every non-Provider process reads it.
   */
  setTeamRuntime(() => runtimes.team())
  /** The one git. Every repo gets whichever git owns its filesystem; see `git-runner.ts`. */
  const gitRunner = createGitRunner()
  /**
   * `gh`, `glab` and `rtk`, asked where the team runs. The `gh` on the Windows `PATH` is not on the
   * distro's, so a boss whose team is in Arch would otherwise be told a PR can be opened by a CLI
   * that is not there — and every `rtk` hook would name a program the distro does not have (T179).
   */
  const teamRunCli: RunCli = (command, args, options) => {
    const team = runtimes.team()
    // On the distro's own `PATH` (T258), the same one the lookup found the CLI on: an `rtk` in
    // `~/.local/bin` is invisible to a plain login `sh`, so asking it `--version` there would read as
    // *not installed* the moment after the lookup said it was.
    const run = isWsl(team) ? wslRunCli(runCli, { distro: team.distro, path: runtimes.loginPath(team.distro) }) : runCli
    return run(command, args, options)
  }
  /** The app's own token for the WSL self-test. It proves a network path and never a Session. */
  const probeToken = randomBytes(24).toString('base64url')
  const listenOn = runtimes.addresses()
  const hooks = await startHookReceiver((token, payload) => engine.sessions.receiveHook(token, payload), {
    addresses: listenOn,
    probeToken,
  })
  const mcp = await startCompanyMcpServer(
    { mcpCaller: (companyId, token) => engine.mcpCaller(companyId, token) },
    { addresses: listenOn },
  )
  /**
   * Nothing ever shows a blank window (T128): a screen that stopped drawing, and a throw or a
   * rejection nobody in this process handled, are written down rather than lost with the window.
   */
  const crashes = crashLog({ path: join(app.getPath('userData'), 'logs', 'crashes.log'), version: app.getVersion() })
  guardProcess(crashes)
  // What the Providers report of the boss's subscription, read here and never in the renderer: the
  // login each CLI wrote for itself, used for one GET and never stored. An end-to-end run reads no
  // keychain and no `auth.json` and asks nobody: every card says there is no login.
  const noLogin = () => Promise.resolve({ login: null, lookedIn: [] })
  /**
   * The boss's sign-ins, once the engine that keeps them exists. A read before then — nothing asks
   * for one, but the reader is handed out before the engine is built — is the Provider's own
   * default folder, which is what every read was before there were accounts.
   */
  let signIns: (provider: string) => { id: string; configDir: string | null; primary: boolean }[] = () => []
  // Where each Provider's login really is: the keychain on a Mac, the config folder's own
  // `.credentials.json` on Windows and Linux, and — when this Provider's Sessions run inside a
  // distro — that distro's home, read over `\\wsl.localhost` (T257). The sign-in modal watches the
  // same reads for a login to appear (T263).
  const logins = e2e
    ? { claudeCredential: noLogin, codexCredential: noLogin }
    : providerLogins({ runtimeOf: (provider) => runtimes.runtime(provider) })
  const usage = createProviderUsage({
    ...logins,
    // Every sign-in the boss has, each read from its own config folder (T173, T257). The accounts
    // live on the engine, which is built below, so they are asked for at read time.
    accountsOf: (provider) => signIns(provider),
  })
  // The adapters, built once: the engine spawns Sessions with them and the preflight asks them
  // where their own CLI stands (T135).
  const adapterOptions = {
    hookUrl: hooks.url,
    dataDir: join(app.getPath('userData'), 'sessions'),
    runtimes,
    // The jail for the Session about to start (T260). A function, because it is asked at every
    // spawn: the Company's switch may have moved since these adapters were built, and *off means
    // off at the next start* is kept by asking again rather than by rebuilding anything.
    sandbox: (options: PtySpawnOptions) => sandboxPlanFor(options),
  }
  /** RTK's per-Company history, named because the jail has to let a hooked Session write it. */
  const rtkDir = join(app.getPath('userData'), 'rtk')

  /**
   * The jail one Session starts in, or null to start it exactly as it started before (T260).
   *
   * Everything it grants is something the Session provably needs and ai-jail's defaults take away:
   * the folder TinyCorp writes that Session's own config into, read-only, because the frame
   * promises read-only; RTK's history folder, writable, because a hooked Session creates its file;
   * and the variables the app itself put on the process, by name, because the default environment
   * is a minimal allowlist and a Session without its hook token cannot tell TinyCorp anything.
   *
   * The worktree needs no entry: it is the working directory, which ai-jail makes the project and
   * writable, and `--worktree` covers the git dirs a linked worktree commits through.
   */
  function sandboxPlanFor(options: PtySpawnOptions): SandboxPlan | null {
    if (!engine.sandbox.jailed()) return null
    return {
      readOnly: [adapterOptions.dataDir],
      readWrite: [rtkDir],
      env: addedEnv(options.env, process.env),
    }
  }

  // Nothing in there belongs to a Session that is still running — the app has only just started —
  // and every file in it holds a bearer token any Employee could read (T199, finding H5). A
  // Session that ends takes its own file with it; this is what a crash or a kill left behind.
  clearSessionFiles(adapterOptions.dataDir)
  const providers = e2e ? fakeProviderAdapters() : createProviderAdapters(adapterOptions)
  // `Check again` and a moved Provider ask the machine where the CLIs are again; a run against the
  // fakes has no machine to ask, and keeps them.
  const rebuildProviders = () => {
    if (!e2e) refreshProviderAdapters(providers, adapterOptions)
  }
  // Can a Session inside a distro reach us at all? Asked once the receivers are up, before the
  // first Session depends on it, and said on the Providers card's row (T167).
  runtimes.test(healthUrlOf(hooks.url), probeToken, HOOK_TOKEN_HEADER)
  /**
   * Whether the CLIs this Company's Employees are hired on can run one at all (T129, T135). Asked
   * once, below, before the first window draws, for the Providers actually in use and no others;
   * `Check again` is the only thing that asks a second time.
   */
  const preflight = createPreflight({
    /**
     * `Check again` asks the machine again, and that includes where the CLIs are (T167): a boss
     * who has just installed one inside Ubuntu presses this, and every cached probe has to go.
     */
    beforeRecheck() {
      runtimes.forget()
      rebuildProviders()
      runtimes.test(healthUrlOf(hooks.url), probeToken, HOOK_TOKEN_HEADER)
      // Where the CLIs are has just been asked again, and so has where RTK is (T179).
      void engine.rtk.recheck()
      void engine.sandbox.recheck()
    },
    // Every Provider in the catalogue has an adapter — `createProviderAdapters` refuses a set that
    // is missing one — and only a Provider in the catalogue can be hired.
    check: (provider) => providers[provider]!.checkCli(),
    inUse: () => hiredProviders(),
    onChanged(status) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(preflightChannels.changed, status)
      }
    },
  })
  /** The Providers this Company's Employees are hired on; none at all before a Company is open. */
  function hiredProviders(): Provider[] {
    try {
      return engine.employees.list().map((employee) => employee.provider)
    } catch {
      return []
    }
  }
  const recents = recentsFile(join(app.getPath('userData'), 'recent-companies.json'))
  // Folders deleted a while ago leave the Launcher on their own (T57); an unmounted drive never does.
  pruneMissingCompanies({
    recents,
    marks: missingMarksFile(join(app.getPath('userData'), 'missing-companies.json')),
  })
  // One adapter per forge (T142), built once and shared: the git service reads a repo's forge from
  // its `origin`, and Add repository creates a remote on one for a repo started in the app (T144).
  const forges = createForgeAdapters({
    cwd: app.getPath('userData'),
    // Where the team runs (T259): the forge CLI a PR is opened with is the one beside the Employee's
    // own git, and a `gh` that is only on Windows cannot push a branch that only exists in a distro.
    runForge: teamForgeRunner(() => runtimes.team(), { loginPath: (distro) => runtimes.loginPath(distro) }),
    installed: (forge) => runtimes.inTeam(FORGE_COMMAND[forge as Forge]) !== null,
  })
  const engine = createCompanyEngine({
    recents,
    // One profile for the boss, beside the recent Companies; every Company reads it (T79).
    bossProfile,
    // The boss's Provider sign-ins, and the limits the app is waiting out, beside it (T173). The
    // accounts file holds labels and directories; the sign-in inside each directory is the CLI's.
    accountStore: accountsFile(join(app.getPath('userData'), 'provider-accounts.json')),
    accountsDir: join(app.getPath('userData'), 'accounts'),
    // RTK's own history, one file per Company, in the app's data folder (T179) — never in a repo an
    // Employee works in, and never mixed with the boss's own RTK history.
    rtk: {
      dir: rtkDir,
      // A Provider inside a distro runs the RTK inside that distro, so that is where it is looked
      // for (T167). The probe is the one `provider-runtimes` already caches.
      distros: () => runtimes.inDistros(RTK_COMMAND),
      // And the `rtk` the *app itself* asks `--version` and `gain` of is the team's (T259): asking
      // the Windows one about a distro's history would read a file that is not there.
      resolve: (command) => runtimes.inTeam(command),
      runCli: teamRunCli,
    },
    // ai-jail runs inside the distro an Employee's Provider runs in, never on the Windows around it
    // (T167, T258). Both answers are the probes `provider-runtimes` already cached, so asking here
    // wakes nothing; off Windows both are empty and the lookup is this machine's own `PATH`.
    sandbox: {
      distro: () => runtimes.inDistros(AI_JAIL_COMMAND)[0]?.distro ?? null,
      resolveInDistro: (command: string, distro: string) =>
        runtimes.inDistros(command).find((one) => one.distro === distro)?.path ?? null,
    },
    outageStore: outagesFile(join(app.getPath('userData'), 'provider-outages.json')),
    // When a limit resets, read from the usage endpoint rather than by spending a prompt on it.
    readReset: (provider) => resetFromUsage(usage, provider),
    bossName,
    // A Session hit the limit, so the cached percentages are stale: the next read asks again.
    onLimitReported: () => usage.invalidate(),
    // The daily digest's Usage today, read once per digest through the same cache the popover uses.
    usage: () => usage.read(),
    providers,
    // A Session inside a WSL distro dials the host rather than its own loopback (T167); on a Mac,
    // and for a Provider that runs on Windows itself, this is the same string it always was.
    mcpUrl: (companyId, provider) => hostUrlFor(mcp.urlFor(companyId), runtimes.host(runtimes.runtime(provider))),
    // `env_run` runs beside the Employee's own tools: inside the distro when its Provider is
    // there, on the host otherwise (T167, T176).
    providerRuntime: (provider) => runtimes.runtime(provider),
    // The boss's MCP tokens and the Environments' values live in the OS secret store, never in
    // the Company database (T136, T176): the macOS keychain, or DPAPI blobs in `userData` on
    // Windows — which is `userData` and never the Company folder, because that folder gets synced.
    secrets: e2e ? memorySecrets() : platformSecrets({ dir: join(app.getPath('userData'), 'secrets'), safeStorage }),
    // Which of the three stores that is (T177, T218): what the boss is told when a value has gone
    // missing names the store that was actually asked, on every platform.
    secretBackend: () => (e2e ? 'keychain' : secretBackend(safeStorage)),
    // Which forge a repo uses is read from its own `origin`, so a Company can hold repos on several.
    git: createGitService({ forges, git: gitRunner }),
    // `Run it` starts a repo's command where the team runs (T259): inside the distro when the
    // worktree is there, because that is where its `node_modules` is.
    teamRuntime: () => runtimes.team(),
    // No CLI, no Session: the start is refused with that Provider's own sentence off the Launcher's
    // card (T129, T135) — each Employee gets the card of the product they are hired on.
    refuseSession: (provider) => preflightRefusal(preflight.cached(provider)),
    // A hire that names neither a Provider nor a model goes on whichever one this Mac is ready for
    // (T169), read off the answers warmed at start rather than off the catalogue's first line.
    defaultProvider: () =>
      pickDefaultProvider(PROVIDERS.map((provider) => preflight.cached(provider)).filter(isAnswer)),
  })

  // The Usage read can ask for the boss's sign-ins now that the engine holds them: each account's
  // own config folder, and null for the one the product signed in itself (T173, T257).
  signIns = (provider) =>
    engine.accounts
      .of(provider)
      .map(({ id, configDir, primary }) => ({ id, configDir: primary ? null : configDir, primary }))
  // A sign-in added, renamed or removed changes what the popover has to read.
  engine.accounts.onChange(() => usage.invalidate())

  /**
   * A Provider nobody was hired on when the app started — the boss switched Company, or hired on a
   * second one — is asked about the first time it appears, and never again (T135). Without this a
   * Session on it is refused with nothing, which is the silence the preflight exists to end.
   */
  engine.employees.onChange(() => void preflight.status())

  /**
   * The menu says which awake mode is on, and the mode can be announced before the menu exists:
   * the floor is read once, below, while this is still nothing.
   */
  let refreshApplicationMenu: () => void = () => {}

  /**
   * The coffee cup on the map: the one place that decides whether this machine may sleep (T99).
   * The mode is the boss's, kept beside the boss profile; the floor is every open Company's
   * Sessions. The assertion is Electron's own, which is macOS, Windows and Linux alike (T177).
   */
  const keepAwake = createKeepAwake({
    store: keepAwakeFile(join(app.getPath('userData'), 'keep-awake.json')),
    start: () => startPowerSaveBlocker(powerSaveBlocker),
    onChanged(state) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(keepAwakeChannels.changed, state)
      }
      // The menu says which mode is on, so it is rebuilt wherever the mode is switched (#223).
      refreshApplicationMenu()
    },
  })
  const readFloor = () => keepAwake.setWorking(engine.capacity.usage().companies.some((company) => company.running > 0))
  engine.capacity.onChange(readFloor)
  engine.sessions.onChange(readFloor)
  readFloor()

  /**
   * Closing the window is not quitting (T117): the Company keeps working and the menu-bar item
   * says so. Every way back into the app — the item, the Dock, a clicked notification — goes
   * through `background.open()`, which brings the Dock icon back with the window.
   */
  const item = createElectronMenuBarItem()
  const background = runInBackground({
    app,
    hasMenuBarItem: item !== null,
    windowCount: () => BrowserWindow.getAllWindows().length,
    openWindow: showWindow,
    shutdown() {
      menuBar?.close()
      keepAwake.close()
      engine.close()
      void hooks.close()
      void mcp.close()
    },
  })

  /**
   * The home a new Company is suggested under: the distro's own when the team runs there (T256),
   * and `app.getPath('home')` everywhere else. Asked each time, because the boss can change where
   * the team runs while the app is open.
   */
  const companyHome = () =>
    teamHomeFolder({
      teamDefault: parseRuntimeKey(engine.boss.get().defaultRuntime),
      windowsHome: app.getPath('home'),
      account: userInfo().username,
    })

  // The logo is read and scaled by Electron's own image decoder, so no image library ships (T280).
  const companyLogos = createCompanyLogos({
    toPng(path, maxSide) {
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) throw new Error('That file is not an image TinyCorp can read: pick a PNG or a JPEG')
      const { width, height } = image.getSize()
      const scale = Math.min(1, maxSide / Math.max(width, height))
      const fitted =
        scale < 1
          ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
          : image
      return fitted.toPNG()
    },
  })

  registerCompanyIpc({
    ipc: ipcMain,
    engine,
    homeFolder: companyHome,
    async pickFolder() {
      const options: OpenDialogOptions = {
        title: 'Choose a Company folder',
        properties: ['openDirectory', 'createDirectory'],
        // Opened where the field already points rather than wherever the picker was last (T252):
        // on Windows that was the WSL share for the boss who met "database is locked", and
        // accepting what the picker already showed was one click. Since T256 a folder in WSL is
        // where a boss whose team runs there is offered one, so it is the same answer.
        defaultPath: companyHome(),
      }
      const owner = BrowserWindow.getFocusedWindow()
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    broadcastChanged(company) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(companyChannels.changed, company)
      }
    },
    broadcastAttention() {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(companyChannels.attentionChanged)
    },
    logos: companyLogos,
    async pickImage() {
      const options: OpenDialogOptions = {
        title: 'Choose a logo',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
      }
      const owner = BrowserWindow.getFocusedWindow()
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  })

  registerCompanyMoveIpc({
    ipc: ipcMain,
    engine,
    tempDir: tmpdir(),
    async pickFolder(company) {
      const options: OpenDialogOptions = {
        title: `Choose a new folder for ${company.name}`,
        buttonLabel: 'Move here',
        properties: ['openDirectory', 'createDirectory'],
      }
      const owner = BrowserWindow.getFocusedWindow()
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    broadcastChanged(company) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(companyChannels.changed, company)
    },
  })

  registerStaffIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(staffChannels.changed)
      }
    },
  })
  registerRepoIpc({
    ipc: ipcMain,
    engine,
    pickFolder: () => pickFolder('Choose a repo folder'),
    pickScanFolder: () => pickFolder('Choose a folder to scan for repos'),
    inspect: createRepoInspector(),
    initialise: (path) =>
      initialiseRepo(path, { author: bossName(), companyFolders: engine.listCompanies().map((c) => c.folder) }),
    planStart: (path) => planRepoStart(path),
    remoteOffers: () => remoteOffers(forges),
    createRemote: (path, remote) => createRemoteFor(path, { adapters: forges, ...remote }),
    home: homedir(),
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(repoChannels.changed)
    },
    broadcastFound(event) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(repoChannels.found, event)
    },
  })

  registerBoardIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged(board) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(boardChannels.changed, board)
      }
    },
  })

  registerSessionIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(sessionChannels.changed)
      }
    },
  })

  // A right-click that pastes reads the clipboard here (T249): the window refuses every permission
  // it is asked, so the renderer cannot read one itself.
  registerTerminalIpc({ ipc: ipcMain, engine, readClipboard: () => clipboard.readText() })
  registerChatIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(chatChannels.changed)
      }
    },
  })

  registerInboxIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(inboxChannels.changed)
      }
    },
  })

  registerNotesIpc({ ipc: ipcMain, engine })

  registerBuildStyleIpc({ ipc: ipcMain, engine })
  registerCavemanIpc({ ipc: ipcMain, engine })

  registerSpawnSettingsIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(spawnSettingsChannels.changed)
      }
    },
  })

  registerCompanyMemoryIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(companyMemoryChannels.changed)
      }
    },
  })

  registerApprovalIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(approvalChannels.changed)
      }
    },
  })

  registerCapacityIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(capacityChannels.changed)
      }
    },
  })

  registerUsageIpc({
    ipc: ipcMain,
    usage,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(usageChannels.changed)
      }
    },
  })

  // What the Company does when a Provider runs out, and the boss's sign-ins per Provider (T173).
  registerRoutingIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(routingChannels.changed)
      }
    },
  })

  /**
   * The product's own sign-in, in a terminal inside the app and in the place the Provider runs
   * (T263). A login appearing is a `Check again` for that Provider and a fresh Usage read, so the
   * card and the meter change without the boss touching anything.
   */
  const readers = signInReaders(logins)
  const signInTerminals = createSignIns({
    accounts: engine.accounts,
    providers,
    runtimeOf: (provider) => runtimes.runtime(provider),
    spawnIn(provider) {
      const runtime = runtimes.runtime(provider)
      return signInPty(runtime, nodePtySpawn, { path: isWsl(runtime) ? runtimes.loginPath(runtime.distro) : null })
    },
    folder: join(app.getPath('userData'), 'sign-in'),
    loginOf: (provider) => readers[provider] ?? null,
    afterSignIn(provider) {
      void preflight.recheckOne(provider)
      void usage.refresh()
      // The address beside each account is read off its folder, which the sign-in just wrote.
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(routingChannels.changed)
    },
    onData(id, data) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(signInChannels.data, id, data)
    },
    onState(id, state) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(signInChannels.state, id, state)
    },
  })
  registerSignInIpc({ ipc: ipcMain, signIns: signInTerminals })
  app.on('will-quit', () => signInTerminals.cancelAll())

  registerAnswererIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(answererChannels.changed)
      }
    },
  })

  registerDigestIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(digestChannels.changed)
      }
    },
  })

  registerHiringIpc({ ipc: ipcMain, engine })
  registerOnboardingIpc({ ipc: ipcMain, engine })
  registerCodeIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(codeChannels.changed)
      }
    },
  })
  registerRestorePointsIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(restorePointChannels.changed)
      }
    },
  })
  /**
   * Which editor opens a file (T123): what this Mac has, and the boss's pick, kept beside the
   * boss profile so every Company hands a file to the same editor (decision 47).
   */
  const editors = createEditors({
    store: editorChoiceFile(join(app.getPath('userData'), 'editor.json')),
    onChanged(state) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(editorsChannels.changed, state)
    },
  })
  registerEditorsIpc({ ipc: ipcMain, editors })
  registerFilesIpc({
    ipc: ipcMain,
    engine,
    tools: desktopFileTools(editors),
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(filesChannels.changed)
      }
    },
  })
  registerLanguageIpc({ ipc: ipcMain, engine })
  registerPathsIpc({ ipc: ipcMain, engine, tools: desktopPathTools(editors) })
  registerReviewIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(reviewChannels.changed)
      }
    },
  })
  registerTestingIpc({
    ipc: ipcMain,
    engine,
    capture: capturePageInHiddenWindow,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(testChannels.changed)
      }
    },
  })
  registerVoiceIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(voiceChannels.changed)
      }
    },
  })
  registerPlanningIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(planningChannels.changed)
      }
    },
  })
  registerActivityIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(activityChannels.changed)
      }
    },
  })

  registerNotificationIpc({
    ipc: ipcMain,
    engine,
    supported: nativeNotificationsSupported,
    openSystemSettings: openNotificationSettings,
    show: (notification, click, act) =>
      // Play a sound is the boss's own setting, on Your profile (T79).
      showNativeNotification(notification, { silent: !engine.boss.get().sound, click, act }),
    focus(request) {
      // The app may be in the menu bar with no window at all; this is the one way back in (T117).
      const window = background.open()
      if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', () => window.webContents.send(notificationChannels.focus, request))
      } else {
        window.webContents.send(notificationChannels.focus, request)
      }
    },
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(notificationChannels.changed)
      }
    },
  })

  registerLauncherIpc({
    ipc: ipcMain,
    engine,
    logoOf: (folder) => companyLogos.of(folder),
    detectRepo: detectRepoOnDisk,
    resize(event, { width, height, minWidth, minHeight }) {
      const window = BrowserWindow.fromWebContents((event as IpcMainInvokeEvent).sender)
      if (!window || window.isFullScreen()) return
      const [currentWidth, currentHeight] = window.getSize()
      if (currentWidth === width && currentHeight === height) return
      if (window.isMaximized()) window.unmaximize()
      // The Launcher is smaller than a Company's minimum, so the minimum moves with the layout.
      window.setMinimumSize(minWidth, minHeight)
      window.setSize(width, height)
      window.center()
    },
  })

  registerOfficeIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(officeChannels.changed)
      }
    },
  })

  // RTK, which compresses what every Employee reads (T179). TinyCorp never installs it: this reads
  // the machine, hooks Sessions of a Company that asked for it, and says what RTK saved.
  registerRtkIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(rtkChannels.changed)
    },
  })

  // The Sandbox add-on, which runs every Employee's Session inside ai-jail (T260). TinyCorp never
  // installs it and never ships it: this reads the machine and holds the Company's one switch.
  registerSandboxIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(sandboxChannels.changed)
    },
  })

  registerMcpIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(mcpChannels.changed)
    },
  })

  // The Company's Environments (T176): the boss's own tab, and the only place a value is shown —
  // after the OS has asked who is there, every time.
  registerEnvironmentsIpc({
    ipc: ipcMain,
    engine,
    askWhoIsThere,
    clipboard,
    // Which of the three stores this machine has (T177): the tab says where a value is kept, and
    // a Linux desktop with no keyring is told it cannot keep one instead of being pretended at.
    // An end-to-end run is on the in-memory store, which keeps a value for as long as the run
    // lasts and no longer, so it is told the same thing a Mac is rather than the keyring's refusal.
    backend: () => (e2e ? 'keychain' : secretBackend(safeStorage)),
    async pickEnvFile() {
      const options: OpenDialogOptions = {
        title: 'Choose a .env file',
        buttonLabel: 'Read keys',
        // A `.env` has no extension of its own, so the filter names what people really call them
        // and `showHiddenFiles` is on: a dotfile the dialog hides is a dotfile nobody can pick.
        filters: [{ name: 'Environment files', extensions: ['env', 'local', 'development', 'production', '*'] }],
        properties: ['openFile', 'showHiddenFiles'],
      }
      const owner = BrowserWindow.getFocusedWindow()
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(environmentChannels.changed)
    },
  })

  registerSkillsIpc({
    ipc: ipcMain,
    engine,
    pickFolder: () => pickFolder('Choose a skill folder'),
    // The Company's own checkouts, whose `.claude/skills` and friends the machine scan reads too
    // (T253). A scan before the first Company opens has none, and says so rather than throwing.
    repos: () => {
      try {
        return engine.repos.list().map((repo) => repo.path)
      } catch {
        return []
      }
    },
    // A team running inside WSL keeps its skills in the distro's home, which this Windows process
    // reaches over UNC (T167, T249). Off Windows, and on a Windows whose Providers all run on
    // Windows itself, there is no distro here and nothing is listed.
    wslHomes: () =>
      [
        ...new Set(
          PROVIDERS.map((provider) => runtimes.runtime(provider))
            .filter(isWsl)
            .map((at) => at.distro),
        ),
      ].flatMap(wslHomeFolders),
    broadcastChanged() {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(skillChannels.changed)
    },
  })

  registerProfileIpc({
    ipc: ipcMain,
    engine,
    broadcastChanged() {
      // The boss may have moved a Provider between Windows and WSL (T167). Only the pick is
      // recomputed — nothing is probed again — and the adapters are rebuilt in place, so the next
      // Session starts in the new place and a Session already running keeps its own adapter and
      // its own place.
      runtimes.repick()
      rebuildProviders()
      void preflight.recheck()
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(profileChannels.changed, null)
    },
    broadcastCompanyChanged() {
      const company = engine.currentCompany()
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(companyChannels.changed, company)
    },
  })

  registerCrashIpc({
    ipc: ipcMain,
    log: crashes,
    environment: { version: app.getVersion(), platform: process.platform },
  })

  registerKeepAwakeIpc({ ipc: ipcMain, keepAwake })
  registerPreflightIpc({ ipc: ipcMain, preflight })
  // What this Windows is, for the first-launch step and Your profile (T249). It reads the same
  // cached distro listing the Providers card was drawn from, so it starts no distro.
  registerWindowsMachineIpc({
    ipc: ipcMain,
    machine: () => readWindowsMachine({ distros: () => runtimes.distros() }),
    forgetPaths: forgetCliPaths,
  })

  /**
   * Whether a newer build exists (T130). The app ships unsigned, so this is a check and a link,
   * never an install: one unauthenticated read of a public endpoint at start and every six hours,
   * and silence whenever it fails. See `update-check.ts` for what changes with a certificate.
   */
  const updates = createUpdateCheck({
    currentVersion: () => app.getVersion(),
    // The app's one outbound call of its own; an end-to-end run makes none (T189).
    ...(e2e && { readLatest: () => Promise.resolve(null) }),
    onChanged(state) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(updateChannels.changed, state)
    },
  })
  registerUpdatesIpc({ ipc: ipcMain, updates, openExternal: (url) => void shell.openExternal(url) })
  void updates.check()
  const updateTimer = setInterval(() => void updates.check(), CHECK_EVERY_MS)
  app.on('will-quit', () => clearInterval(updateTimer))

  registerShellIpc({
    ipc: ipcMain,
    toggleMaximize() {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!window) return
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    },
  })

  /**
   * The menu bar says what the app can do, and is rebuilt whenever that changes (#223). Items that
   * stand for a button in the window send that button's own command; the boss's awake mode and the
   * repo link are the main process's own.
   */
  const applicationMenu = createApplicationMenu({
    host: electronMenuHost(),
    facts: () => engineMenuFacts(engine, keepAwake.state()),
    recents: () => engineMenuRecents(engine),
    watch: watchMenuEngine(engine),
    actions: {
      send: sendToWindow(showWindow),
      // The renderer decides what ⌘W closes: the view the boss is in first, the Company after
      // (T121, `src/renderer/src/chrome/close-request.ts`), so the two never fight over the key.
      closeCompany: () => showWindow().webContents.send(shellChannels.closeRequest),
      setKeepAwakeMode: (mode) => keepAwake.setMode(mode),
      openRepo: () => void shell.openExternal(REPO_URL),
    },
  })
  refreshApplicationMenu = applicationMenu.refresh
  app.on('will-quit', () => applicationMenu.close())

  /**
   * What the item says, and what its rows do: the same engine calls the renderer makes over the
   * IPC contract, so the day the engine is a process of its own they travel over a socket unchanged.
   */
  const menuBar =
    item &&
    createMenuBar({
      item,
      facts: () => engineTrayFacts(engine),
      watch: watchEngine(engine),
      actions: {
        open(companyId) {
          if (companyId && engine.currentCompany()?.id !== companyId) engine.switchCompany(companyId)
          background.open()
        },
        pauseAll: () => engine.sessions.stopAll(),
        /*
         * Resume all goes through a window, which the item brings back, rather than straight at the
         * engine (T217). A resume can have something to say — a pause that held nobody brings
         * nobody back, and an Employee can fail to start — and the menu bar has nowhere to say it;
         * the window's own command does exactly what the header's button does, and shows it there.
         * `Pause all` above stays quiet, because pausing from the menu bar is how the boss puts the
         * floor down without opening the app.
         */
        resumeAll: () => sendToWindow(() => background.open())({ kind: 'resume-all' }),
        quit: () => background.quit(),
      },
    })

  // Asked before the Launcher draws, so the window opens knowing what it has to say (T129, T135).
  await preflight.status()
  // The rest of the catalogue, warmed behind the first window: Your profile's Providers card is
  // about this Mac rather than this Company (T141), and it must never wait on a subprocess.
  void preflight.all()
  // And where RTK is (T179), behind the window too. It is read at every Session spawn, so the first
  // Session of the day would otherwise start uncompressed while nothing had looked yet.
  void engine.rtk.status()
  void engine.sandbox.status()

  const first = createWindow()

  /**
   * A smoke run (T166): no Company is opened, the first window is loaded, and the app says so and
   * leaves with 0. CI starts the packaged exe this way, which is the only test there is of the
   * thing a boss actually double-clicks.
   */
  if (smokeRun()) {
    const stop = setTimeout(() => {
      console.error('tinycorp: the first window never finished loading')
      app.exit(1)
    }, SMOKE_TIMEOUT_MS)
    first.webContents.once('did-finish-load', () => {
      clearTimeout(stop)
      writeFileSync(join(app.getPath('userData'), SMOKE_READY_FILE), `${SMOKE_READY}\n`)
      console.log(SMOKE_READY)
      app.exit(0)
    })
  }
})

/** Brings a window to the front, creating one when there is none. */
function showWindow(): BrowserWindow {
  const window = BrowserWindow.getAllWindows()[0] ?? createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

async function pickFolder(title: string): Promise<string | null> {
  const options: OpenDialogOptions = { title, properties: ['openDirectory'] }
  const owner = BrowserWindow.getFocusedWindow()
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}
