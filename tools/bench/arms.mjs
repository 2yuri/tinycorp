import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The arms of `pnpm bench:tokens` (T190): what each one adds to a Claude Code session, and what it
 * therefore has to be allowed to show up in that session's transcript.
 *
 * An arm is two things and nothing else — text appended to the system prompt, and hooks written
 * into a settings file the run is started with. Everything else about a cell is identical across
 * arms, because the number the report prints is a difference and a difference is only real when
 * one thing differs.
 *
 * `declares` is the other half of that promise. It is the list of hook names this arm is entitled
 * to, and `isolationBreaches` in `session.mjs` fails the cell when the transcript shows any other
 * one. That check exists because ponytail's first agentic benchmark measured nothing: its own
 * plugin's `SessionStart` hook fired on every arm, so the baseline was secretly running the thing
 * under test. A benchmark that cannot see that happening is a benchmark that lies.
 *
 * `modes` is T197: an arm belongs to the shape of run it means something in. `baseline` and `rtk`
 * are both a cold one-ticket session and a long one; the two voice arms of the DM round only mean
 * anything where there is a colleague to write to, so they are `duo` and nowhere else. T261 adds
 * the pair on the other side of that line: `boss-plain` and `caveman` only mean anything where
 * there is a boss reading, so they are `boss` and nowhere else.
 */

const HERE = import.meta.dirname

/** RTK's own name for Claude Code in `rtk hook <agent>`, the same one the app's adapter writes. */
export const RTK_AGENT = 'claude'

/** The hook a Claude Code session runs RTK's rewrite under, as the transcript names it. */
export const RTK_HOOK_NAME = 'PreToolUse:Bash'

/**
 * What every arm is told, word for word, on top of its own text.
 *
 * It is here rather than in the tasks because it is about the bench, not about the ticket: the
 * workspace has its dependencies already installed and no database, and a session that spends four
 * minutes discovering that is measuring npm, not the arm. ponytail's benchmark found the same
 * thing the expensive way — agents hitting a login wall and retrying, which inflates every number
 * with flailing.
 *
 * `vitest run` is spelled out because bare `npx vitest` watches and never exits, and a cell that
 * hangs to its timeout is a cell with no measurement in it.
 */
export const SHARED_RULES = [
  'You are working in a checkout of this repository. Treat the request as a ticket: implement it.',
  '',
  'About this workspace, which is the same for every run:',
  '',
  '- Dependencies are already installed in `node_modules`. Do not install, add, upgrade or remove a',
  '  package, and do not edit `package.json` or the lockfile.',
  '- There is no server, no database and no browser. Do not start a dev server and do not try to',
  '  verify the feature by running the app.',
  '- The test suite is `npx vitest run` (never bare `npx vitest`, which watches and never exits).',
  '  Running it is optional; you may also read files and run read-only shell commands.',
  '- Write the code, and tests if you normally would for a change like this, then stop.',
].join('\n')

/** One arm's text file, read at the moment it is needed rather than at import. */
function fromFile(...where) {
  return () => readFileSync(join(HERE, ...where), 'utf8').trim()
}

/**
 * One arm. `text` is always a function and never a string, so every reader is one call and no
 * caller has to ask which of the two it was handed.
 *
 * `builtOn` names the arm this one is the same text plus an addition — `dm-terse` is `dm-plain`
 * and the Between Employees section. Without it the isolation check would read the arm it is built
 * on as a crossed wire, and with it the pair still differs by exactly one thing, which is the only
 * reason either number means anything.
 *
 * `mcp` is the MCP servers this arm is entitled to. Every other arm gets none, and a session that
 * reached one it did not declare is a contaminated cell.
 *
 * `voice` is which of the app's two colleague voices this arm is, for the wake prompts a `duo` cell
 * writes: the engine names the voice in every wake (T180), so it is read off the arm and never
 * guessed from its id.
 */
function arm({ id, what, text = () => null, rtk = false, modes = ['solo'], builtOn = null, mcp = [], voice = null }) {
  return { id, what, text, rtk, modes, builtOn, mcp, voice, declares: rtk ? [RTK_HOOK_NAME] : [] }
}

/** What this arm prepends, or null when it prepends nothing. */
export function armText(one) {
  return one.text()
}

/**
 * The name the stand-in chat server is registered under in a `duo` cell, which is the name the app
 * registers its own Company server under — so the tools an Employee calls are spelled
 * `mcp__company__chat_post` in the bench exactly as they are in TinyCorp.
 */
export const DM_SERVER = 'company'

const plainVoice = fromFile('arms', 'plain-voice.md')
const terseVoice = fromFile('arms', 'terse-voice.md')
const cavemanVoice = fromFile('arms', 'caveman.md')

/**
 * The arms, in the order the report prints them. `baseline` is first because every other
 * number is a percentage of it.
 *
 * `terse-voice` carries only the Between Employees section, which is what the Company toggle adds
 * (T180) — the humanizer above it is on whatever the toggle says, so it is not what is being
 * measured here. That the section is about DMs and a bench session writes no DM is the point: this
 * arm prices *carrying* the rule on a coding task, which is the cost the toggle really imposes.
 *
 * `dm-plain` and `dm-terse` are the other half of that question, and the one T190 could not ask
 * (T197). Both carry How you write, which the app sends whatever the toggle says; `dm-terse` adds
 * the same Between Employees section on top, which is exactly what the toggle does. They are only
 * ever run in `duo` mode, where there is a colleague on the other end of a DM to pay for.
 *
 * `boss-plain` and `caveman` are the same pair pointed the other way (T261). Both carry How you
 * write; `caveman` adds How you answer the boss on top, which is exactly what that toggle does.
 * They are only ever run in `boss` mode, where the messages are the ones this add-on governs \u2014
 * every message of a `duo` cell is a colleague message, which is the one place it is forbidden to
 * reach, so a number measured there would be a number about nothing.
 */
export const ARMS = [
  arm({
    id: 'baseline',
    what: 'Claude Code as it comes, with no arm text and no hooks.',
    modes: ['solo', 'long'],
  }),
  arm({
    id: 'rtk',
    what: "RTK's PreToolUse rewrite, hooked per run through --settings.",
    rtk: true,
    modes: ['solo', 'long'],
  }),
  arm({
    id: 'terse-voice',
    what: "TinyCorp's Between Employees section (T180), prepended to the system prompt.",
    text: fromFile('arms', 'terse-voice.md'),
  }),
  arm({
    id: 'ponytail',
    what: "ponytail's SKILL.md (MIT, vendored), prepended to the system prompt.",
    text: fromFile('vendor', 'ponytail', 'SKILL.md'),
  }),
  arm({
    id: 'rtk+ponytail',
    what: 'Both: the RTK hook and the ponytail text.',
    text: fromFile('vendor', 'ponytail', 'SKILL.md'),
    rtk: true,
  }),
  arm({
    id: 'dm-plain',
    what: 'Two Employees, and the app\u2019s How you write section alone: plain sentences everywhere.',
    text: fromFile('arms', 'plain-voice.md'),
    modes: ['duo'],
    voice: 'plain',
    mcp: [DM_SERVER],
  }),
  arm({
    id: 'dm-terse',
    what: 'The same two Employees with Between Employees added: the voice the app ships on.',
    text: () => `${plainVoice()}\n\n${terseVoice()}`,
    modes: ['duo'],
    builtOn: 'dm-plain',
    voice: 'terse',
    mcp: [DM_SERVER],
  }),
  arm({
    id: 'boss-plain',
    what: 'One Employee reporting to the boss, with How you write alone: the app as it ships today.',
    text: fromFile('arms', 'plain-voice.md'),
    modes: ['boss'],
    voice: 'plain',
    mcp: [DM_SERVER],
  }),
  arm({
    id: 'caveman',
    what: 'The same Employee with How you answer the boss added at Full: what the add-on does (T261).',
    text: () => `${plainVoice()}\n\n${cavemanVoice()}`,
    modes: ['boss'],
    builtOn: 'boss-plain',
    voice: 'plain',
    mcp: [DM_SERVER],
  }),
]

/** The arms of one mode, in report order. */
export function armsOfMode(mode) {
  return ARMS.filter((one) => one.modes.includes(mode))
}

/** The arm called `id`, or null. */
export function armOf(id) {
  return ARMS.find((one) => one.id === id) ?? null
}

/** Every arm's id, in report order. */
export function armIds() {
  return ARMS.map((one) => one.id)
}

/**
 * What this arm appends to the system prompt: its own text, then the shared rules, always in that
 * order and always with the shared rules present. An arm with no text of its own still gets them,
 * so `baseline` and `ponytail` differ by exactly the ponytail text.
 */
export function armSystemPrompt(one) {
  const text = armText(one)
  return text ? `${text}\n\n${SHARED_RULES}` : SHARED_RULES
}

/**
 * The settings file this arm's run is started with, or null when it needs none.
 *
 * It is the same entry TinyCorp's Claude Code adapter writes for a hooked Session — `PreToolUse`,
 * matched to `Bash`, running `rtk hook claude` — but it goes through `--settings` rather than the
 * workspace's own `.claude/settings.json`, so the file the agent is measured on never grows a file
 * the agent did not write. `--setting-sources project,local` leaves `--settings` alone; it is
 * additional, not a source.
 */
export function armSettings(one, { rtkPath }) {
  if (!one.rtk) return null
  if (!rtkPath) throw new Error(`arm ${one.id} needs rtk, which was not found on PATH`)
  return {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: rtkHookCommand(rtkPath) }] }],
    },
  }
}

/**
 * `rtk hook claude`, quoted for the shell Claude Code runs a hook command in. Quoted every time
 * because RTK under `C:\Program Files` unquoted runs a program called `C:\Program`.
 */
export function rtkHookCommand(path, platform = process.platform) {
  if (platform === 'win32') return `& '${path.replace(/'/g, "''")}' hook ${RTK_AGENT}`
  return `'${path.replace(/'/g, `'\\''`)}' hook ${RTK_AGENT}`
}
