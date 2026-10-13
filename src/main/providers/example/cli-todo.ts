import type { ProviderSignIn } from '../provider-preflight'
import { type ExampleCli, todo } from './cli'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  FILL THIS IN. Everything else in this folder is finished.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Eleven spellings, one per question the conformance suite asks. Each `todo(…)` names the part of
 * the contract it belongs to; `docs/providers.md` has a section under that same name saying what
 * the part promises and what happens when an adapter lies about it.
 *
 * Replace one, run `pnpm test`, read the next failure. When the suite is green the Provider is
 * ready to send. The comment above each member shows what Claude Code and Codex answer, so you
 * have two real examples of every shape.
 */
export const EXAMPLE_CLI: ExampleCli = {
  /**
   * Claude Code: `['--append-system-prompt', text]`.
   * Codex: `['-c', `additional_developer_instructions="${text}"`]`.
   * Never a file in the Company folder — two Employees share it (decision 48).
   */
  instructionArgs(text) {
    void text
    return todo('instructions', 'the args that carry the Employee’s system prompt')
  },

  /**
   * Claude Code: `--session-id <id>` fresh, `--resume <id>` continuing — the app names the
   * conversation. Codex: `resume <id>` continuing, nothing at all fresh — Codex names its own.
   */
  sessionArgs(sessionId, resume) {
    void sessionId
    void resume
    return todo('resume', 'the args that start a conversation and the args that continue it')
  },

  /**
   * Claude Code: `['--mcp-config', configPath, '--strict-mcp-config']`.
   * Codex takes no file at all — it puts the URL on the command line and the token in the
   * environment, which is why the adapter hands you the path and lets you ignore it.
   */
  mcpArgs(configPath) {
    void configPath
    return todo('mcp', 'the args that load this Session’s MCP config')
  },

  /**
   * Claude Code: `['--model', model]`. Codex: `['-m', model, '-c', 'model_reasoning_effort="…"']`.
   * Return `[]` only when the Employee has no model — the adapter already handles that case.
   */
  modelArgs(model, effort) {
    void model
    void effort
    return todo('model', 'the args that pick a model and its effort')
  },

  /**
   * The CLI's own hook events, in file order. Claude Code: SessionStart, UserPromptSubmit,
   * PreToolUse, PostToolUse, Notification, Stop, SessionEnd. Codex has no idle notification.
   */
  get hookEvents(): readonly string[] {
    return todo('spawn', 'the hook events this CLI fires')
  },

  /**
   * The event that means the Session started is `ready`; anything that means it is working is
   * `busy`; the end of a turn is `idle`; everything else is null. An Employee whose idleness is
   * misread either never picks up its next ticket or is handed one mid-sentence.
   */
  signalOf(hook) {
    void hook
    return todo('signals', 'what this CLI’s hooks say about idleness')
  },

  /**
   * Which conversation a hook belongs to. Claude Code echoes back the id the app gave it, so this
   * is `hook.session_id`; Codex names its own threads, so it is `hook.threadId`. Two Employees
   * share a folder, so a hook the engine cannot attribute wakes the wrong one.
   */
  sessionIdOf(hook) {
    void hook
    return todo('signals', 'the conversation id inside this CLI’s hook payload')
  },

  /**
   * Whether a ready hook says the previous conversation was continued rather than restarted.
   * Claude Code: `hook.source === 'resume'`. Return true only when the payload really says so —
   * an Employee that is told it resumed when it did not carries on about a ticket it never saw.
   */
  confirmsResume(hook) {
    void hook
    return todo('resume', 'how a ready hook says the conversation was continued')
  },

  /**
   * Whether this terminal or hook output says the boss's subscription limit was hit. Match the
   * product's own words, and use `stripAnsi` from `provider-hooks.ts` first — a TUI paints escape
   * codes through its sentences.
   */
  limitHit(output) {
    void output
    return todo('limits', 'the words this CLI reports the subscription limit in')
  },

  /**
   * When that limit resets. Claude Code names a clock time (`try again at 3pm`), Codex a duration
   * (`try again in 2h 15m`), which is why `now` is passed in. Return null rather than guess: the
   * office draws a countdown from this, and an invented one is worse than none.
   */
  limitResetAt(output, now) {
    void output
    void now
    return todo('limits', 'when the limit this CLI reports resets')
  },

  /** The key that sends a typed prompt. Both shipped Providers use `'\r'`. */
  get submitKey(): string {
    return todo('prompt', 'the key that submits a typed prompt')
  },

  /**
   * How the app asks this CLI whether it can run an Employee at all, before the Launcher draws.
   *
   * Claude Code: `['auth', 'status']`, answered as JSON, `npm install -g @anthropic-ai/claude-code`
   * and `claude /login`. Codex: `['login', 'status']`, one sentence, `npm install -g @openai/codex`
   * and `codex login`. `verdict` says which of the three: signed in on the subscription the boss
   * pays for, signed in on a key that gets billed per token, or not signed in — and a timeout or an
   * answer you cannot read is never a login.
   *
   * `identity` is optional, and is who that same answer says is signed in: Your profile lists every
   * Provider on this Mac with its account and plan (T141). Leave it out when your CLI will not say
   * without spending anything — the card draws the state alone — and never invent one.
   */
  get signIn(): ProviderSignIn {
    return todo('preflight', 'how this CLI says whether it is signed in, and the commands that fix it')
  },
}
