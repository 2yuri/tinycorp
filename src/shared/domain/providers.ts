/**
 * Every CLI product an Employee's Session can run on, in one file.
 *
 * Adding a Provider is a pull request, and `docs/providers.md` is the guide. It is one folder and
 * two lines, and `pnpm provider:new <id>` writes all three:
 *
 * 1. an entry in {@link PROVIDER_CATALOGUE} below — its name, its command, its models, its mark;
 * 2. a folder under `src/main/engine/providers/<id>/` whose adapter passes the conformance suite
 *    in `src/main/engine/provider-conformance.ts`, run from its own test file;
 * 3. one line in `src/main/engine/provider-registry.ts`, where the adapter is built.
 *
 * It is two lines rather than one because the catalogue and the adapter live on opposite sides of
 * a process boundary: the renderer draws the hiring form, the drawer and the Usage page from this
 * file and cannot load an adapter, which is node code. The registry line only compiles once the
 * entry exists, and `createProviderAdapters` refuses a set that is missing one.
 *
 * Nothing else in the app names a Provider — a test asserts it (`no-provider-names.test.ts`). A
 * Provider that is not here cannot be hired, and one that is here but fails the suite does not
 * ship.
 */

import { type ProviderPreflight, preflightBlocks } from '../providers/preflight'

/**
 * How hard a model thinks per turn, in the word its own CLI takes.
 *
 * Not a union across products. The value is passed through verbatim — `--effort high` for one,
 * `model_reasoning_effort="ultra"` for another — so a level one CLI accepts is not a level another
 * does, and `fast` / `balanced` / `deep` were never anything a CLI could see. Which words a model
 * takes is the set of {@link ModelOption}s that share its `model`.
 */
export type Effort = string

/**
 * The mark the Usage popover draws beside a Provider's name (design frame `TMviL`). A name, not a
 * component: the renderer maps it, so the catalogue stays free of React. A Provider that names a
 * mark nobody draws gets the terminal, so a new one renders without an edit in the renderer.
 */
export type ProviderIcon = 'sparkles' | 'braces' | 'terminal'

/**
 * The product's own logo, as the file name — without `.svg` — of a logo vendored into
 * `src/renderer/src/ui/logos/`.
 *
 * It is a name here for the same reason {@link ProviderIcon} is: the catalogue stays free of
 * React, and of the renderer's folder layout. A Provider that names none draws its {@link icon}
 * instead, which is why the field is optional: adding a Provider is still one folder and two
 * lines, and a logo is a fourth thing nobody has to have.
 *
 * `docs/brand-logos.md` is where a logo comes from, what may be done to it, and how to add one.
 */
export type ProviderLogo = 'claudecode-color' | 'codex-color' | 'opencode'

/**
 * One entry of a provider's catalogue: a model and, when it takes one, an effort level.
 *
 * Storage is one entry per `(model, effort)` pair, which is not how anyone chooses — frame `CLSj9`
 * presents the two axes over it, MODEL and EFFORT. So **a model's levels are the entries that
 * share its {@link model}, in catalogue order**, and the EFFORT control offers exactly those and
 * never one it does not find.
 *
 * The levels belong to the model rather than to the product. Within one product they differ: a CLI
 * can accept `xhigh` and deny it for some of its own models, and another can take a level for one
 * model that it has no notion of for the next. An entry here is the claim that this model takes
 * this level — so a level nobody has confirmed against the binary simply has no entry, because a
 * level a CLI rejects is not an error the boss ever sees: it is silently downgraded to the
 * product's default, and an Employee quietly thinks less hard than the catalogue promised.
 */
export interface ModelOption {
  /** What `Employee.model` stores. Unique across every Provider. */
  id: string
  /** The model's own name, e.g. "Opus 5". Shared by every entry of the same {@link model}. */
  label: string
  /** The id the CLI takes with its model flag. */
  model: string
  /** The word this model's CLI is handed for it, or null when no level is known for the model. */
  effort: Effort | null
}

/** How the boss signs a Provider in. TinyCorp never holds the credential; the CLI does. */
export interface ProviderAuth {
  /** The docs table's column, e.g. "Claude subscription, via `claude login`". */
  how: string
  /** The command that signs the boss out, which Your profile quotes. */
  signOut: string
  /** How the sign-in modal runs the product's own login, and the steps it walks the boss through (T263). */
  signIn: ProviderSignInFlow
}

/**
 * The product's own sign-in, as TinyCorp runs it in a terminal inside the app (T263, frames
 * `Tmldc` and `iA8Wm`).
 *
 * Plain data, because the modal draws the steps and the renderer may name no product: each
 * Provider's words are here, beside its command, and a new Provider brings its own.
 */
export interface ProviderSignInFlow {
  /** What follows the command, e.g. `['/login']`. TinyCorp runs it; the product asks for the credential. */
  args: readonly string[]
  /**
   * What a config folder that has never been used runs instead, where the product walks a fresh
   * folder through its own first run before it will sign in. Left out where `args` does both.
   */
  firstRunArgs?: readonly string[]
  /** The steps beside the terminal, in order. The last is the one TinyCorp itself completes. */
  steps: readonly SignInStep[]
  /** The sentence under the steps, for a product that asks whether to trust the folder it runs in. */
  trustNote?: string
}

/** One step of a sign-in, as the modal lists it. */
export interface SignInStep {
  title: string
  detail?: string
  /**
   * Words the product prints when this step begins, matched without case against what the terminal
   * has shown. A step without them is reached when the one before it is done.
   */
  seen?: string
}

export interface ProviderEntry {
  /** What `Employee.provider` stores, and the key every other module reads by. */
  id: string
  /** The product's full name: the drawer's meta strip and the hiring form. */
  name: string
  /** The short name the Usage popover's rows carry (design frame `z2AWfM`). */
  shortName: string
  /** The command the product is installed as. An Employee whose command is missing is not spawned. */
  command: string
  /** The models it offers (decision 31). An Employee without one runs on the product's default. */
  models: readonly ModelOption[]
  /**
   * Whether TinyCorp can read the boss's usage for this Provider without spending the
   * subscription. When false the Usage page says so plainly rather than drawing a zero.
   */
  readsUsage: boolean
  /**
   * Where this product looks for skill folders inside a worktree, e.g. `.claude/skills` (T137),
   * or null when it reads none. A Provider that reads none says so here, and the Employee's
   * drawer says `<Provider> — no skills` rather than the app pretending the grant did something.
   * Its adapter implements `installSkills` exactly when this names a folder.
   */
  skillsFolder: string | null
  /**
   * How a message invokes one of the skills an Employee holds (T264), confirmed against the CLI's
   * own files and never by running a Session:
   *
   * - `slash`: the prompt opens with `/<skill-name>`, and the product runs the skill with what
   *   follows as its arguments;
   * - `dollar`: `$<skill-name>` in the prompt is the product's own mention of a skill.
   *
   * Left out, the prompt opens with one plain sentence asking for the skill by name
   * ({@link invokeSkill}), so adding a Provider is still one folder and two lines.
   */
  invokesSkill?: 'slash' | 'dollar'
  /**
   * Whether this CLI runs its shell tools through `bash` — which, on native Windows, means Git for
   * Windows' `bash.exe` and nothing else (T249). A machine whose team runs on Windows without it
   * has Sessions that start and then cannot run a command, so the first launch says so.
   *
   * Left out where it is false, so adding a Provider is still one folder and two lines. It is a
   * fact about the product, which is why it is here rather than written into a screen: the moment
   * a screen said "Claude Code needs Git Bash", the next Provider that needs it would not be named
   * and the one that stopped needing it would be.
   */
  needsGitBash?: boolean
  /** The mark the Usage popover draws beside its name, for a Provider with no logo. */
  icon: ProviderIcon
  /** The product's own logo, drawn in place of {@link icon}. Left out where this repo ships none. */
  logo?: ProviderLogo
  /** How the boss signs it in, and out. */
  auth: ProviderAuth
  /** Who answers for this adapter when it breaks, as `docs/providers.md`'s table names them. */
  maintainer: string
}

export const PROVIDER_CATALOGUE = [
  {
    id: 'claude',
    name: 'Claude Code',
    shortName: 'Claude',
    command: 'claude',
    readsUsage: true,
    skillsFolder: '.claude/skills',
    // Claude Code 2.1.283 lists every user-invocable skill as a slash command, and a skill whose
    // body holds no `$ARGUMENTS` is handed what follows the name as an `ARGUMENTS:` line.
    invokesSkill: 'slash',
    icon: 'sparkles',
    logo: 'claudecode-color',
    // Its Bash tool is `bash -c`, and on native Windows the only `bash` a dev machine has is Git's.
    needsGitBash: true,
    auth: {
      how: 'Claude subscription, through `claude login`',
      signOut: 'claude logout',
      signIn: {
        args: ['/login'],
        // A config folder nobody has used starts at the theme, and `claude` itself walks it from
        // there through the login — which `/login` in a folder with no onboarding does not.
        firstRunArgs: [],
        steps: [
          { title: 'Pick a theme — any' },
          {
            title: 'Choose Claude account with subscription',
            detail: 'Your Pro, Max or Team plan. Never an API key.',
            seen: 'login method',
          },
          {
            title: 'Approve it in your browser',
            detail: 'It opens by itself. If it asks for a code, paste it into the terminal.',
            seen: 'browser',
          },
          { title: "That's it", detail: 'TinyCorp notices the sign-in and closes this.' },
        ],
        trustNote:
          'If it asks whether to trust this folder, say yes: it is an empty folder TinyCorp made for signing in.',
      },
    },
    maintainer: 'TinyCorp',
    models: [
      // Opus 5.5: `claude-opus-5-5` in Claude Code 2.1.280's model table, with effort, xhigh and max.
      { id: 'opus-5-5-balanced', label: 'Opus 5.5', model: 'claude-opus-5-5', effort: 'medium' },
      { id: 'opus-5-5-deep', label: 'Opus 5.5', model: 'claude-opus-5-5', effort: 'high' },
      { id: 'opus-5-5-xhigh', label: 'Opus 5.5', model: 'claude-opus-5-5', effort: 'xhigh' },
      { id: 'opus-5-balanced', label: 'Opus 5', model: 'claude-opus-5', effort: 'medium' },
      { id: 'opus-5-deep', label: 'Opus 5', model: 'claude-opus-5', effort: 'high' },
      { id: 'opus-5-xhigh', label: 'Opus 5', model: 'claude-opus-5', effort: 'xhigh' },
      { id: 'fable-5-1-deep', label: 'Fable 5.1', model: 'claude-fable-5-1', effort: 'high' },
      { id: 'fable-5-1-xhigh', label: 'Fable 5.1', model: 'claude-fable-5-1', effort: 'xhigh' },
      { id: 'sonnet-5-balanced', label: 'Sonnet 5', model: 'claude-sonnet-5', effort: 'medium' },
      { id: 'sonnet-5-fast', label: 'Sonnet 5', model: 'claude-sonnet-5', effort: 'low' },
      { id: 'sonnet-5-xhigh', label: 'Sonnet 5', model: 'claude-sonnet-5', effort: 'xhigh' },
      { id: 'haiku-4-5-fast', label: 'Haiku 4.5', model: 'claude-haiku-4-5-20251001', effort: null },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    shortName: 'Codex',
    command: 'codex',
    // The ChatGPT login `codex login` wrote answers with the same 5-hour and weekly percentages
    // the CLI draws itself (T220). There is no subcommand that prints them, so the read is the
    // call the CLI makes — with that login, in the main process, and never an API key.
    readsUsage: true,
    // Confirmed against the installed CLI rather than guessed (T253): Codex 0.155.1 renders its
    // own prompt with `codex debug prompt-input`, and the skill roots it prints for a working
    // directory are that directory's `.codex/skills` and `.agents/skills`, beside
    // `$CODEX_HOME/skills`. The first is the one TinyCorp fills.
    skillsFolder: '.codex/skills',
    // Codex 0.155.1 has no slash command per skill: its own instructions say the user names a
    // skill "with $SkillName", and its input carries a `skill` mention element for it.
    invokesSkill: 'dollar',
    icon: 'braces',
    logo: 'codex-color',
    auth: {
      how: 'ChatGPT subscription, through `codex login`',
      signOut: 'codex logout',
      signIn: {
        args: ['login'],
        steps: [
          {
            title: 'Sign in with ChatGPT in your browser',
            detail: 'It opens by itself. If it does not, open the link the terminal prints.',
          },
          { title: "That's it", detail: 'TinyCorp notices the sign-in and closes this.' },
        ],
      },
    },
    maintainer: 'TinyCorp',
    models: [
      { id: 'gpt-6-astra-balanced', label: 'GPT-6-Astra', model: 'gpt-6-astra', effort: 'medium' },
      { id: 'gpt-6-astra-deep', label: 'GPT-6-Astra', model: 'gpt-6-astra', effort: 'high' },
      { id: 'gpt-6-astra-xhigh', label: 'GPT-6-Astra', model: 'gpt-6-astra', effort: 'xhigh' },
      // GPT-6-Sol and GPT-6-Luna: listed with these levels in Codex 0.155.1's own model cache.
      { id: 'gpt-6-sol-balanced', label: 'GPT-6-Sol', model: 'gpt-6-sol', effort: 'medium' },
      { id: 'gpt-6-sol-deep', label: 'GPT-6-Sol', model: 'gpt-6-sol', effort: 'high' },
      { id: 'gpt-6-sol-xhigh', label: 'GPT-6-Sol', model: 'gpt-6-sol', effort: 'xhigh' },
      { id: 'gpt-6-luna-fast', label: 'GPT-6-Luna', model: 'gpt-6-luna', effort: 'low' },
      { id: 'gpt-6-luna-xhigh', label: 'GPT-6-Luna', model: 'gpt-6-luna', effort: 'xhigh' },
      { id: 'gpt-5-6-sol-balanced', label: 'GPT-5.6-Sol', model: 'gpt-5.6-sol', effort: 'medium' },
      { id: 'gpt-5-6-sol-fast', label: 'GPT-5.6-Sol', model: 'gpt-5.6-sol', effort: 'low' },
      { id: 'gpt-5-6-sol-xhigh', label: 'GPT-5.6-Sol', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'gpt-5-6-luna-fast', label: 'GPT-5.6-Luna', model: 'gpt-5.6-luna', effort: 'low' },
      { id: 'gpt-5-6-luna-xhigh', label: 'GPT-5.6-Luna', model: 'gpt-5.6-luna', effort: 'xhigh' },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    shortName: 'OpenCode',
    command: 'opencode',
    // OpenCode holds no subscription of its own: it runs on whichever account the boss signed in
    // with, and reports that account's limit in the Session. There is nothing local to read.
    readsUsage: false,
    // Claimed rather than guessed, the way the effort levels below are, and confirmed in T253:
    // `opencode debug skill` in a working directory lists what it really loaded, and a folder put
    // at `.opencode/skills/<name>/SKILL.md` is in that list. OpenCode 1.18.32 reads both spellings
    // of the folder — `skill` and `skills`, as it does for `agent` and `command` — and this is the
    // one TinyCorp fills.
    skillsFolder: '.opencode/skills',
    // OpenCode 1.18.32 registers every skill it loads as a command (`source: "skill"`), and a
    // template without `$ARGUMENTS` has the words after the name appended to it.
    invokesSkill: 'slash',
    icon: 'terminal',
    logo: 'opencode',
    auth: {
      how: 'Whichever account the boss already has, through `opencode auth login`',
      signOut: 'opencode auth logout',
      signIn: {
        args: ['auth', 'login'],
        steps: [
          { title: 'Pick the provider you pay for', detail: 'An account you already have, such as Anthropic.' },
          {
            title: 'Choose its subscription login',
            detail: 'Your plan, never an API key.',
            seen: 'login method',
          },
          {
            title: 'Approve it in your browser',
            detail: 'If it asks for a code, paste it into the terminal.',
            seen: 'http',
          },
          { title: "That's it", detail: 'TinyCorp notices when the terminal is done.' },
        ],
      },
    },
    maintainer: 'TinyCorp',
    // OpenCode fronts several products at once and spells a model `provider/model`, so which one
    // an Employee runs is the Employee's setting rather than a default of the Provider's. The
    // models an OpenCode really offers are the ones the boss's own logins carry — `opencode
    // models` lists them — so these are the two accounts most bosses already have. The label keeps
    // the account in it, because `Opus 5` on two logins is two different bills.
    //
    // The levels are OpenCode's `variant`, read off `opencode models <provider> --verbose` on
    // 1.18.31 (T140) and handed to it as `agent.<name>.variant` — `--variant` itself is on
    // `opencode run` alone, and this adapter spawns the TUI. A variant is per model, not per
    // product: `github-copilot/claude-opus-5` takes `max` and `github-copilot/gpt-5.5` does not.
    //
    // Three things observed and deliberately left out, so the next reader does not take them for
    // an oversight:
    //
    // - `anthropic/*` carries no level because it has none. The models.dev cache OpenCode reads
    //   lists no `variants` at all under the `anthropic` provider, so there is nothing to claim
    //   and those Employees run at whatever OpenCode sends by default.
    // - `github-copilot/gpt-5.5` also accepts `none`. It is a switch that turns reasoning off
    //   rather than a level to run at, and the first entry of a model is what an Employee falls
    //   to when they move onto it (T139) — so offering it would hand somebody zero reasoning by
    //   accident. `low` is this model's floor here.
    // - `github-copilot/claude-haiku-4.5` shows `high` and `max`, and they are not effort: its
    //   cache entry has no effort option, and those two ids come from OpenCode's `budget_tokens`
    //   branch, which spells thinking budgets with the same words. That model has no entry below.
    models: [
      // No `variants` in the cache OpenCode reads, so no level is claimed for either.
      { id: 'opencode-anthropic-opus-5', label: 'Opus 5 · Anthropic', model: 'anthropic/claude-opus-5', effort: null },
      {
        id: 'opencode-anthropic-sonnet-5',
        label: 'Sonnet 5 · Anthropic',
        model: 'anthropic/claude-sonnet-5',
        effort: null,
      },
      // Observed: low, medium, high, xhigh, max — each an `effort` on an adaptive thinking block.
      {
        id: 'opencode-copilot-opus-5-low',
        label: 'Opus 5 · GitHub Copilot',
        model: 'github-copilot/claude-opus-5',
        effort: 'low',
      },
      {
        id: 'opencode-copilot-opus-5',
        label: 'Opus 5 · GitHub Copilot',
        model: 'github-copilot/claude-opus-5',
        effort: 'medium',
      },
      {
        id: 'opencode-copilot-opus-5-high',
        label: 'Opus 5 · GitHub Copilot',
        model: 'github-copilot/claude-opus-5',
        effort: 'high',
      },
      {
        id: 'opencode-copilot-opus-5-xhigh',
        label: 'Opus 5 · GitHub Copilot',
        model: 'github-copilot/claude-opus-5',
        effort: 'xhigh',
      },
      {
        id: 'opencode-copilot-opus-5-max',
        label: 'Opus 5 · GitHub Copilot',
        model: 'github-copilot/claude-opus-5',
        effort: 'max',
      },
      // Observed: the same five.
      {
        id: 'opencode-copilot-sonnet-5-low',
        label: 'Sonnet 5 · GitHub Copilot',
        model: 'github-copilot/claude-sonnet-5',
        effort: 'low',
      },
      {
        id: 'opencode-copilot-sonnet-5',
        label: 'Sonnet 5 · GitHub Copilot',
        model: 'github-copilot/claude-sonnet-5',
        effort: 'medium',
      },
      {
        id: 'opencode-copilot-sonnet-5-high',
        label: 'Sonnet 5 · GitHub Copilot',
        model: 'github-copilot/claude-sonnet-5',
        effort: 'high',
      },
      {
        id: 'opencode-copilot-sonnet-5-xhigh',
        label: 'Sonnet 5 · GitHub Copilot',
        model: 'github-copilot/claude-sonnet-5',
        effort: 'xhigh',
      },
      {
        id: 'opencode-copilot-sonnet-5-max',
        label: 'Sonnet 5 · GitHub Copilot',
        model: 'github-copilot/claude-sonnet-5',
        effort: 'max',
      },
      // Observed: none, low, medium, high, xhigh — no `max`, which the two above take. Each is a
      // `reasoningEffort` sent straight through, and `none` is left out for the reason above.
      {
        id: 'opencode-copilot-gpt-5-5-low',
        label: 'GPT-5.5 · GitHub Copilot',
        model: 'github-copilot/gpt-5.5',
        effort: 'low',
      },
      {
        id: 'opencode-copilot-gpt-5-5',
        label: 'GPT-5.5 · GitHub Copilot',
        model: 'github-copilot/gpt-5.5',
        effort: 'medium',
      },
      {
        id: 'opencode-copilot-gpt-5-5-high',
        label: 'GPT-5.5 · GitHub Copilot',
        model: 'github-copilot/gpt-5.5',
        effort: 'high',
      },
      {
        id: 'opencode-copilot-gpt-5-5-xhigh',
        label: 'GPT-5.5 · GitHub Copilot',
        model: 'github-copilot/gpt-5.5',
        effort: 'xhigh',
      },
    ],
  },
] as const satisfies readonly ProviderEntry[]

/** The CLI product an Employee's Session runs on. */
export type Provider = (typeof PROVIDER_CATALOGUE)[number]['id']

/** Every Provider, in catalogue order. */
export const PROVIDERS: readonly Provider[] = PROVIDER_CATALOGUE.map((entry) => entry.id)

/**
 * The last resort, and nothing more: the first entry of the catalogue.
 *
 * It is not what a new Employee starts on — {@link pickDefaultProvider} is, and it answers from
 * what is actually on this Mac. This is only what that helper falls to when nobody has asked the
 * CLIs yet, or when every one of them is missing: something has to be in the box before the boss
 * has a machine TinyCorp can read, and the first line of the catalogue is as good an answer as
 * there is. Read it as "the fallback", never as "the Provider" (T169).
 */
export const FALLBACK_PROVIDER: Provider = PROVIDER_CATALOGUE[0].id

/**
 * The Provider a new Employee starts on, read off this Mac rather than off the catalogue (T169).
 *
 * Claude, Codex and OpenCode are equals, and one of them installed is enough to use TinyCorp. So
 * the default a hiring form, a preset or an MCP tool opens on is the first Provider in catalogue
 * order that can run an Employee today, then the first one that is at least installed — a boss who
 * has the CLI but not the login is one `login` away, which is nearer than an install — and only
 * then {@link FALLBACK_PROVIDER}, which is also the answer before anybody has asked.
 *
 * `preflight` is what the main process already read: `preflight.all()` over the bridge, one answer
 * per Provider in the catalogue. Null while that read is out.
 */
export function pickDefaultProvider(preflight: readonly ProviderPreflight[] | null | undefined): Provider {
  const state = (provider: Provider) => preflight?.find((entry) => entry.provider === provider)?.state
  const ready = PROVIDERS.find((provider) => {
    const found = state(provider)
    return found !== undefined && !preflightBlocks({ state: found })
  })
  return ready ?? PROVIDERS.find((provider) => state(provider) === 'signed-out') ?? FALLBACK_PROVIDER
}

/**
 * The model a Provider's own catalogue puts first: what a form or a preset fills in when it needs a
 * model and the boss has named none. Its first entry is the model's default at every other level
 * too (T139), so this is one rule and not a second list.
 *
 * Null for a Provider that lists no model at all: its Employees run on whatever its CLI defaults to
 * (decision 31), which is exactly what a null model means everywhere else.
 */
export function providerDefaultModel(provider: Provider): string | null {
  return PROVIDER_MODELS[provider]?.[0]?.id ?? null
}

export function providerEntry(provider: Provider): ProviderEntry {
  return PROVIDER_CATALOGUE.find((entry) => entry.id === provider)!
}

/**
 * `prompt` as the message that invokes `skill` on this Provider (T264): a leading `/<skill>` where
 * the CLI reads its input that way, its own `$<skill>` mention where it has one, and otherwise one
 * plain sentence. The invocation comes first, because a slash command is only read at the start.
 */
export function invokeSkill(entry: Pick<ProviderEntry, 'invokesSkill'>, skill: string, prompt: string): string {
  switch (entry.invokesSkill) {
    case 'slash':
      return `/${skill} ${prompt}`
    case 'dollar':
      return `$${skill} ${prompt}`
    default:
      return `Use your \`${skill}\` skill for this. ${prompt}`
  }
}

/**
 * Every table the app draws, from one catalogue.
 *
 * It takes the catalogue rather than reading it, so the promise this file makes can be tested:
 * `provider-registry.test.ts` builds these from a catalogue with one extra Provider in it and
 * checks the hiring form, the Usage page and the drawer all carry it, with no other file touched.
 * If a table were hand-written beside the catalogue instead, that test could not exist.
 */
export interface ProviderTables {
  /** Every Provider, in catalogue order. */
  providers: readonly string[]
  /** What the boss sees each one called. */
  label: Record<string, string>
  /** The short name the Usage popover draws. */
  shortName: Record<string, string>
  /** The command each one is installed as. */
  command: Record<string, string>
  /** The models each one knows (decision 31). */
  models: Record<string, readonly ModelOption[]>
  /** Whether each one reads skill folders at all, and where (T137). */
  skillsFolder: Record<string, string | null>
  /** The mark each one is drawn with, where it has no logo. */
  icon: Record<string, ProviderIcon>
  /** The logo each one is drawn with, or null for one this repo ships no logo for. */
  logo: Record<string, ProviderLogo | null>
  /** Whether each one needs Git for Windows' `bash.exe` to run a command on native Windows. */
  needsGitBash: Record<string, boolean>
  /** How each one is signed in and out. */
  auth: Record<string, ProviderAuth>
  /** The Provider select's options, in catalogue order: hiring, the Employees page, Staff. */
  choices: { value: string; label: string }[]
}

export function providerTables(catalogue: readonly ProviderEntry[]): ProviderTables {
  const by = <T>(read: (entry: ProviderEntry) => T): Record<string, T> =>
    Object.fromEntries(catalogue.map((entry) => [entry.id, read(entry)]))
  return {
    providers: catalogue.map((entry) => entry.id),
    label: by((entry) => entry.name),
    shortName: by((entry) => entry.shortName),
    command: by((entry) => entry.command),
    models: by((entry) => entry.models),
    skillsFolder: by((entry) => entry.skillsFolder),
    icon: by((entry) => entry.icon),
    logo: by((entry) => entry.logo ?? null),
    needsGitBash: by((entry) => entry.needsGitBash === true),
    auth: by((entry) => entry.auth),
    choices: catalogue.map((entry) => ({ value: entry.id, label: entry.name })),
  }
}

/** The app's own tables. */
const TABLES = providerTables(PROVIDER_CATALOGUE)

/** What the boss sees a Provider called. */
export const PROVIDER_LABEL = TABLES.label as Record<Provider, string>

/** The short name the Usage popover draws. */
export const PROVIDER_SHORT_NAME = TABLES.shortName as Record<Provider, string>

/** The command each Provider is installed as. */
export const PROVIDER_COMMAND = TABLES.command as Record<Provider, string>

/** The models each Provider knows (decision 31). */
export const PROVIDER_MODELS = TABLES.models as Record<Provider, readonly ModelOption[]>

/**
 * Where each Provider looks for skill folders, or null when it reads none (T137). The screens read
 * this rather than naming a product: an Employee holding skills on a Provider whose entry is null
 * is told so.
 */
export const PROVIDER_SKILLS_FOLDER = TABLES.skillsFolder as Record<Provider, string | null>

/** The mark each Provider is drawn with, where it has no logo. */
export const PROVIDER_ICON = TABLES.icon as Record<Provider, ProviderIcon>

/** The logo each Provider is drawn with, or null for one this repo ships no logo for. */
export const PROVIDER_LOGO = TABLES.logo as Record<Provider, ProviderLogo | null>

/** How each Provider is signed in and out. */
export const PROVIDER_AUTH = TABLES.auth as Record<Provider, ProviderAuth>

/**
 * Which Providers need Git for Windows' `bash.exe` on native Windows (T249). The first-launch step
 * and Your profile name these and no others, so the sentence stays true as the catalogue changes.
 */
export const PROVIDER_NEEDS_GIT_BASH = TABLES.needsGitBash as Record<Provider, boolean>

/** The Providers that need Git for Windows on native Windows, by the name the boss sees them as. */
export function gitBashProviders(providers: readonly Provider[] = PROVIDERS): string[] {
  return providers.filter((id) => PROVIDER_NEEDS_GIT_BASH[id]).map((id) => PROVIDER_LABEL[id])
}

/** The options every Provider select draws, in catalogue order. */
export const PROVIDER_CHOICES: readonly { value: Provider; label: string }[] = TABLES.choices as {
  value: Provider
  label: string
}[]

/** `Claude, Codex and OpenCode` — every name in one sentence, whatever the catalogue holds. */
export function nameList(names: readonly string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
