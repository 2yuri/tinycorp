// Run as `node tools/smoke-packaged.mjs`. No shebang: a test imports the checks below, and a `#!`
// line at the top of an imported module is a syntax error under the runner on Windows (T166).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `node tools/smoke-packaged.mjs` — does the build a boss double-clicks actually start? (T166)
 *
 * `pnpm package:win` has produced an installer since #361 and nothing had ever run what came out of
 * it. The unit suite proves the modules; this proves the bundle: the packaged executable is started
 * with `TINYCORP_SMOKE=1`, which opens no Company, loads the first window, says so and quits. The
 * run passes when the exit code is 0, the app printed that it loaded, and its crash log — which is
 * where an unhandled throw or rejection lands (T128) — is empty.
 *
 * It runs on all three now (T177): the `TinyCorp.app` a Mac DMG carries, the Windows
 * `win-unpacked` exe, and the Linux AppImage — which CI starts under `xvfb-run`, because a runner
 * has no display and a window that cannot be drawn is not a window that failed to load.
 *
 * `--user-data-dir` sends everything the run writes to a folder of its own, so the runner's real
 * profile is never touched and the crash log the check reads belongs to this run and no other.
 *
 * A second run asks the built app the one question the configuration cannot answer: is it still a
 * Node interpreter? (T199, finding H4.) The fuses are burnt into the binary by `pnpm package`, and
 * a fuse that is configured and never applied is worse than one nobody ever claimed.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

/** The variable `src/main/smoke-run.ts` reads, and the line it prints. A test holds the two equal. */
export const SMOKE_ENV = 'TINYCORP_SMOKE'
export const SMOKE_READY = 'tinycorp: window loaded'
export const SMOKE_READY_FILE = 'smoke-ready'

/** The line the node probe below prints if — and only if — the binary is still a Node interpreter. */
export const RAN_AS_NODE = 'tinycorp: ran as node'

/** Long enough for a cold start on a shared CI runner, short enough to fail rather than hang. */
const TIMEOUT_MS = 180_000

/** Where each platform's `electron-builder` `dir` target leaves the app. */
export const BUILDS = {
  win32: join('release', 'win-unpacked', 'TinyCorp.exe'),
  darwin: join('release', 'mac-arm64', 'TinyCorp.app', 'Contents', 'MacOS', 'TinyCorp'),
  linux: join('release', 'linux-unpacked', 'tinycorp'),
}

/**
 * Where `pnpm package:linux` leaves the file a boss actually downloads. The AppImage is the build
 * that has to start — the unpacked folder beside it is the same bytes without the wrapper — so it
 * is what the smoke run prefers, and `linux-unpacked` is only the answer when no AppImage was
 * built (T177).
 */
export function appImage(root = REPO) {
  const release = join(root, 'release')
  if (!existsSync(release)) return null
  const name = readdirSync(release).find((file) => file.endsWith('.AppImage'))
  return name ? join(release, name) : null
}

/** The packaged app on this machine, or null when nothing has been packaged for it. */
export function packagedApp(platform = process.platform, root = REPO) {
  if (platform === 'linux') {
    const image = appImage(root)
    if (image) return image
  }
  const relative = BUILDS[platform]
  if (!relative) return null
  const path = join(root, relative)
  return existsSync(path) ? path : null
}

/**
 * The arguments the app is started with, beyond the user-data folder.
 *
 * Linux needs `--no-sandbox`. Chromium's sandbox needs its helper to be setuid root, and the
 * helper inside an AppImage cannot be: the image is a read-only filesystem mounted by a user, and
 * a CI runner with no FUSE extracts it to a temp folder where the bit is lost either way. The
 * sandbox protects the app from the pages it renders, and this app renders its own; without the
 * flag the process exits before any window, which would make every Linux smoke run red for a
 * reason that has nothing to do with the build.
 */
export function smokeArgs(userData, platform = process.platform) {
  const args = [`--user-data-dir=${userData}`]
  if (platform === 'linux') args.push('--no-sandbox')
  return args
}

/**
 * The environment the run gets. `APPIMAGE_EXTRACT_AND_RUN` tells the AppImage runtime to unpack
 * itself into a temp folder instead of mounting itself, which is the only way it starts where
 * there is no FUSE — a GitHub `ubuntu-latest` runner, and a container.
 */
export function smokeEnv(platform = process.platform, env = process.env) {
  return platform === 'linux'
    ? { ...env, [SMOKE_ENV]: '1', APPIMAGE_EXTRACT_AND_RUN: '1' }
    : { ...env, [SMOKE_ENV]: '1' }
}

/**
 * The arguments that make a plain Electron binary evaluate a script and print what it found — the
 * exploit in finding H4, with `console.log` where the attacker's payload would be.
 *
 * Nothing else is passed, and in particular not `--user-data-dir`: Node refuses an option it does
 * not know and exits 9 before it evaluates anything, so a Chromium switch here would make the
 * probe pass for a reason that has nothing to do with the fuse. The folder is moved by
 * {@link nodeProbeEnv} instead.
 */
export function nodeProbeArgs() {
  return ['-e', `console.log(${JSON.stringify(RAN_AS_NODE)})`]
}

/**
 * The environment the probe runs in: `ELECTRON_RUN_AS_NODE`, which the `runAsNode` fuse is there to
 * make meaningless, and the smoke variable — because when the fuse holds this starts the app
 * instead, and an app that opens a window and waits is an app the probe has to kill.
 *
 * `home` is where the app half of that writes, since the probe cannot pass `--user-data-dir`:
 * Electron reads its user data out of `HOME` on macOS and Linux and `APPDATA` on Windows, and
 * pointing all three at a folder of this run's own keeps the real profile out of it.
 */
export function nodeProbeEnv(home, platform = process.platform, env = process.env) {
  return {
    ...smokeEnv(platform, env),
    ELECTRON_RUN_AS_NODE: '1',
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    XDG_CONFIG_HOME: home,
  }
}

/** Whether the binary answered the probe as Node, which is the fuse not being there at all. */
export function ranAsNode(output) {
  return output.includes(RAN_AS_NODE)
}

/** Starts the packaged app in smoke mode and reports its exit code and everything it printed. */
export function smokeRun(app, userData) {
  return startOnce(app, smokeArgs(userData), smokeEnv())
}

/** Starts the packaged app the way the H4 exploit would, with `home` standing in for the profile. */
export function nodeProbeRun(app, home) {
  return startOnce(app, nodeProbeArgs(), nodeProbeEnv(home))
}

/** One run of the packaged app, with these arguments and this environment, and no opinion on it. */
function startOnce(app, args, env) {
  return new Promise((done) => {
    const child = spawn(app, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    const stop = setTimeout(() => {
      child.kill()
      done({ code: null, output: `${output}\n(no answer in ${TIMEOUT_MS}ms)` })
    }, TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(stop)
      done({ code: null, output: `${output}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(stop)
      done({ code, output })
    })
  })
}

/** Whether the app wrote down that its window loaded, which is the half stdout cannot lose. */
export function saidItLoaded(userData, output) {
  return output.includes(SMOKE_READY) || existsSync(join(userData, SMOKE_READY_FILE))
}

/** Whatever the app wrote down about a crash during the run, or '' when it wrote nothing. */
export function crashes(userData) {
  const log = join(userData, 'logs', 'crashes.log')
  return existsSync(log) ? readFileSync(log, 'utf8').trim() : ''
}

/** What went wrong, in one sentence, or null when the run is a pass. */
export function verdict({ code, loaded, crashLog, ranAsNode: wasNode = false }) {
  // First, because a binary that answered as Node exited 0 without ever loading a window, and
  // "it never said it loaded" is the wrong sentence for that.
  if (wasNode) return 'the packaged app ran as Node: the runAsNode fuse is configured and not applied'
  if (code !== 0) return `the packaged app exited with ${code === null ? 'no code' : code}`
  if (!loaded) return `the packaged app never said "${SMOKE_READY}"`
  if (crashLog !== '') return 'the packaged app wrote to its crash log'
  return null
}

async function main() {
  const app = packagedApp()
  if (!app) {
    const command = { win32: 'pnpm package:win', linux: 'pnpm package:linux' }[process.platform] ?? 'pnpm package'
    console.error(`Nothing packaged for ${process.platform}: run \`${command}\` first.`)
    process.exit(1)
  }
  const userData = mkdtempSync(join(tmpdir(), 'tinycorp-smoke-'))
  const probeHome = mkdtempSync(join(tmpdir(), 'tinycorp-probe-'))
  try {
    const { code, output } = await smokeRun(app, userData)
    const crashLog = crashes(userData)
    const probe = await nodeProbeRun(app, probeHome)
    const wrong = verdict({
      code,
      loaded: saidItLoaded(userData, output),
      crashLog,
      ranAsNode: ranAsNode(probe.output),
    })
    if (wrong) {
      console.error(`Smoke run failed: ${wrong}`)
      if (output.trim()) console.error(`\n--- what it printed ---\n${output.trim()}`)
      if (probe.output.trim()) console.error(`\n--- what the node probe printed ---\n${probe.output.trim()}`)
      if (crashLog) console.error(`\n--- crashes.log ---\n${crashLog}`)
      process.exit(1)
    }
    console.log(`Smoke run passed: ${app} opened its first window, quit cleanly and is no Node interpreter.`)
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(probeHome, { recursive: true, force: true })
  }
}

// Only when it is the command. A test imports the checks above without starting anything.
if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
