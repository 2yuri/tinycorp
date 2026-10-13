import { type SandboxPlan, sandboxCommand } from '../../shared/sandbox'
import type { PtySession, PtySpawnOptions, SpawnPty } from './pty'

/**
 * Starting a Provider's CLI inside ai-jail (T260).
 *
 * No adapter knows about any of this, and none of them should: an adapter's job is its own
 * product's flags, and "is this Session jailed" is not a fact about Claude Code or Codex. So the
 * jail is a layer *under* every adapter, exactly where WSL is — it wraps the one seam an adapter
 * already takes, `spawnPty` — and a Provider added tomorrow is jailed without a line about it.
 *
 * It composes **outside** {@link wslSpawnPty}, which is the whole reason the wrap is here rather
 * than in each adapter. Wrapped this way round, the line that reaches a distro is
 *
 *     wsl.exe -d Arch --cd … -e sh -lc 'exec "$0" "$@"' ai-jail --agent-state … -- claude --resume …
 *
 * so ai-jail runs *inside* the distro, which is the only place it runs on a Windows at all — and
 * every `--ro-map` and `--rw-map` is translated on the way in by the same rule every other
 * argument is, because `wslCommand` translates the whole argument list.
 *
 * Hooks, MCP stdio servers and RTK need nothing: they are children of the CLI, so they are already
 * in the jail. TinyCorp's own processes — the git the runner shells out to, and the rest — are not
 * children of it and stay outside.
 */

/**
 * The plan for the Session about to start, or null to start it exactly as before.
 *
 * It is a function and not a value because it is read **at every spawn**: the Company's switch may
 * have been flipped since the adapter was built, and *off means off at the next start* is kept by
 * asking again rather than by remembering to rebuild something.
 */
export type SandboxPlanFor = (options: PtySpawnOptions) => SandboxPlan | null

/**
 * The same {@link SpawnPty} the adapter would have used, starting the CLI inside ai-jail.
 *
 * A null plan hands the inner seam the very same arguments it would have had, byte for byte, which
 * is what makes an add-on that is off cost nothing and change nothing.
 */
export function sandboxSpawnPty(inner: SpawnPty, planFor: SandboxPlanFor): SpawnPty {
  return (file: string, args: string[], options: PtySpawnOptions): PtySession => {
    const plan = planFor(options)
    if (!plan) return inner(file, args, options)
    const [jail, ...rest] = sandboxCommand(plan, file, args)
    return inner(jail!, rest, options)
  }
}

/**
 * The names of the variables **the app itself** put on this Session, which are the ones that have
 * to cross into the jail.
 *
 * ai-jail's default is a minimal environment allowlist, so without this a Session would start
 * without its hook token, without the folder its Provider reads its config from and without
 * `RTK_DB_PATH` — deaf to TinyCorp and silently uncompressed. Only the app's own: a variable that
 * came out of `process.env` unchanged is the machine's, and the jail has its own answer for it.
 *
 * It is the same comparison `wslEnv` makes for the same reason, and names only — `--env NAME`
 * carries the value that is already on the process, so no secret is written into an argument list.
 */
export function addedEnv(env: Record<string, string>, host: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => env[name] !== host[name])
    .sort()
}
