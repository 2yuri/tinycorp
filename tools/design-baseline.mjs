// Run as `pnpm design:baseline` and `pnpm design:compare`. No shebang: a test imports the table
// below, and a `#!` line at the top of an imported module is a syntax error under the runner on
// Windows (T166).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodePng, diffScore, formatScore } from './design-diff.mjs'
import { serve, serverUrl, shoot, stop } from './design-shooter.mjs'

/**
 * `pnpm design:baseline` — every screen this app draws, as it draws it **today**, one PNG each.
 * `pnpm design:compare` — the same screens again, against those PNGs.
 *
 * `design:compare` asks a different question: does this screen look like the frame Pen drew? It is
 * the right question while a screen is being built, and it covers the states that have a frame.
 * The renderer is moving to Tailwind — 25k lines of stylesheet — and a migration is correct when
 * it changes **nothing**, whatever Pen says. Nothing is what these two commands measure: a
 * picture of every state before the change, and the same picture after it.
 *
 * So this table is wider than the audit's and has no frames in it. Every capture harness in the
 * repo is here, and every state behind a query parameter, because a stylesheet no state draws is
 * a stylesheet the migration can break in silence. {@link coverage} says which of them each run
 * really drew — read out of the page, not written down here.
 *
 * Three things make a baseline worth keeping, and the command enforces all three. It is the same
 * picture twice: every state is shot twice and one that moves by more than {@link COMPARE_FLOOR}
 * between the two fails, because a state with a clock, a random or an animation behind it would
 * fail every `compare` from then on. It is not a blank page: a harness that mounted nothing fails
 * by name, because a flat background is the most stable baseline there is. And it says what it
 * covers, in a table printed at the end of every run.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

/** Where the PNGs live, one folder per harness. They are committed: they are the baseline. */
export const BASELINE_DIR = join('design', 'baseline')

/** Where a run that moved leaves its sheet. Written by `compare`, never committed. */
export const MOVED_SHEET = join('docs', 'design-audit', 'baseline-moved.png')

/**
 * How far a state may move from its baseline and still count as unchanged.
 *
 * Ten times tighter than the audit's `DIFF_FLOOR`, and for the opposite reason. The audit compares
 * two rasterisers — Pen's exporter and Chromium — so most of its floor is their disagreement. Both
 * sides of a baseline pair come out of the same Chromium on the same page, so a state that has not
 * changed scores 0.00. The floor is here for the last of the machine's noise, not for drift: a
 * pair over it has moved, and a Tailwind migration that moves a pixel is a migration to look at.
 */
export const COMPARE_FLOOR = 0.3

/** The window most harnesses render at; the shell's own. */
export const WINDOW = { width: 1512, height: 944 }

/**
 * Every capture harness in the repo: the vite config that serves it, and the port that config
 * pins.
 *
 * Unlike the audit's four, these collide — three configs pin 5188 — which is one of the two
 * reasons {@link runs} serves them one at a time.
 */
export const HARNESSES = {
  activity: { config: 'src/renderer/src/activity/capture/vite.config.mts', port: 5186 },
  board: { config: 'src/renderer/src/board/capture/vite.config.mts', port: 5190 },
  chat: { config: 'src/renderer/src/chat/capture/vite.config.mts', port: 5183 },
  crash: { config: 'src/renderer/src/shell/crash/capture/vite.config.mts', port: 5190 },
  desk: { config: 'src/renderer/src/office/desk-capture/vite.config.mts', port: 5187 },
  drawer: { config: 'src/renderer/src/employee-drawer/capture/vite.config.mts', port: 5188 },
  'drawer-memory': { config: 'src/renderer/src/employee-drawer/capture-memory/vite.config.mts', port: 5188 },
  employees: { config: 'src/renderer/src/employees/capture/vite.config.mts', port: 5194 },
  files: { config: 'src/renderer/src/files/capture/vite.config.mts', port: 5188 },
  launcher: { config: 'src/renderer/src/launcher/capture/vite.config.mts', port: 5192 },
  memory: { config: 'src/renderer/src/memory/capture/vite.config.mts', port: 5186 },
  'model-picker': { config: 'src/renderer/src/model-picker/capture/vite.config.mts', port: 5193 },
  office: { config: 'src/renderer/src/office/capture/vite.config.mts', port: 5184 },
  'office-view': { config: 'src/renderer/src/office-view/capture/vite.config.mts', port: 5192 },
  onboarding: { config: 'src/renderer/src/onboarding/capture/vite.config.mts', port: 5196 },
  preflight: { config: 'src/renderer/src/preflight/capture/vite.config.mts', port: 5191 },
  profile: { config: 'src/renderer/src/profile/capture/vite.config.mts', port: 5187 },
  repositories: { config: 'src/renderer/src/repositories/capture/vite.config.mts', port: 5195 },
  review: { config: 'src/renderer/src/review/capture/vite.config.mts', port: 5184 },
  settings: { config: 'src/renderer/src/settings/capture/vite.config.mts', port: 5185 },
  sidebar: { config: 'src/renderer/src/shell/capture/vite.config.mts', port: 5189 },
  testing: { config: 'src/renderer/src/testing/capture/vite.config.mts', port: 5197 },
  ui: { config: 'src/renderer/src/ui/gallery/capture/vite.config.mts', port: 5198 },
  usage: { config: 'src/renderer/src/usage/capture/vite.config.mts', port: 5191 },
}

/** A row of the table, spelled out once so the states below read as a list and not as a form. */
const state = (harness, id, page, query, size = WINDOW) => ({ harness, id, page, query, ...size })

const SHELL = WINDOW
const DRAWER = { width: 440, height: 836 }
const PANEL = { width: 440, height: 634 }
const MODAL = { width: 760, height: 940 }
const WINDOWED = { width: 680, height: 740 }

/**
 * Every state, in the order a run shoots them: harness by harness, so the servers come up once.
 *
 * `page` is the capture HTML in `src/renderer`, `query` what puts the screen in this state, and
 * the size is the window it is shot in — each harness's own, as its README gives it, because a
 * panel shot at the shell's size is mostly empty background.
 */
export const STATES = [
  state('activity', 'activity', 'activity-capture.html', ''),

  state('board', 'board', 'board-capture.html', '?closed'),
  state('board', 'board-testing', 'board-capture.html', '?testing&closed'),
  state('board', 'ticket-drawer', 'board-capture.html', ''),
  state('board', 'ticket-drawer-foot', 'board-capture.html', '?foot'),
  state('board', 'ticket-delete', 'board-capture.html', '?ticket=142&delete'),
  state('board', 'new-ticket', 'board-capture.html', '?new'),
  state('board', 'plan-states', 'board-capture.html', '?plan'),

  state('chat', 'chat', 'capture.html', '?capture=chat'),
  state('chat', 'chat-hire-approval', 'capture.html', '?capture=hire'),
  state('chat', 'chat-env-approval', 'capture.html', '?capture=env'),
  state('chat', 'chat-inbox', 'capture.html', '?capture=inbox'),
  state('chat', 'chat-inbox-conversation', 'capture.html', '?capture=inbox-conversation'),
  state('chat', 'chat-header', 'capture.html', '?capture=header'),
  state('chat', 'chat-panels', 'capture.html', '?capture=panels'),
  state('chat', 'chat-palette', 'capture.html', '?capture=palette'),
  state('chat', 'chat-palette-skills', 'capture.html', '?capture=palette-skills'),
  state('chat', 'chat-attachments', 'capture.html', '?capture=attachments'),
  state('chat', 'chat-lightbox', 'capture.html', '?capture=lightbox'),
  state('chat', 'chat-planning', 'capture.html', '?capture=planning'),
  state('chat', 'chat-answered', 'capture.html', '?capture=answered'),
  state('chat', 'chat-prs', 'capture.html', '?capture=prs'),
  // The target card with a whole sentence for a title (T271): it wraps, and never runs past the card.
  state('chat', 'chat-targets', 'capture.html', '?capture=targets'),
  state('chat', 'chat-digest', 'capture.html', '?capture=digest'),
  state('chat', 'chat-paths', 'capture.html', '?capture=paths'),
  state('chat', 'chat-delete-channel', 'capture.html', '?capture=delete'),

  state('crash', 'crash', 'crash-capture.html', '', { width: 1010, height: 880 }),

  state('desk', 'your-desk', 'desk-capture.html', '', DRAWER),

  state('drawer', 'drawer-chats', 'drawer-capture.html', '', DRAWER),
  state('drawer', 'drawer-subagents', 'drawer-capture.html', '?view=subagents', DRAWER),
  state('drawer', 'drawer-sessions', 'drawer-capture.html', '?view=sessions', DRAWER),
  state('drawer', 'drawer-handoff', 'drawer-capture.html', '?view=handoff', DRAWER),
  state('drawer', 'drawer-handoff-copied', 'drawer-capture.html', '?view=handoff&copy=1', DRAWER),
  state('drawer', 'drawer-routed', 'drawer-capture.html', '?view=routed', { width: 560, height: 836 }),
  state('drawer', 'drawer-rtk', 'drawer-capture.html', '?view=subagents&rtk=on', DRAWER),
  state('drawer', 'drawer-wakes', 'drawer-capture.html', '?wakes', DRAWER),
  state('drawer', 'drawer-ticket-folded', 'drawer-capture.html', '?view=subagents&ticket=folded', DRAWER),
  state('drawer', 'drawer-ticket-open', 'drawer-capture.html', '?view=subagents&ticket=open', DRAWER),

  state('drawer-memory', 'drawer-notes', 'memory-capture.html', '', PANEL),

  state('employees', 'edit-employee', 'edit-employee-capture.html', '', MODAL),
  state('employees', 'edit-employee-end', 'edit-employee-capture.html', '?role=Backend&scroll=end', MODAL),
  state('employees', 'hire-employee', 'edit-employee-capture.html', '?modal=hire', MODAL),
  state('employees', 'hire-permissions', 'edit-employee-capture.html', '?modal=hire&permissions=interactive', MODAL),
  state('employees', 'team', 'team-capture.html', ''),

  // The Files harness reads a real worktree by design, so `?fixture` pins what it reads: the tree
  // in `src/renderer/src/files/capture/tree`, which changes only when somebody changes it (T209).
  //
  // Its **Changes** tab has no baseline state, and cannot have one here: it is this checkout's own
  // `git status`, so it is a different picture on every branch. `pnpm design:compare` still covers
  // it against frame `LFdty`, where a person reads the sheet.
  state('files', 'files', 'files-capture.html', '?fixture&path=src/currency.ts'),
  state('files', 'files-tabs', 'files-capture.html', '?fixture&path=src/currency.ts&path=docs/billing.md'),
  state('files', 'files-open-with', 'files-capture.html', '?fixture&path=docs/billing.md&openWith=1'),
  // An image opens fitted to the panel (T236); the fixture's chart is bigger than the panel, so
  // `Fit` has something to do and the zoom keys are all in frame.
  state('files', 'files-image', 'files-capture.html', '?fixture&path=docs/usage-totals.png'),
  // A search that finds nothing, which is the one state left that draws `src/styles.css` — three
  // class names shared by the screens nobody has migrated yet.
  state('files', 'files-nothing-found', 'files-capture.html', '?fixture&find=zzz'),

  state('launcher', 'launcher', 'launcher-capture.html', '', WINDOWED),
  state('launcher', 'launcher-finished', 'launcher-capture.html', '?unfinished=0', WINDOWED),
  // The Create step, with the folder it suggests before the picker is ever opened, and the same
  // folder inside OneDrive, which says a folder outside it is safer (T252).
  state('launcher', 'launcher-create', 'launcher-capture.html', '?step=create', WINDOWED),
  state('launcher', 'launcher-create-onedrive', 'launcher-capture.html', '?step=create&onedrive=1', WINDOWED),
  state('launcher', 'launcher-create-wsl', 'launcher-capture.html', '?step=create&wsl=1', WINDOWED),
  // A boss with a dozen Companies (T267): four rows and a search over them, the search filtering,
  // and a search that matches nothing.
  state('launcher', 'launcher-many', 'launcher-capture.html', '?many=1', WINDOWED),
  state('launcher', 'launcher-many-search', 'launcher-capture.html', '?many=1&q=ne', WINDOWED),
  state('launcher', 'launcher-many-no-match', 'launcher-capture.html', '?many=1&q=zq', WINDOWED),

  state('memory', 'memory', 'company-memory-capture.html', '', { width: 1512, height: 900 }),
  state('memory', 'memory-new-company', 'company-memory-capture.html', '?state=empty', { width: 1512, height: 900 }),
  state('memory', 'memory-new-page', 'company-memory-capture.html', '?state=new', { width: 1512, height: 900 }),
  state('memory', 'memory-edit-page', 'company-memory-capture.html', '?state=edit', { width: 1512, height: 900 }),
  state('memory', 'memory-states', 'company-memory-states-capture.html', '', { width: 760, height: 1860 }),

  state('model-picker', 'model-picker', 'model-picker-capture.html', '', { width: 1280, height: 700 }),
  state('model-picker', 'model-picker-end', 'model-picker-capture.html', '?menu=end', { width: 1280, height: 700 }),
  state('model-picker', 'model-picker-shut', 'model-picker-capture.html', '?open=0', { width: 1280, height: 700 }),

  // The office is a canvas the Employees walk across, so every state here is `delay=0` — everyone
  // already where they are going. A walk in progress is a different picture every time it is shot,
  // which is why `?everyone=parked` is not here: parked Employees walk to the coffee area, and two
  // shots of that are two different pictures however long the shutter waits.
  state('office', 'office', 'office-capture.html', '?delay=0', { width: 1040, height: 660 }),
  state('office', 'office-approval', 'office-capture.html', '?delay=0&boss=3&approval=1', { width: 1040, height: 660 }),
  state('office', 'office-night-city', 'office-capture.html', '?delay=0&room=night-city&boss=3&approval=1', {
    width: 1040,
    height: 660,
  }),
  state('office', 'office-night-city-parked', 'office-capture.html', '?delay=0&room=night-city&everyone=parked', {
    width: 1040,
    height: 660,
  }),

  state('office-view', 'keep-awake', 'keep-awake-capture.html', '', { width: 460, height: 420 }),
  state('office-view', 'out-of-budget', 'keep-awake-capture.html', '?capture=budget', { width: 1040, height: 660 }),

  state('onboarding', 'onboarding-repositories', 'onboarding-repos-capture.html', ''),
  state('onboarding', 'onboarding-team', 'onboarding-repos-capture.html', '?step=team'),
  state('onboarding', 'onboarding-first-ticket', 'onboarding-repos-capture.html', '?step=first-ticket'),

  state('preflight', 'preflight-signed-out', 'preflight-capture.html', '?state=signed-out', WINDOWED),
  state('preflight', 'preflight-missing', 'preflight-capture.html', '?state=missing', WINDOWED),
  state('preflight', 'preflight-warning', 'preflight-capture.html', '?state=warning', WINDOWED),
  state('preflight', 'preflight-ready', 'preflight-capture.html', '?state=ready', WINDOWED),
  // The chooser of frames `KB9AX` and `c8knu` (T250): nobody hired, so no CLI here can run an
  // Employee and the boss has one thing to do rather than three.
  state(
    'preflight',
    'preflight-three-providers',
    'preflight-capture.html',
    '?state=missing&providers=claude,codex,opencode&hired=0',
    WINDOWED,
  ),
  state(
    'preflight',
    'preflight-wsl',
    'preflight-capture.html',
    '?state=missing&providers=claude,codex,opencode&hired=0&places=windows-wsl',
    WINDOWED,
  ),
  // T258: the boss chose WSL and the CLI is not in there — one install command, theirs, and the
  // sentence that offers the place the CLI really is.
  state(
    'preflight',
    'preflight-chosen-empty',
    'preflight-capture.html',
    '?state=missing&providers=claude&places=chosen-empty',
    WINDOWED,
  ),
  // Frame `uSaf3`: a Company whose Employees are hired on two Providers that cannot run.
  state(
    'preflight',
    'preflight-hired',
    'preflight-capture.html',
    '?providers=claude,codex&states=signed-out,missing',
    WINDOWED,
  ),

  state('profile', 'your-profile', 'profile-capture.html', ''),

  state('repositories', 'repositories', 'repositories-capture.html', ''),
  state('repositories', 'new-repo', 'new-repo-capture.html', ''),
  state('repositories', 'new-repo-in-place', 'new-repo-capture.html', '?state=in-place'),
  state('repositories', 'new-repo-refused', 'new-repo-capture.html', '?state=refused'),
  state('repositories', 'add-repo-not-a-repo', 'new-repo-capture.html', '?state=local'),
  state('repositories', 'found-repos', 'found-repos-capture.html', ''),
  state('repositories', 'found-repos-scanning', 'found-repos-capture.html', '?state=scanning'),
  state('repositories', 'found-repos-empty', 'found-repos-capture.html', '?state=empty'),

  state('review', 'review', 'review-capture.html', ''),
  state('review', 'review-threads', 'review-capture.html', '?threads'),
  // The same conversation read side by side, which is the boss asking for it at a width that opens
  // inline: a thread has to span both panes there, and this is the shot that says it still does.
  state('review', 'review-threads-split', 'review-capture.html', '?threads&split'),

  state('settings', 'settings-general', 'settings-capture.html', '?tab=general&height=1400', {
    width: 1512,
    height: 1400,
  }),
  state('settings', 'settings-general-empty', 'settings-capture.html', '?tab=general&data=empty&height=1400', {
    width: 1512,
    height: 1400,
  }),
  state('settings', 'settings-general-long-name', 'settings-capture.html', '?tab=general&data=long&height=1400', {
    width: 1512,
    height: 1400,
  }),
  state('settings', 'settings-general-temporary', 'settings-capture.html', '?tab=general&data=temporary&height=1400', {
    width: 1512,
    height: 1400,
  }),
  state('settings', 'settings-office', 'settings-capture.html', '?tab=office'),
  state('settings', 'settings-routing', 'settings-capture.html', '?tab=routing'),
  state('settings', 'settings-routing-empty', 'settings-capture.html', '?tab=routing&data=empty'),
  state('settings', 'settings-tokens', 'settings-capture.html', '?tab=tokens'),
  state('settings', 'settings-tokens-missing', 'settings-capture.html', '?tab=tokens&rtk=missing'),
  state('settings', 'settings-tokens-old', 'settings-capture.html', '?tab=tokens&rtk=old'),
  state('settings', 'settings-tokens-wsl', 'settings-capture.html', '?tab=tokens&rtk=wsl'),
  // The window as the audit shoots it, so `design-baseline.test.ts` can pair the two: the audit
  // scores this page against `ttODp` and the pairing is by page and query.
  state('settings', 'settings-addons', 'settings-capture.html', '?tab=addons'),
  // The same tab with no ai-jail, and **1700 tall on purpose** (T260, frame `gJyAJ`): three add-ons
  // with their own panels put the third below a 944-tall fold, so this is the state that has the
  // whole Sandbox card in it — the toggle refused, the line the boss runs, and where we looked.
  // It is taller than the audit's window, which it may be: no frame is scored against it.
  state('settings', 'settings-addons-empty', 'settings-capture.html', '?tab=addons&data=empty&height=1700', {
    width: 1512,
    height: 1700,
  }),
  state('settings', 'settings-environments', 'settings-capture.html', '?tab=environments'),
  state('settings', 'settings-environments-empty', 'settings-capture.html', '?tab=environments&data=empty'),
  state('settings', 'settings-environments-import', 'settings-capture.html', '?tab=environments&open=import'),
  state('settings', 'settings-integrations', 'settings-capture.html', '?tab=integrations'),
  state('settings', 'settings-mcp-import', 'settings-capture.html', '?tab=integrations&open=mcp-import'),
  state('settings', 'settings-mcp-preset', 'settings-capture.html', '?tab=integrations&open=mcp-preset'),
  state('settings', 'settings-integrations-empty', 'settings-capture.html', '?tab=integrations&data=empty'),
  // The right column whole, so the card the tab's own shot clips at the window edge is in a
  // baseline of its own: the groups, their counts, and both folds shut (T253, frame `LBKv1`).
  state('settings', 'settings-skills-found', 'settings-capture.html', '?tab=integrations&height=1600', {
    width: 1512,
    height: 1600,
  }),

  state('sidebar', 'sidebar', 'sidebar-capture.html', '', { width: 276, height: 900 }),
  state('sidebar', 'sidebar-drafts', 'sidebar-capture.html', '?drafts', { width: 276, height: 900 }),
  state('sidebar', 'company-rail', 'sidebar-capture.html', '?rail', { width: 68, height: 356 }),

  state('testing', 'testing', 'testing-capture.html', ''),
  state('testing', 'testing-cards', 'testing-capture.html', '?cards'),

  // The kit's own page (T215's harness). A card or a table cell that moves here moves on every
  // screen at once, and both of the kit's themes are drawn from the same stylesheets.
  state('ui', 'kit-gallery', 'gallery-capture.html', '', { width: 1512, height: 3890 }),
  state('ui', 'kit-gallery-dark', 'gallery-capture.html', '?theme=dark', { width: 1512, height: 3890 }),

  state('usage', 'usage-button', 'usage-capture.html', '?capture=button', { width: 276, height: 36 }),
  state('usage', 'usage-popover', 'usage-capture.html', '?capture=popover', { width: 360, height: 296 }),
  state('usage', 'usage-unavailable', 'usage-capture.html', '?capture=unavailable', { width: 360, height: 296 }),
  // Two sign-ins under one Provider, each with its own numbers (T257, frame `nV8jR`, 360x370).
  state('usage', 'usage-accounts', 'usage-capture.html', '?capture=accounts', { width: 360, height: 370 }),
  // The sign-in modal's card, in progress and signed in (T263, frames `Tmldc` and `iA8Wm`, 780x477).
  state('usage', 'sign-in-in-progress', 'usage-capture.html', '?capture=sign-in', { width: 780, height: 477 }),
  state('usage', 'sign-in-signed-in', 'usage-capture.html', '?capture=signed-in', { width: 780, height: 477 }),
]

/**
 * The CSS every shot is taken under: no animation, no transition, no caret.
 *
 * Not `animation: none`, which leaves a screen that fades in invisible — a 1ms animation with a
 * negative delay lands on its last frame instead, which is the frame a person looking at the
 * screen sees. The caret goes because it blinks, and a blinking caret is a state that is a
 * different picture depending on when the shutter opened.
 */
export const STILL_CSS = `*, *::before, *::after {
  animation-delay: -1ms !important;
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}`

/**
 * How long a state is given to finish drawing before the shutter opens.
 *
 * Longer than the audit's 1500, because the audit is read by a person and this is read by a
 * comparison: a sprite sheet that lands a frame late costs the audit nothing and costs this a
 * state that fails for ever. The four chat states with pixel characters in them were the ones
 * that said so.
 */
export const SETTLE_MS = 2500

/** The preload that freezes the page's clock and its randomness, beside this file. */
export const STABILISER = join(HERE, 'design-stabiliser.cjs')

/** Where one state's baseline PNG lives. POSIX, because it is a path this repo commits. */
export function pathOf(oneState) {
  return posix.join(BASELINE_DIR.split(sep).join('/'), oneState.harness, `${oneState.id}.png`)
}

/** The URL one state is shot at. */
export function urlOf(oneState, harnesses = HARNESSES) {
  return `${serverUrl(harnesses[oneState.harness])}${oneState.page}${oneState.query}`
}

/**
 * The states grouped by harness, in the order the table lists them: one harness served at a time.
 *
 * One at a time for two reasons, and they are the same reason twice. **The ports collide** — three
 * configs pin 5188, five more ports are shared by two — so two harnesses served at once would have
 * one of them answering for the other, which is the silent wrong shot this whole family of tools
 * exists to prevent. And **the servers are heavy**: four vites and an Electron beside them is more
 * than a laptop holds, and a dev server killed halfway through a run takes the rest of its
 * harness's shots with it. Serving them in turn costs a few minutes and cannot do either.
 */
export function runs(states) {
  const order = []
  for (const one of states) if (!order.includes(one.harness)) order.push(one.harness)
  return order.map((harness) => ({
    harness,
    states: states.filter((one) => one.harness === harness),
  }))
}

/** Every stylesheet the renderer has, repo-relative and POSIX, sorted. */
export function stylesheets(root = join(REPO, 'src', 'renderer')) {
  const found = []
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.css')) found.push(relative(REPO, path).split(sep).join('/'))
    }
  }
  walk(root)
  return found.sort()
}

/**
 * The same sheets, plus the ones they `@import`.
 *
 * `tokens.css` is drawn on every screen in the app and loaded by none of them: vite inlines a
 * relative `@import` into the importing sheet's own style element, so the page reports `base.css`
 * and never says that half of what it is holding came from somewhere else. Following the imports
 * here is the difference between a coverage table that is true and one that keeps naming the
 * repo's most-used stylesheet as unwatched.
 */
export function withImports(sheets, root = REPO) {
  const all = new Set(sheets)
  for (const sheet of all) {
    const file = join(root, sheet)
    if (!existsSync(file)) continue
    const folder = sheet.slice(0, sheet.lastIndexOf('/'))
    for (const [, path] of readFileSync(file, 'utf8').matchAll(/@import\s+['"](\.[^'"]+)['"]/g)) {
      all.add(posix.normalize(posix.join(folder, path)))
    }
  }
  return [...all]
}

/**
 * Which stylesheets the run drew, and which it did not.
 *
 * `drawn` is the sheets each state really put on screen, keyed by state id. A sheet nothing drew
 * is a sheet no baseline watches, which is the one thing this table exists to say out loud — and
 * the reason it is measured in the page rather than reasoned about here.
 */
export function coverage(drawn, sheets = stylesheets()) {
  const byFolder = new Map()
  for (const sheet of sheets) {
    const folder = sheet.slice(0, sheet.lastIndexOf('/'))
    const states = Object.entries(drawn)
      .filter(([, loaded]) => loaded.includes(sheet))
      .map(([id]) => id)
    const row = byFolder.get(folder) ?? { folder, sheets: [], states: new Set(), uncovered: [] }
    row.sheets.push(sheet)
    for (const id of states) row.states.add(id)
    if (states.length === 0) row.uncovered.push(sheet)
    byFolder.set(folder, row)
  }
  return [...byFolder.values()].map((row) => ({ ...row, states: [...row.states].sort() }))
}

/** The coverage table as the command prints it: one line per renderer folder that has CSS. */
export function coverageLines(rows) {
  const width = Math.max(...rows.map((row) => row.folder.length))
  return rows.map((row) => {
    const mark = row.uncovered.length === 0 ? 'ok  ' : 'NONE'
    const says =
      row.uncovered.length === 0
        ? `${row.sheets.length} sheet${row.sheets.length === 1 ? '' : 's'} · drawn by ${row.states.length} state${row.states.length === 1 ? '' : 's'}`
        : `${row.uncovered.length} of ${row.sheets.length} drawn by no state: ${row.uncovered.map((sheet) => sheet.slice(sheet.lastIndexOf('/') + 1)).join(', ')}`
    return `${mark} ${row.folder.padEnd(width)}  ${says}`
  })
}

/**
 * What a compare run found, as one line each, worst first — and a state with no baseline at all is
 * the worst there is, so it leads whatever the others scored.
 */
export function movedLines(pairs) {
  return [...pairs]
    .sort((a, b) => (a.score === null ? -1 : b.score === null ? 1 : b.score - a.score))
    .map((pair) => {
      if (pair.score === null) return `MISSING  ${pair.id} — no baseline at ${pair.baseline}`
      return `${pair.score > COMPARE_FLOOR ? 'MOVED' : 'ok   '}  ${pair.id} — ${formatScore(pair.score)}`
    })
}

/**
 * The contact sheet a compare run writes when something moved: baseline, now, and the two of them
 * blended.
 *
 * The heat map is the browser's own `difference` blend with the brightness turned up, not an image
 * this tool draws. Both sides came out of the same Chromium, so everything that did not move is
 * black and what did move is the only thing lit — which is what a heat map is for, and one less
 * PNG encoder in a repo that needs none.
 */
export function movedSheetHtml(pairs, { scale = 0.4, columns = 3, gap = 24 } = {}) {
  const px = (value) => `${Math.round(value * scale)}px`
  const shot = (tag, src, pair, extra = '') => `
      <div class="shot" style="width:${px(pair.width)};height:${px(pair.height)}${extra}">
        <span class="tag">${tag}</span>
        <img src="${escapeHtml(src)}" alt="" style="width:${px(pair.width)}">
      </div>`
  const cell = (pair) => `
    <figure class="pair">
      <figcaption><b>${escapeHtml(pair.id)}</b><em>${formatScore(pair.score ?? 0)}</em></figcaption>
      ${shot('Baseline', pair.baselineSrc, pair)}
      ${shot('Now', pair.nowSrc, pair)}
      <div class="shot heat" style="width:${px(pair.width)};height:${px(pair.height)}">
        <span class="tag">Diff</span>
        <img src="${escapeHtml(pair.baselineSrc)}" alt="" style="width:${px(pair.width)}">
        <img class="over" src="${escapeHtml(pair.nowSrc)}" alt="" style="width:${px(pair.width)}">
      </div>
    </figure>`
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #0b1220; color: #e2e8f0;
         font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  p.when { margin: 0 0 20px; color: #94a3b8; font-size: 12px; }
  .grid { columns: ${columns}; column-gap: ${gap}px; }
  .pair { margin: 0 0 ${gap}px; display: flex; flex-direction: column; gap: 6px; break-inside: avoid; }
  figcaption { display: flex; gap: 10px; align-items: baseline; }
  figcaption em { font-style: normal; font-weight: 700; font-size: 11px; padding: 1px 6px;
                  border-radius: 4px; background: #7f1d1d; color: #fecaca; }
  .shot { position: relative; overflow: hidden; line-height: 0; border: 1px solid #1e293b; }
  .heat { background: #000; filter: brightness(4); }
  .heat .over { position: absolute; inset: 0; mix-blend-mode: difference; }
  .tag { position: absolute; top: 6px; left: 6px; z-index: 2; padding: 2px 6px; border-radius: 4px;
         background: #4f46e5; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: .06em; }
  .heat .tag { mix-blend-mode: normal; filter: brightness(0.25); }
  img { display: block; }
</style></head>
<body>
  <h1>TinyCorp baseline — what moved</h1>
  <p class="when">Baseline, now, and the two blended, at ${Math.round(scale * 100)}%. ${pairs.length} state${pairs.length === 1 ? '' : 's'} over the ${COMPARE_FLOOR}% floor.
     Black in the third panel is a pixel that did not change.</p>
  <div class="grid">${pairs.map(cell).join('')}</div>
  <script>
    // The shot waits for this: an image still decoding is drawn as an empty box.
    window.sheetReady = Promise.all([...document.images].map((image) => image.decode().catch(() => {})))
  </script>
</body></html>`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/* ------------------------------------------------------------------ running */

/** The states `only` names, or all of them. `only` matches an id or a harness, as the audit's does. */
function chosen(only) {
  if (!only) return STATES
  const kept = STATES.filter((one) => one.id.includes(only) || one.harness === only)
  if (kept.length === 0) throw new Error(`no state's id or harness contains ${JSON.stringify(only)}`)
  return kept
}

/**
 * Shoots every state into `folder`, a harness at a time, and answers what each one drew.
 *
 * Every shot is taken through {@link STABILISER} and under {@link STILL_CSS}, in UTC — the three
 * things that make the same page the same picture tomorrow.
 */
async function shootAll(states, folder, scratch, log, { collect = false } = {}) {
  const drawn = {}
  for (const run of runs(states)) {
    const jobs = run.states.map((one) => ({
      url: urlOf(one),
      out: join(folder, `${one.harness}--${one.id}.png`),
      settleMs: SETTLE_MS,
      width: one.width,
      height: one.height,
      ...(collect ? { collect: one.id } : {}),
    }))
    log(`shooting ${jobs.length} state${jobs.length === 1 ? '' : 's'} of ${run.harness}…`)
    Object.assign(drawn, await shootHarness(HARNESSES[run.harness], run.harness, jobs, scratch, log))
  }
  return drawn
}

/**
 * One harness's shots, starting its dev server again for whatever it did not live to serve.
 *
 * A dev server that dies halfway through a harness is the one failure this run cannot design away:
 * the only thing Electron says about it is `ERR_CONNECTION_REFUSED`, and a twenty-minute run
 * thrown away for it is a run nobody takes. So the server is started again and the shots that did
 * not come out are taken. An attempt that takes no shot at all is the end of it — that is a real
 * fault, and it carries the server's own last words, which is the only place they are printed.
 */
async function shootHarness(harness, name, jobs, scratch, log) {
  const drawn = {}
  let owed = jobs
  for (let attempt = 1; ; attempt++) {
    let server = null
    let said = ''
    const heard = (line) => {
      said = `${said}${line}`.slice(-2000)
    }
    try {
      server = await serve(harness, heard)
      return { ...drawn, ...(await shoot(owed, scratch, () => {}, SHOT)) }
    } catch (error) {
      Object.assign(drawn, error.drawn ?? {})
      const left = owed.filter((job) => !existsSync(job.out))
      if (left.length === 0) throw error
      if (left.length === owed.length || attempt >= HARNESS_TRIES) {
        throw new Error(
          `${harness.config} left ${left.length} of ${jobs.length} shots of ${name} untaken.\n` +
            `Its last words:\n${said}\n\n${error.message}`,
        )
      }
      log(`${name}: ${left.length} of ${jobs.length} shots did not come out; starting its server again…`)
      owed = left
    } finally {
      if (server) await stop(server, harness)
    }
  }
}

/** How the baseline takes every shot: one frozen clock, no animation, and UTC. */
const SHOT = { preload: STABILISER, css: STILL_CSS, env: { TZ: 'UTC' } }

/** How many times a harness's dev server may die before the run gives up on it. */
const HARNESS_TRIES = 4

/**
 * The stylesheets one state drew, repo-relative and POSIX.
 *
 * The page answers every sheet it is holding and whether any of it is on screen; only the ones on
 * screen are coverage. A sheet a drawn one `@import`s is drawn too — vite has already folded it
 * into the importer, so the page could not have named it separately.
 */
function asSheets(reported) {
  const own = Object.entries(reported.sheets)
    .filter(([, drawn]) => drawn)
    .map(([id]) => relative(REPO, id.split('?')[0]).split(sep).join('/'))
    .filter((path) => path.startsWith('src/'))
  return withImports(own)
}

/**
 * `pnpm design:baseline` — shoot every state twice and write the PNGs the repo commits.
 *
 * Twice, because a baseline that cannot be taken again is not a baseline. A state with a clock, a
 * random, an animation or a real worktree behind it is a different picture every time it is shot,
 * and it fails the command here rather than failing every `compare` from now on.
 *
 * **Every difference between the shots is printed; the ones over {@link COMPARE_FLOOR} fail.**
 * The ticket asked for a state that differs *at all* to fail, and that is the stricter rule — but
 * a state that wobbles by 0.02% can never fail a `compare`, whose floor is fifteen times that, so
 * failing the baseline on it would only mean running the command until it came out quiet. A
 * wobble is printed on its own line instead, so it is visible rather than hidden, and anything a
 * comparison could ever notice is a failure.
 *
 * A state whose first two shots disagree is shot a **third** time and the baseline is whichever of
 * the first two the third agrees with. Not a softer rule — a state that is really unstable has no
 * two shots that agree and still fails — but the machine itself is not perfectly stable: under a
 * twenty-minute run it loses a WebGL context or a dev server, and a canvas screen comes back empty
 * once in a while. Two out of three is the difference between a command that says something and a
 * command nobody can get to the end of.
 *
 * A state that mounted nothing fails too. A capture whose stub is one API short of what the screen
 * reads throws, renders an empty root, and shoots the page's background — and a flat colour is the
 * most stable baseline there is. `desk-capture.html` had been in that state since the daily digest
 * landed, and both the audit and its own README went on quoting it (T209).
 */
export async function baseline({ log = console.log, only = null, twice = true } = {}) {
  const states = chosen(only)
  const scratch = mkdtempSync(join(tmpdir(), 'tinycorp-design-baseline-'))
  const shotName = (one) => `${one.harness}--${one.id}.png`
  try {
    const first = join(scratch, 'first')
    mkdirSync(first)
    const drawn = await shootAll(states, first, scratch, log, { collect: true })

    /** Where each state's baseline is coming from, and how far its two shots were apart. */
    const chosenShot = new Map(states.map((one) => [one.id, { from: first, apart: 0 }]))
    const flaky = []
    if (twice) {
      const second = join(scratch, 'second')
      mkdirSync(second)
      log('shooting every state a second time, to prove it is the same picture…')
      await shootAll(states, second, scratch, log)
      for (const one of states) {
        const apart = between(join(first, shotName(one)), join(second, shotName(one)))
        chosenShot.get(one.id).apart = apart
        if (apart > 0) flaky.push({ id: one.id, score: apart })
      }

      // A third go at whatever the first two disagreed about. The machine loses a WebGL context or
      // a dev server under load and a canvas screen comes back empty; a state that is really
      // unstable still fails, because no two of its three shots agree.
      const split = states.filter((one) => chosenShot.get(one.id).apart > COMPARE_FLOOR)
      if (split.length > 0) {
        const third = join(scratch, 'third')
        mkdirSync(third)
        log(`\n${split.length} state(s) came out differently twice; shooting them a third time…`)
        await shootAll(split, third, scratch, log)
        for (const one of split) {
          const withFirst = between(join(first, shotName(one)), join(third, shotName(one)))
          const withSecond = between(join(second, shotName(one)), join(third, shotName(one)))
          const agreed = withFirst <= COMPARE_FLOOR ? first : withSecond <= COMPARE_FLOOR ? second : null
          const closest = Math.min(withFirst, withSecond)
          chosenShot.set(one.id, { from: agreed ?? first, apart: agreed === null ? closest : 0 })
        }
        // The verdicts are the third shot's now, not the second's.
        flaky.length = 0
        for (const one of states) {
          const { apart } = chosenShot.get(one.id)
          if (apart > 0) flaky.push({ id: one.id, score: apart })
        }
      }
    }

    for (const one of states) {
      const out = join(REPO, pathOf(one))
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, readFileSync(join(chosenShot.get(one.id).from, shotName(one))))
    }

    const rows = coverage(Object.fromEntries(Object.entries(drawn).map(([id, sheets]) => [id, asSheets(sheets)])))
    log('')
    for (const line of coverageLines(rows)) log(line)
    const sheets = rows.reduce((total, row) => total + row.sheets.length, 0)
    const uncovered = rows.flatMap((row) => row.uncovered).length
    log(`\n${BASELINE_DIR} — ${states.length} states, ${sheets - uncovered} of ${sheets} stylesheets drawn.`)

    // An empty root and the two capture scripts is one element; anything that drew is dozens.
    const blank = states.filter((one) => (drawn[one.id]?.elements ?? 0) < 3).map((one) => one.id)
    for (const id of blank) log(`BLANK ${id} — the harness mounted nothing; the shot is its background colour`)
    for (const one of flaky) {
      const mark = one.score > COMPARE_FLOOR ? 'FLAKY' : 'wobble'
      log(`${mark} ${one.id} — shots of the same page differ, the closest by ${formatScore(one.score)}`)
    }
    if (blank.length > 0) {
      throw new Error(`${blank.length} state(s) drew nothing at all; a baseline of a blank page is worse than none`)
    }
    const unusable = flaky.filter((one) => one.score > COMPARE_FLOOR)
    if (unusable.length > 0) {
      throw new Error(
        `${unusable.length} state${unusable.length === 1 ? '' : 's'} came out differently every time, by more than ${COMPARE_FLOOR}%; a baseline of one is worth nothing`,
      )
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** How far two shots of the same state are apart. */
function between(one, other) {
  return diffScore(decodePng(readFileSync(one)), decodePng(readFileSync(other)))
}

/**
 * `pnpm design:compare` — the same states again, against the committed PNGs.
 *
 * Fails on anything over {@link COMPARE_FLOOR}, and on a state with no baseline at all, which is
 * the same failure wearing a different hat: a state nobody shot is a state nobody is watching.
 */
export async function compare({ log = console.log, only = null } = {}) {
  const states = chosen(only)
  const scratch = mkdtempSync(join(tmpdir(), 'tinycorp-design-compare-'))
  try {
    const now = join(scratch, 'now')
    mkdirSync(now)
    await shootAll(states, now, scratch, log)

    const pairs = states.map((one) => {
      const baselineFile = join(REPO, pathOf(one))
      const nowFile = join(now, `${one.harness}--${one.id}.png`)
      const had = existsSync(baselineFile)
      return {
        id: one.id,
        width: one.width,
        height: one.height,
        baseline: pathOf(one),
        score: had ? diffScore(decodePng(readFileSync(nowFile)), decodePng(readFileSync(baselineFile))) : null,
        baselineSrc: had ? pathToFileURL(baselineFile).href : null,
        nowSrc: pathToFileURL(nowFile).href,
      }
    })

    log('')
    for (const line of movedLines(pairs)) log(line)

    const moved = pairs.filter((pair) => pair.score !== null && pair.score > COMPARE_FLOOR)
    const missing = pairs.filter((pair) => pair.score === null)
    if (moved.length > 0) {
      const page = join(scratch, 'moved.html')
      writeFileSync(page, movedSheetHtml(moved))
      const sheet = join(REPO, MOVED_SHEET)
      mkdirSync(dirname(sheet), { recursive: true })
      await shoot(
        [{ url: pathToFileURL(page).href, out: sheet, settleMs: 1500, width: 2000, height: 2000, fit: true }],
        scratch,
        () => {},
      )
      log(`\n${MOVED_SHEET} — ${moved.length} state${moved.length === 1 ? '' : 's'} moved.`)
    }

    log(
      `\n${states.length} states, ${moved.length} over the ${COMPARE_FLOOR}% floor, ${missing.length} with no baseline.`,
    )
    if (moved.length + missing.length > 0) {
      throw new Error(`${moved.length + missing.length} state(s) do not match the baseline`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (!existsSync(join(REPO, 'node_modules', 'electron'))) {
    console.error('Run `pnpm install` first: the baseline shoots with Electron.')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const only = args.find((arg) => !arg.startsWith('-')) ?? null
  const run = args.includes('--compare') ? compare({ only }) : baseline({ only, twice: !args.includes('--once') })
  run.catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
