// The part of `pnpm design:compare` that starts a harness and takes a picture of it. Lifted out of
// `design-audit.mjs` when `pnpm design:baseline` arrived (T209): two tools, one shooter, so a
// baseline and an audit of the same state are the same picture taken the same way.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The address every harness is served and shot at.
 *
 * `127.0.0.1`, spelled out, never `localhost`. Vite binds whatever `localhost` resolves to, and on
 * a Mac where that is `[::1]` the health check reaches it over IPv6 and says the server is up
 * while Electron asks for IPv4 and is refused — an `ERR_CONNECTION_REFUSED` that reads as a dead
 * server, a taken port, anything but what it is. The command line pins the bind and the URL asks
 * for the same thing.
 */
export const HOST = '127.0.0.1'

/** Where one harness answers. */
export function serverUrl(harness) {
  return `http://${HOST}:${harness.port}/`
}

/**
 * Starts one harness's vite server and resolves once it answers.
 *
 * A harness's port is pinned, and the config refuses to move off it — so a second checkout of this
 * repo running its own audit owns the port, this vite exits at once, and the URL answers **with
 * that checkout's app**. The shots come back looking like somebody else's branch, which is the
 * silent pass this whole tool exists to prevent, so a vite that dies before it answers is an
 * error rather than a wait.
 */
export async function serve(harness, log = () => {}) {
  const child = spawn(
    process.execPath,
    [join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', harness.config, '--host', HOST],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let died = null
  child.on('exit', (code) => (died = code ?? 1))
  child.stdout.on('data', (chunk) => log(`vite: ${chunk}`))
  child.stderr.on('data', (chunk) => log(`vite: ${chunk}`))
  const url = serverUrl(harness)
  for (let attempt = 0; attempt < 120; attempt++) {
    if (died !== null) {
      throw new Error(
        `${harness.config} exited ${died} without answering on ${url} — another checkout is probably serving that port`,
      )
    }
    try {
      const answer = await fetch(url)
      // Alive as well as answering: a harness whose port was still held by the wave before it
      // exits at once, and the thing that answered is the other harness's server (T209).
      if (answer.ok && died === null) return child
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  child.kill()
  throw new Error(`${harness.config} never answered on ${url}`)
}

/**
 * Kills a harness's vite and waits until its port has stopped answering.
 *
 * Not `kill()` and on to the next wave: several configs pin the same port, so the next wave's vite
 * starts while this one still holds it, exits at once — and the shot is taken against **this**
 * harness, which serves the same folder and answers every page in it. The Files capture came back
 * looking like an empty worktree that way, drawn by the drawer's server, and nothing said a word.
 */
export async function stop(child, harness) {
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((done) => {
      child.once('exit', () => done())
      child.kill()
    })
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!(await listening(harness.port))) return
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`something is still listening on ${harness.port} after ${harness.config} was stopped`)
}

/**
 * Whether anything holds the port, asked with a socket rather than a request.
 *
 * `fetch` answers this badly: undici keeps a connection pool, so a server that has gone can still
 * look alive, and a server that is alive but slow to answer can look gone. A connection either
 * opens or is refused.
 */
function listening(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: HOST })
    const settle = (held) => {
      socket.destroy()
      done(held)
    }
    socket.once('connect', () => settle(true))
    // Refused is the only answer that means nothing is there. A connection that takes too long is
    // a loaded machine, not a free port — reading it as free is how the next harness's vite found
    // the port taken, exited, and left a wave of states shot by nobody.
    socket.once('error', (error) => settle(error.code !== 'ECONNREFUSED'))
    socket.setTimeout(2000, () => settle(true))
  })
}

/**
 * The Electron script that takes every shot. Written to disk so `electron` can be handed a file.
 *
 * One window, resized per job, rather than one window per shot: a second offscreen window rejects
 * its `loadURL` with `ERR_FAILED` on this machine while the page loads perfectly well, so the load
 * is waited for on `did-finish-load` and the rejection is ignored.
 *
 * `fit` measures the page after it has drawn and grows the window to it, which is how the contact
 * sheet — however many states a table holds — is captured whole.
 *
 * `collect` is how the baseline says which of the stylesheets it drew (T209). Not which were
 * loaded: vite tags every style element it injects with the file it came from, but a folder's
 * front door brings its neighbours' stylesheets with it, so a modal nobody opened is loaded on
 * every screen that imports its folder. What is reported is whether any of a sheet's selectors
 * matches something the page is really showing, which is the question a pixel baseline asks. The
 * answer goes to a file rather than down stdout, where a third of a megabyte on one line comes
 * back cut in half.
 *
 * A `preload` turns the window's context isolation off so that script can reach the page's own
 * globals — the baseline's frozen clock. Without one the window is the audit's, unchanged.
 */
export function shooterSource() {
  return `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { jobs, preload, css, drawnOut } = JSON.parse(process.argv[process.argv.length - 1])
// A run cut short leaves this process behind with nobody reading its pipes. Electron turns the
// EPIPE of the next console.log into a dialog on the boss's screen; leave quietly instead, and do
// not outlive the tool that started us (reparented to launchd or init means it has gone).
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => app.exit(1))
process.on('uncaughtException', (error) => {
  try { require('node:fs').writeSync(2, String(error && error.stack ? error.stack : error) + '\\n') } catch {}
  app.exit(1)
})
const parent = process.ppid
setInterval(() => { if (process.ppid !== parent) app.exit(1) }, 1000).unref()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

function load(win, url) {
  return new Promise((done, fail) => {
    const off = () => {
      win.webContents.off('did-finish-load', ok)
      win.webContents.off('did-fail-load', bad)
    }
    const ok = () => { off(); done() }
    const bad = (_event, code, description) => { off(); fail(new Error(url + ': ' + description + ' (' + code + ')')) }
    win.webContents.on('did-finish-load', ok)
    win.webContents.on('did-fail-load', bad)
    win.loadURL(url).catch(() => {})
  })
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * The same load, tried a few times. A dev server answers its root long before it has transformed
 * the module graph of a page, and the first request for one can come back ERR_EMPTY_RESPONSE — or
 * refused, if the server is being restarted behind us. A page that is really not there fails all
 * three times and says so.
 */
async function loadAgain(win, url) {
  let last = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await load(win, url)
    } catch (error) {
      last = error
      await wait(1500)
    }
  }
  throw last
}

// Which stylesheets are drawing this page, not merely loaded into it: a sheet counts only when one
// of its selectors matches something the page is really showing. Pseudo-classes and
// pseudo-elements come off first, and an escaped colon (a Tailwind class) is left alone.
function sheetsInPage() {
  const clean = (selector) => selector.replace(/(?<!\\\\)::?[a-zA-Z-]+(\\([^()]*\\))?/g, '').trim()
  const matches = (selectorText) =>
    selectorText.split(',').some((one) => {
      const selector = clean(one)
      if (!selector) return false
      try { return document.querySelector(selector) !== null } catch { return false }
    })
  const anyRule = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText ? matches(rule.selectorText) : rule.cssRules && anyRule(rule.cssRules)) return true
    }
    return false
  }
  const sheets = {}
  for (const element of document.querySelectorAll('style[data-vite-dev-id]')) {
    try { sheets[element.dataset.viteDevId] = anyRule(element.sheet.cssRules) }
    catch { sheets[element.dataset.viteDevId] = false }
  }
  // How much the harness actually mounted, counted over the whole body rather than the mount node:
  // a modal renders into a portal, and the Edit Employee capture leaves its own root empty. A
  // capture whose stub is one API short throws, renders nothing, and shoots the page's background
  // colour — which reads as a screen that has not changed since yesterday, for ever. The desk
  // capture had been doing exactly that (T209).
  const mounted = [...document.body.querySelectorAll('*')].filter((one) => one.tagName !== 'SCRIPT')
  return { sheets, elements: mounted.length }
}
const SHEETS = '(' + sheetsInPage.toString() + ')()'

// Every face loaded and every image decoded, whichever of them the page has.
const READY =
  'Promise.all([document.fonts ? document.fonts.ready : 0]' +
  '.concat([...document.images].map((i) => i.decode().catch(() => {})))).then(() => true)'

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    webPreferences: preload
      ? { offscreen: true, backgroundThrottling: false, preload, contextIsolation: false, sandbox: false }
      : { offscreen: true, backgroundThrottling: false },
  })
  const drawn = {}
  for (const job of jobs) {
    win.setContentSize(job.width, job.height)
    await loadAgain(win, job.url)
    if (css) await win.webContents.insertCSS(css)
    await wait(job.settleMs)
    // The page has drawn; now let what it drew finish arriving. A face still loading and an image
    // still decoding are both a different picture depending on when the shutter opened, and both
    // are why four states came back flaky the first time a baseline was taken twice (T209).
    await win.webContents.executeJavaScript(READY)
    await wait(400)
    if (job.fit) {
      await win.webContents.executeJavaScript('window.sheetReady || Promise.resolve()')
      const tall = await win.webContents.executeJavaScript('document.documentElement.scrollHeight')
      win.setContentSize(job.width, Math.ceil(tall))
      await wait(1000)
    }
    const image = await win.webContents.capturePage()
    writeFileSync(job.out, image.toPNG())
    // After the shutter, never before it: reading every stylesheet's selectors is work, and work
    // between the settle and the capture is time a page still arriving spends arriving. With the
    // probe in front, a run that collected and a run that did not were shooting two different
    // moments of the same page, and half the table came back flaky for it (T209).
    if (job.collect) {
      drawn[job.collect] = await win.webContents.executeJavaScript(SHEETS)
      // Written as it goes: a dev server that dies mid-run takes this process with it, and what
      // the states before it drew is still worth having.
      if (drawnOut) writeFileSync(drawnOut, JSON.stringify(drawn))
    }
    console.log('shot ' + job.out + ' ' + image.getSize().width + 'x' + image.getSize().height)
    // A page left behind keeps its timers running under the next one's shot.
    await load(win, 'about:blank')
  }
  win.destroy()
  app.exit(0)
}).catch((error) => {
  console.error(String(error && error.stack ? error.stack : error))
  app.exit(1)
})
`
}

/**
 * The command line the shooter's Electron is started with — the jobs last, and on macOS one user
 * default of its own.
 *
 * **The gate may not depend on whether a mouse is plugged in.** macOS's *Show scroll bars* is
 * `Automatic` out of the box, and `Automatic` means exactly that: with a mouse connected Chromium
 * draws classic scrollbars, which take 15px of layout width, and without one it draws overlay
 * scrollbars, which take none. So a run taken after the boss unplugged a mouse moved every state
 * with a scroll container by the gutter, and the ones whose content then wraps by more than that —
 * 44 of 114 states over the floor, and not one of them from the code (T254).
 *
 * A macOS process reads user defaults from its own command line (`NSArgumentDomain`), which is the
 * one place this can be pinned for the shooter and for nobody else: the boss's own system setting
 * is never touched, and a shot taken on their machine is the shot taken on anyone's. `Always` is
 * the style every committed baseline was shot in.
 *
 * Windows and Linux need no pin: Chromium draws its own scrollbars there, at a width from its own
 * theme, and the overlay ones are behind a feature flag that is off — neither is read from a
 * per-user setting the way `AppleShowScrollBars` is.
 */
export function shooterArgs(script, profile, payload, platform = process.platform) {
  return [
    script,
    `--user-data-dir=${profile}`,
    ...(platform === 'darwin' ? ['-AppleShowScrollBars', 'Always'] : []),
    // Last, whatever else is on the line: the shooter reads its jobs off the end of it.
    JSON.stringify(payload),
  ]
}

/**
 * Runs Electron over the jobs and waits for it to finish.
 *
 * Answers what each job that asked for it drew: the stylesheets vite had injected when the shot
 * was taken, keyed by the job's `collect`. That is the baseline's coverage table, measured rather
 * than written down (T209).
 */
export function shoot(jobs, scratch, log, { preload = null, css = null, env = null } = {}) {
  const script = join(scratch, 'shooter.cjs')
  const drawnOut = jobs.some((job) => job.collect) ? join(scratch, 'drawn.json') : null
  writeFileSync(script, shooterSource())
  // The package exports the binary's path on this platform; `path.txt` is relative to `dist/`.
  const binary = createRequire(import.meta.url)('electron')
  log(`electron ${JSON.parse(readFileSync(join(REPO, 'node_modules', 'electron', 'package.json'), 'utf8')).version}`)
  return new Promise((done, fail) => {
    // A profile of its own, thrown away with the scratch: a screen that remembers something in
    // `localStorage` — the Files view remembers its open tabs — would otherwise carry it from one
    // run to the next, and the baseline would be a picture of what happened to run before it.
    const profile = join(scratch, 'electron-profile')
    const child = spawn(binary, shooterArgs(script, profile, { jobs, preload, css, drawnOut }), {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', fail)
    child.on('close', (code) => {
      if (process.env.TINYCORP_AUDIT_KEEP) log(output)
      const drawn = drawnOut && existsSync(drawnOut) ? JSON.parse(readFileSync(drawnOut, 'utf8')) : {}
      // A shot with no file is a failure however the process ended. Electron has come back 0 with
      // a job missing, and a caller that trusts the exit code scores a picture that is not there.
      const missing = jobs.filter((job) => !existsSync(job.out))
      if (code !== 0 || missing.length > 0) {
        const why =
          code !== 0
            ? `electron exited ${code}`
            : `electron exited 0 but wrote nothing for ${missing.map((job) => job.url).join(', ')}`
        const error = new Error(`${why}\n${output}`)
        // What the shots before the failure drew, for a caller that means to take the rest again.
        error.drawn = drawn
        return fail(error)
      }
      return done(drawn)
    })
  })
}
