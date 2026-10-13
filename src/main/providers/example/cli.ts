import type { Effort } from '../../../shared/domain/providers'
import type { HookPayload, SessionSignal } from '../provider-adapter'
import type { ProviderSignIn } from '../provider-preflight'

/**
 * The eleven questions a Provider adapter answers, as one interface.
 *
 * `adapter.ts` is finished code except for these: it assembles the command line, writes the hook
 * file, keeps the MCP config per Session and handles the kill. What it cannot know is how *your*
 * CLI spells each thing, so every spelling is one member here, named after the part of the
 * contract it belongs to (`docs/providers.md` has a section per part, and the conformance suite
 * fails with the same names).
 *
 * Fill them in, watch `pnpm test` go green, and then fold them back into the adapter the way
 * `providers/claude/adapter.ts` does — or leave them here, which reads perfectly well.
 */
export interface ExampleCli {
  /** `instructions`: the args that hand the CLI this Employee's system prompt. */
  instructionArgs(text: string): string[]
  /**
   * `resume`: the args that start conversation `sessionId`, or continue it when `resume` is true.
   * A Provider whose CLI names its own conversations answers {@link sessionIdOf} too.
   */
  sessionArgs(sessionId: string, resume: boolean): string[]
  /** `mcp`: the args that point the CLI at the MCP config the adapter wrote at `configPath`. */
  mcpArgs(configPath: string): string[]
  /** `model`: the args that pick a model and how hard it thinks. Empty for the CLI's own default. */
  modelArgs(model: string, effort: Effort | null): string[]
  /** `spawn`: the events the CLI's hook file must carry, in the order the file lists them. */
  hookEvents: readonly string[]
  /** `signals`: what one of the CLI's own hooks says about idleness, or null when it says nothing. */
  signalOf(hook: HookPayload): SessionSignal | null
  /** `signals`: the conversation a hook belongs to, or null when it names none. */
  sessionIdOf(hook: HookPayload): string | null
  /** `resume`: whether a ready hook says the previous conversation was continued, not restarted. */
  confirmsResume(hook: HookPayload): boolean
  /** `limits`: whether this output says the boss's subscription limit was hit. */
  limitHit(output: string): boolean
  /** `limits`: when the limit named in `output` resets, relative to `now`, or null. */
  limitResetAt(output: string, now: Date): Date | null
  /** `prompt`: the key that submits a prompt typed into the Session, usually `'\r'`. */
  submitKey: string
  /**
   * `preflight`: how this CLI is asked whether it is installed and signed in, and this product's
   * own commands for fixing it when it is not. The card the boss reads before the app draws is
   * built out of it (T135), and its optional `identity` is the account Your profile lists this
   * Provider under (T141).
   */
  signIn: ProviderSignIn
}

/** A hole that has not been filled in yet. The message is what a stranger's first test run says. */
export class UnfilledHole extends Error {
  constructor(
    readonly contract: string,
    what: string,
  ) {
    super(
      `${contract}: ${what} is still TODO in providers/example/cli-todo.ts. ` +
        `Fill it in — docs/providers.md#${contract} says what this part of the contract promises.`,
    )
    this.name = 'UnfilledHole'
  }
}

/** Marks a hole. Returns `never`, so an unfilled member still satisfies its own type. */
export function todo(contract: string, what: string): never {
  throw new UnfilledHole(contract, what)
}
