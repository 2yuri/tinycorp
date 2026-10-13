import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RtkHook } from '../../../shared/rtk'
import { HOOK_TOKEN_ENV, HOOK_TOKEN_HEADER } from '../provider-hooks'

/**
 * OpenCode's status hooks, which are a plugin rather than a hook file.
 *
 * Claude Code and Codex both hook an event by running a shell command with the event's JSON on
 * stdin, which is what `installHookFile` writes. OpenCode has no such thing: it loads JavaScript
 * modules out of `.opencode/plugins/` and hands each one its event stream
 * (https://opencode.ai/docs/plugins). So this file is OpenCode's answer to the same question —
 * the same POST, to the same receiver, with the same token, written as a plugin.
 *
 * Two things about OpenCode make the plugin do more than forward events:
 *
 * 1. **It names no conversation until the first prompt.** Started fresh or told to continue one,
 *    OpenCode's event stream says nothing at all at start-up, so there is no event to read the
 *    `ready` signal off. The plugin sends that signal itself, when it loads.
 * 2. **Nothing at start-up says whether a resume took.** `--session <id>` with an id OpenCode does
 *    not have starts a new conversation without a word. So before the plugin claims a resume it
 *    asks OpenCode whether that conversation is really there, through the SDK client it is handed.
 *    An unanswered question counts as *not* resumed: a fresh Session loses history, while a false
 *    confirmation has an Employee carry on about a ticket it has never seen.
 */

/** The env var the adapter names the conversation it asked OpenCode to continue in. */
export const RESUME_ENV = 'TINYCORP_OPENCODE_SESSION'

/** The plugin's own start-up signal: `ready`, which no OpenCode event carries. */
export const READY_EVENT = 'tinycorp.session.started'

/**
 * OpenCode's own events the plugin forwards. Everything else says nothing the engine reads.
 *
 * `permission.asked` and `permission.replied` are the Session stopping to ask the boss and the
 * boss having answered in the terminal (T165): OpenCode puts both on the same event stream the
 * plugin already listens to, so neither costs a second channel.
 */
export const FORWARDED_EVENTS = [
  'session.created',
  'session.status',
  'session.idle',
  'session.error',
  'permission.asked',
  'permission.replied',
] as const

/** Where the plugin goes: OpenCode loads every module under this folder of the Company folder. */
export const PLUGIN_PATH = join('.opencode', 'plugins', 'tinycorp-status.js')

/** How long the plugin waits for OpenCode to answer whether it has the conversation, per try. */
const LOOKUP_RETRY_MS = 400
/** How many times it asks before giving up and reporting the resume as unconfirmed. */
const LOOKUP_TRIES = 5
/** How long after loading the plugin announces itself, when no event has arrived to do it first. */
const ANNOUNCE_MS = 2000

/**
 * The plugin, as source. It carries the receiver's URL and nothing else: the Session it belongs to
 * is the token on the process, so one file serves every Employee in the folder (decision 48), and
 * without that token it stays silent, leaving the boss's own `opencode` runs alone.
 */
export function opencodePluginSource(hookUrl: string, rtk: RtkHook | null = null): string {
  return `// TinyCorp status hooks for OpenCode. Written by TinyCorp on every spawn; safe to delete.
// It names no Employee: which Session a hook belongs to is the token on the process.
const HOOK_URL = ${JSON.stringify(hookUrl)}
const TOKEN = process.env[${JSON.stringify(HOOK_TOKEN_ENV)}] || ""
const RESUMING = process.env[${JSON.stringify(RESUME_ENV)}] || ""
const FORWARD = new Set(${JSON.stringify(FORWARDED_EVENTS)})
const READY = ${JSON.stringify(READY_EVENT)}
const RTK = ${JSON.stringify(rtk?.path ?? '')}
const REWRITE_TOOLS = new Set(["bash", "shell"])

export const TinyCorpStatus = async ({ client, $ }) => {
  // Not started by TinyCorp: say nothing at all.
  if (!TOKEN) return {}

  const post = (body) =>
    fetch(HOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ${JSON.stringify(HOOK_TOKEN_HEADER)}: TOKEN },
      body: JSON.stringify(body),
    }).catch(() => {})

  // Whether OpenCode really has the conversation it was told to continue. It answers 404 for one
  // it does not, and refuses to answer at all until its server is up, which is why this retries.
  const continued = async () => {
    for (let tries = 0; tries < ${LOOKUP_TRIES}; tries += 1) {
      try {
        const found = await client.session.get({ path: { id: RESUMING } })
        return found && found.data && found.data.id === RESUMING
      } catch {
        await new Promise((done) => setTimeout(done, ${LOOKUP_RETRY_MS}))
      }
    }
    return false
  }

  let announced = false
  const announce = async () => {
    if (announced) return
    announced = true
    const resumed = RESUMING ? await continued() : false
    await post({
      hook_event_name: READY,
      type: READY,
      properties: { sessionID: resumed ? RESUMING : null, resumed },
    })
  }

  const timer = setTimeout(() => void announce(), ${ANNOUNCE_MS})
  if (timer && typeof timer.unref === "function") timer.unref()

  return {
    event: async ({ event }) => {
      await announce()
      if (!FORWARD.has(event.type)) return
      await post({ hook_event_name: event.type, ...event })
    },
    // RTK, for the Company that has command output compression on (T179). OpenCode has no hook file
    // to write \`rtk hook opencode\` into: a plugin is its whole extension surface, so the rewrite is
    // the same subprocess RTK's own plugin runs, in the plugin TinyCorp already writes.
    //
    // It fails open at every step — no RTK, another tool, a command that is not a string, a
    // non-zero exit, nothing on stdout, or the same string back — because a rewrite that went wrong
    // must cost the Employee its command output and never its command.
    "tool.execute.before": async (input, output) => {
      if (!RTK) return
      if (!REWRITE_TOOLS.has(String((input && input.tool) || "").toLowerCase())) return
      const args = output && output.args
      if (!args || typeof args !== "object") return
      const command = args.command
      if (typeof command !== "string" || !command) return
      try {
        const done = await $\`\${RTK} rewrite \${command}\`.quiet().nothrow()
        const rewritten = String(done.stdout || "").trim()
        if (rewritten && rewritten !== command) args.command = rewritten
      } catch {
        // rtk could not be run, or answered with nothing: the Employee runs what it asked for.
      }
    },
  }
}
`
}

/**
 * Writes the plugin into the Company folder, overwriting whatever was there: the source is ours
 * and carries no state, so a respawn never stacks anything up.
 */
export function installOpencodePlugin(cwd: string, hookUrl: string, rtk: RtkHook | null = null): void {
  const file = join(cwd, PLUGIN_PATH)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, opencodePluginSource(hookUrl, rtk))
}
