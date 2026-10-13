# Adding a Provider

TinyCorp runs a team of Employees. Every Employee is a long-lived session of some coding CLI,
running on the boss's own subscription, in the boss's own folder, on the boss's own machine.

Which CLI, is a **Provider**. Claude Code is one. Codex is one. Yours can be one, and this page is
how — from a cold start, without reading the engine.

The shape of the work: one folder, two lines, one file to fill in.

---

## 1. What a Provider is here

A Provider is a **product**, not a model. `claude` is a Provider; Opus 5 is one of the models the
Claude Code Provider offers. An Employee picks a Provider when it is hired and a model inside it
(decision 31), and a model id belongs to exactly one Provider's catalogue.

TinyCorp does not call an API. It starts the product's CLI in a pseudo-terminal, in the Company
folder, and talks to it the way a person would: it types prompts in, and it watches the CLI's own
hooks to learn when the Employee is busy and when it is done. Everything else — the board, the
chat, the office, the approvals — is TinyCorp's, and none of it is the Provider's business.

So a Provider is worth writing an adapter for when its CLI can do six things:

| It must | Because |
| --- | --- |
| **Run a session in a terminal**, in a folder you choose | An Employee lives in the Company folder for its whole life (decision 25) |
| **Take instructions** at start-up, on the process | Each Employee has its own persona, repos and tools, and two Employees share the folder (decision 48) |
| **Resume** a conversation it started earlier | A Session restarts — the app quits, the Mac sleeps — and an Employee that forgets its ticket is useless |
| **Report its own idleness**, through hooks or events | The engine hands an Employee its next piece of work when it is idle, and never mid-sentence |
| **Report its own limits** | When the subscription runs out the team parks in the coffee area with a countdown, rather than failing silently. A Provider that fronts other products relays theirs, which is enough |
| **Say whether it is signed in**, without running a session | The app asks before it draws, so a missing login is a card with the fix on it rather than an Employee dying in a terminal |

A CLI that cannot resume, or cannot say when it is idle, is not ready to be a Provider. Say so in
the pull request rather than faking it — an adapter that lies about either produces an office full
of Employees that look busy and are not, and that is far worse than a missing Provider.

---

## 2. What TinyCorp requires of one

These are not style points. A pull request that breaks one of them is refused.

### A Session runs on the boss's own subscription, never an API key

TinyCorp is a desktop app on one person's machine, running on the subscription they already pay
for. It holds no account, no server and no key.

Your adapter strips every API-key variable from the environment it spawns with — the way
`providers/example/adapter.ts` does in `subscriptionEnv`, and `providers/claude/adapter.ts` does
for `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`. It also strips its own product's session
variables, so a Session started from inside another one does not adopt its parent's transcript,
sandbox or conversation. What it keeps is the one variable that names where the product stores the
boss's login, if it has one: stripping that would sign every Session out. Some products keep the
login somewhere no variable of theirs names — OpenCode's is in its XDG data folder — and then
there is nothing to keep and every one of its variables goes.

If your Provider genuinely needs a key of its own, it has to **say so in the hiring form** and hold
the key in the **OS keychain** — never in the Company database, never in a log, never in `argv`
where `ps` can read it. (Codex passes its MCP bearer token in an environment variable for exactly
that reason.)

### The boss's other tools stay out of a Session (T234)

TinyCorp is not the only thing on this machine that drives a coding-agent CLI. Orca, Conductor and
their kind each install their hooks in the **product's global config**, and each of those hooks
reads the **environment** to decide which of its own panes an event belongs to. TinyCorp spawns
its Employees out of the app process, and the app was started from the boss's shell, so both
halves are inherited: the boss got Orca notifications when a TinyCorp Employee replied.

Two things are required of every adapter, and the conformance suite checks the second:

**Run the inherited environment through `withoutOrchestratorEnv`**
(`main/providers/orchestrator-env.ts`) before you spawn anything, on top of whatever your own
product needs stripped. It is a denylist of prefixes — `ORCA_`, `CONDUCTOR_` and the rest — kept in
that one file, so adding an orchestrator is one line and no adapter has its own copy. It covers
the other half of the same leak too: `ORCA_AGENT_HOOK_TOKEN` is a bearer token for another app's
local server, and nothing in this Company has any business holding one.

**Then say what your product can do about its global config, and do it.** There is no shared
answer, because the three products differ:

| Product | Its global config | What the adapter does |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | Spawns with `--setting-sources project,local`. `project` is the `.claude/settings.json` in the Company folder, which is the file the app writes its own hooks into, so leaving `user` out costs the app nothing |
| Codex | `$CODEX_HOME/hooks.json` | Nothing beyond the environment strip. Codex has no such flag, and `$CODEX_HOME` has to stay the boss's own because that is where the login is |
| OpenCode | `~/.config/opencode/plugins/` | Nothing beyond the environment strip. `--pure` exists, but it empties *every* plugin origin including the Company folder's, so it would take TinyCorp's own status plugin with it |

Two things to know about the Claude Code flag, because neither is obvious:

- **It takes the boss's `~/.claude/CLAUDE.md` with it.** Measured on `claude` 2.1.282: a Session
  spawned without the `user` source cannot read that file. The *repo's* `CLAUDE.md` and `AGENTS.md`
  still load — those are the folder's, not the user's — and an Employee's own instructions are
  rendered by the engine (T184), so what is lost is the boss's personal preferences reaching an
  Employee, which is the same leak as the hooks. A boss who wants a rule to reach every Employee
  puts it in the Company memory (`docs/company-memory.md`), which is the Company's own.
- **A `claude` too old to know the flag fails the spawn**, rather than ignoring it. It is not
  version-gated, because everything else the adapter reads already needs a 2.1.x `claude`.

If a product you are adding has a flag that skips its global config *without* taking the Session's
own with it, use it and say so here. If it has none, say that in the pull request — "the
environment strip is all of it" is an answer, and a silent gap is not.

### No adapter may spend usage in a test

`pnpm test` must never cost the boss a token. The conformance suite runs entirely against a fake
process: your adapter is handed a `spawnPty` that records the command line instead of starting
anything.

A check against the real CLI goes in a `*.itest.ts` file, which only `pnpm test:claude` runs, and
which skips itself when its credential is missing. See `src/main/providers/integration/real-codex-loop.itest.ts`.

### An adapter reads and writes only its Employee's worktree

An adapter prepares the Company folder (its hook file, and nothing else) and starts a process. It
does not touch repos, does not run git, and never commits on the default branch — the engine owns
all of that, through worktrees and the merge gate (decision 44).

Nothing Employee-specific may be written into the Company folder. Two Employees run there at once,
so a file with one Employee's name in it is read by both, and the last one to start wins. This is
decision 48, it was a real bug, and the conformance suite asserts it.

### Nothing phones home

No analytics. No crash upload. No version ping that names the boss, the Company or the repo. The
only network the adapter is party to is the CLI's own traffic to its own product, and the local
MCP server on `127.0.0.1` that the engine hands it.

---

## 3. The `ProviderAdapter` contract

`src/main/providers/provider-adapter.ts` is the seam, and
`src/main/providers/provider-conformance.ts` is the suite that checks you honoured it. Each part below
is named the way the suite names it, so a failure tells you which section to re-read.

### `spawn`

```ts
spawn(request: SpawnRequest): PtySession
```

Starts the CLI in a pseudo-terminal, in `request.cwd`, with `TINYCORP_HOOK_TOKEN` set to
`request.hookToken` and a terminal big enough to draw in. Installs the hook file first.

The **hook file** is whatever this CLI's own extension point is, and `installHookFile` in
`provider-hooks.ts` writes only one of the shapes: a JSON `hooks` map running one shell command per
event, which is what Claude Code and Codex take. A CLI that extends itself some other way writes
its own file instead — OpenCode loads JavaScript modules out of `.opencode/plugins/`, so
`providers/opencode/plugin.ts` writes a plugin that does the same POST with the same token. Reuse
`hookCommand` and `excludeFromGit` whichever shape you are in; what has to hold is that the file
**names no Employee**, because two of them share the folder (decision 48), and that it stays quiet
when `TINYCORP_HOOK_TOKEN` is not on the process, so the boss's own runs of the CLI are untouched.

**Which shell your product runs that command in** is a question you have to answer, not assume
(T166). `hookCommand(url, shell)` has three forms — `posix`, `powershell` and `cmd` — and
`installHookFile` takes a `handler` so an adapter can write whichever ones its product reads.
What the two in the repo found:

| Product | macOS and Linux | Windows |
| --- | --- | --- |
| Claude Code | `sh` | Git Bash when Git for Windows is installed, **PowerShell when it is not** — and Git for Windows is optional there. The handler looks for Git Bash where Claude Code looks, writes that shell's form, and pins it with the entry's own `shell` field |
| Codex | the login shell | `%COMSPEC% /C`, always. Codex reads `commandWindows` in place of `command` there, so the one file carries both |
| OpenCode | — | — (its extension point is a JavaScript plugin, so no shell is involved) |

Find the answer in your product's documentation or its source before you write the file, and say
what you found in your adapter's comment. A hook written for the wrong shell fails silently: the
Session starts, works, and the app never hears another word about it.

**Ask `hookPlatform(placement)` and never `process.platform`** (T258). A Session inside a WSL distro
is a Linux process, and a product runs a hook command where it runs itself — so its hooks are the
POSIX ones whatever this Windows has installed. Chosen by host, Claude Code's own handler wrote a
PowerShell command line for a `claude` in Arch on any Windows without Git for Windows, and the
Session never reported ready. `hookPlatform` takes the `placement` your factory is already given and
answers `'linux'` for a Session in a distro; a product that writes every form it might need into the
one file, as Codex does, has nothing to do here.

*If it lies:* a Session that starts somewhere other than `cwd` sees none of the Company's repos,
worktrees or memory. A Session without the token produces hooks the engine cannot attribute, so
the wrong Employee is woken.

### `instructions`

`request.instructions` is the Employee's whole system prompt, already rendered by the engine. What
is in it is the Company's business — an adapter carries it and never builds it, so nothing under
`providers/` imports the renderer (T184). It is absent only when the engine has nothing to say
about the Company yet, and the adapter then falls back to a line naming the Employee.

The instructions ride **on the process**, through whatever flag the CLI has for a
system prompt — `--append-system-prompt` for Claude Code, a `-c additional_developer_instructions`
override for Codex.

**On the process** is the rule; a flag is only the usual way to keep it. A CLI with no such flag
may take them through a file of its own, as long as that file is in the app's `dataDir`, is this
Session's alone and is named on the process rather than found in `cwd` — OpenCode has neither an
`--append-system-prompt` nor an `--mcp-config`, and takes both in one JSON config named by the
`OPENCODE_CONFIG` environment variable, holding an agent whose prompt is that Employee's
instructions. What is forbidden is a file in the **Company folder**, where the other Employee reads
it too.

*If it lies:* write them into the folder instead and every Employee in the Company introduces
itself with the same name. This happened (decision 48).

An Employee can start Sessions of its own (T163), and the engine spawns each one through the same
`spawn`: the parent Employee, a ticket worktree as `cwd`, instructions that are already that piece
of the work rather than the Company's ways, and `request.subSession` naming it. There is nothing
extra to implement — put the instructions on the process as you would for any Session, and honour
`cwd` and the Employee's model. The conformance suite checks both.

### `isolation`

Nothing Employee-specific in `cwd`. Per-Session files — an MCP config, a scratch file — go in the
app's own `dataDir`, keyed by session id.

*If it lies:* one Employee is handed another's MCP bearer token.

It also means nothing of *another orchestrator's* reaches the Session. See the section below.

### `resume`

```ts
resumeCommand(sessionId: string): string[] | null
confirmsResume?(hook: HookPayload): boolean
handoffCommand?(employee: Employee, providerSessionId: string): string[] | null
```

A spawn without `resume` starts a new conversation. A spawn with it continues `sessionId`, keeping
the Employee's model. `confirmsResume` reads the CLI's start-up hook and says whether the previous
conversation really was continued — implement it for any CLI that can quietly start over.

It is asked **once**, on the first `ready` of a resumed Session, and never again: a denial that
arrives later is not heard. So whatever your adapter knows by the time it sends that first `ready`
is the whole answer. If the CLI says nothing at start-up either way, the hook has to go and find
out before it is sent — OpenCode's plugin asks OpenCode's own server whether the conversation it
was told to continue is really there, and reports a question it could not get an answer to as *not*
resumed, because a fresh Session only loses history while a false confirmation has an Employee
carry on about a ticket it has never seen.

*If it lies:* an Employee wakes up with no memory of the ticket it is in the middle of, or worse,
is told it resumed when it did not and carries on about work it has never seen.

`handoffCommand` is optional and builds the whole command line the boss pastes into their own
terminal to open an Employee's Session: your CLI, the args that continue `providerSessionId`, and
the *same* permission and model args your `spawn` uses — nothing else. Leave out the MCP config,
the hook token and the instructions: those belong to the Session TinyCorp runs, not to a second
terminal. The rule is that what the boss gets must behave like what the drawer shows; typing
`--resume <id>` from memory drops the skip flag, which is why the command is built here. The
conformance suite diffs your `spawn` between the two permission modes and requires every arg that
differs to be on the handoff command too, so the check follows whatever your CLI calls that flag —
a product like OpenCode, which takes no permission flag at all, simply has none to carry. Return
null, or leave the method out, when your CLI cannot be handed a running conversation: the drawer
then draws no button and says nothing. It only builds a line; nothing runs it.

### `mcp`

```ts
injectMcp(sessionId: string, servers: SessionMcp): string[]
```

Writes (or composes) this Session's MCP configuration and returns the args that load it. Per
Session, never shared. It is handed two things:

- **`servers.company`** — the Company's own server. Post to chat, move a ticket, ask for an
  approval: this is the Employee's hands.
- **`servers.granted`** — the MCP servers the boss granted this Employee out of the Company's own
  catalogue (T136, decision 57). An `http` server has a URL and, when the boss gave it one, a
  bearer token; a `stdio` server has a command, its arguments, its environment, and the variable
  its token arrives under. Most Employees are granted none.

An `http` server may also carry **named headers** (T245): `headers`, whose values are plain, and
`headerSecrets`, whose values came out of the OS store. Both are sent with every request — Datadog
authenticates with `DD_API_KEY` and `DD_APPLICATION_KEY`, SigNoz with `SIGNOZ-API-KEY` beside a
plain `X-SigNoz-URL` — and they are two fields rather than one for a single reason: a
`headerSecret` is a secret and **may not reach `argv`**, so a product that takes its configuration
on the command line has to put those somewhere else. All four adapters in this repo can send them:
Claude Code, OpenCode and the example write a `headers` object into the `0600` config file they
already write, and Codex writes `http_headers` for the plain ones and `env_http_headers` — which
names the variable each value rides in — for the secret ones. A product that genuinely could not
send a header must say so rather than dropping it silently: the conformance suite grants a
header-authenticated server and reads it back, so an adapter that drops one fails.

Your adapter writes them the way its product reads them, and **keeps the product's strictest MCP
flag on** — Claude Code's `--strict-mcp-config`. That flag is what stops an Employee inheriting
whatever the boss happens to have in their own config, and the catalogue is how more is given on
purpose. Nothing in an adapter may read the boss's own config to discover a server.

It may return no args at all: Codex puts the URL on the command line and each token in the
environment, and OpenCode keeps everything in the config file `instructions` already writes for
this Session, so `injectMcp` only remembers the servers and `spawn` puts them there. The suite
reads them back through your `mcpOn` and `grantedOn`, from wherever you really put them — the
command line, the environment or a file — so what it checks is that the Session was given what it
holds, and that a Session which was granted nothing did not get one anyway.

**A secret is never an argument.** `ps` shows every process's `argv` to every user on the Mac, so a
token reaches the process in its environment or in a file your adapter writes with mode `0600` in
the app's `dataDir`. The suite fails an adapter that puts one on the command line. Write that file
with `writeSessionFile` from `src/main/providers/session-files.ts`, which is where the `0700`
folder, the `0600` file and the `isProviderSessionId` check that keeps the name a name all live.

```ts
forgetSession?(sessionId: string): void
```

**Optional, and required of any adapter that puts a secret on the disk.** The Session is over: take
away whatever you wrote for it and drop whatever you kept for it in memory. The engine calls it
wherever it ends a Session — the boss stopping it, the process exiting, a resume that failed, the
app closing — and calls it for Sessions that were never given an MCP server at all, so find nothing
and say nothing rather than throwing.

This is not a tidy-up. Every Employee is a process of the same OS user as the app, with no sandbox
between them, so a file under `dataDir` is readable by every *other* Employee for as long as it is
there: `0600` keeps out other accounts, and there are none. Deleting it is what turns "every live
Session's bearer token, plus every dead one since the app was installed" into "this Session's
token, while this Session runs" (T199, finding H5). The suite reads every file under `dataDir`
back after calling it and fails an adapter that left a token in one. Codex writes nothing at all —
its bearer rides in the environment through `bearer_token_env_var` — and still implements it, to
drop what it held for the spawn.

*If it lies:* the Employee has no way to say anything and the office looks broken — or it is told
it has a tool it has not got, or holds one the boss never gave it.

### `skills`

```ts
installSkills?(worktree: string, skills: readonly GrantedSkill[]): void
```

**Optional, and leaving it out is an answer.** A skill is a folder of instructions the boss put in
the Company's catalogue — a review checklist, a deploy runbook — and the grant follows the role the
way persona and repo filter do (T137, decision 58). Claude Code reads `.claude/skills/`, Codex
`.codex/skills/` and OpenCode `.opencode/skills/`; if your product reads a folder like that, name it
as `skillsFolder` in your catalogue entry and implement this. If it reads none, leave both out: the
Employee's drawer then says `<Provider> — no skills`, which is the truth, rather than the app
pretending the grant did something. The registry test holds the two halves together, so claiming a
folder and installing nothing fails.

**Claim the folder, never guess it.** Every entry above was read off the installed CLI without
spending a subscription (T253): `codex debug prompt-input` renders the prompt Codex would send and
prints the skill roots it found, and `opencode debug skill` lists the skills OpenCode really loaded
and where each one came from. A folder TinyCorp fills that the product never opens is an Employee
that was told it has a runbook it has not got, so an unconfirmed folder stays `null`.

**Say how a message invokes one, too.** When the boss sends a message that opens with
`/<skill-name>` to an Employee who holds that skill, the prompt the inbox pushes opens with the
product's own way of invoking it (T264). `invokesSkill: 'slash'` is a leading `/<skill-name>`, which
Claude Code and OpenCode read as the skill with the rest as its arguments; `invokesSkill: 'dollar'` is
`$<skill-name>`, Codex's own skill mention. Leave it out and the prompt opens with one plain sentence,
"Use your `<skill-name>` skill for this.", which works for any agent. Confirm it from the CLI's own
files or docs, the same way as the folder, and never by running a Session.

It is handed **the whole grant, every time**, so it reconciles rather than adds: whatever is not in
the list is taken out of the worktree. Link rather than copy where the platform allows — the boss
edits the folder once and every Employee holding it sees the edit — and git-exclude whatever lands,
because the app writes into a worktree and never commits (decision 45). `syncSkillFolder` in
`src/main/platform/skill-folders.ts` does all of that; most adapters are one line over it.

**Nothing in a skill folder is executed, parsed or validated.** Not here, not anywhere. The agent
opens it at its own discretion, like any other file in its worktree. A folder the boss has moved or
deleted arrives with `missing: true`: leave it out, and do not throw — a moved folder says so on the
Employee and fails no spawn.

The suite reads back through your `skillsIn(worktree)`, from wherever you really put them.

*If it lies:* an Employee is told it has a runbook it cannot open, or goes on being steered by
instructions the boss took off it last week.

### `model`

An Employee with no model runs on the product's default. An Employee with one runs on it, at the
effort the catalogue names, on a fresh spawn **and on a resume**.

A catalogue entry is one `(model, effort)` pair, and a model's levels are the entries that share
its `model` — the MODEL control lists the model once, the EFFORT control under it offers those
levels (T139). The levels belong to the model, not to the product: a CLI can accept a level and
deny it for some of its own models.

**An entry is a claim about a binary.** The effort word is handed to the CLI verbatim, and every
one of the three CLIs here takes a value it does not know *without failing*: Claude Code prints
`Unknown --effort value` and starts at its default, Codex's `model_reasoning_effort` is an
unvalidated string, OpenCode's `variant` is an optional free-form one. So a level nobody has
confirmed against the installed binary does not produce an error anyone sees — it produces an
Employee that quietly thinks less hard than the catalogue promised. Confirm a level, or leave it
out and let the model carry `effort: null`.

**Where the effort goes is the adapter's business, not the catalogue's.** Claude Code takes a
flag, Codex a config key, and OpenCode a per-Session `agent.<name>.variant` — its `--variant` is an
option of `opencode run` alone, and TinyCorp spawns the TUI. Read the option list of the command
you actually spawn before deciding the product has no level at all (T140).

One that fronts several products spells its models the way it takes them — `provider/model` for
OpenCode — with a catalogue holding the accounts a boss is likely to have. The list a Provider
really offers is the boss's own logins, so a catalogue entry is a sensible menu, not a promise.

*If it lies:* Employees quietly change model every time they restart, and the boss's model choice
means nothing.

### `signals`

```ts
detectIdle(hook: HookPayload): SessionSignal | null
sessionIdOf?(hook: HookPayload): string | null
```

Maps the CLI's own hook events onto `ready` (it started), `busy` (it is working) and `idle` (its
turn ended), and `null` for anything that says nothing about idleness. `sessionIdOf` names the
conversation a hook came from, for a product that names its own conversations rather than taking
the app's.

Two things the names do not say:

- **`sessionIdOf` is not how a hook is attributed.** `TINYCORP_HOOK_TOKEN` is: the receiver reads
  it off the header and the engine looks the Session up by it, which is what lets two Employees
  share a folder. `sessionIdOf` is only how the engine learns the id to *resume* with later, so a
  hook that names no conversation is still a perfectly good signal.
- **The id a hook names is checked, not trusted.** A Session holds its own `TINYCORP_HOOK_TOKEN`,
  so the id it reports is a string the Employee itself chooses — and the app spends it as a token
  in this CLI's argv and as the name of a file it writes. It has to be a short opaque token,
  `/^[A-Za-z0-9._-]{1,128}$/` and not opening with `-`; anything else is refused and the Session
  keeps the id it already had. The conformance suite holds your `signalSessionId` fixture to the
  same shape, so a product whose conversation ids really do not fit it is a conversation to have in
  the PR rather than something to work around in the adapter.
- **`ready` is the only way out of `starting`.** A Session that never sends one waits for ever
  rather than degrading, so a CLI that says nothing at start-up has to send one itself. OpenCode
  names no conversation until the first prompt and emits nothing before it, so its plugin posts a
  `ready` of its own as soon as it loads. Inventing a signal the CLI does not send is fine when the
  thing it reports is true; inventing an `idle` the CLI did not reach is what this section is
  warning about.

*If it lies:* an Employee that is never idle never picks up its next ticket, and one that is always
idle is handed a second one mid-sentence.

#### Asking the boss (optional)

An Employee on **Ask first** stops in its terminal and waits before it acts, and the app has to say
so: `detectIdle` maps that event onto an ask — `asking('Write src/api/usage.ts')` — instead of onto
`busy` or `idle`. The Employee is then *waiting on you* everywhere the app already says that (the
office's hand-up and `!`, the menu bar's count, the drawer's pill, a row in the boss's Inbox and one
native notification), and the next `busy` or `idle` signal clears all of it. TinyCorp never answers
the prompt and never auto-approves: the boss types the answer in the terminal, and the ask resolves
itself. A Session on **Skip permissions** never asks, so nothing about it changes. The three
Providers all say it through their own event stream — Claude Code's `PermissionRequest` hook (and
the `permission_prompt` `Notification` behind it), Codex's `PermissionRequest` hook, OpenCode's
`permission.asked` / `permission.replied` events — so nothing reads an approval dialog off the
terminal. A Provider whose product cannot tell us leaves the ask out and says so here; its
Employees look Working while they wait, which is honest and is what every Provider did before T165.

#### Subagents (optional)

```ts
subagentOf?(hook: HookPayload): SubagentSignal | null
```

Some products run subagents inside the Session's own process — Claude Code's `Agent` tool is one.
They have no terminal and take no Session seat, and TinyCorp never starts one: it listens. When the
product's hooks say a subagent was asked for, started, ran a tool, came back or stopped,
`subagentOf` says so in the engine's words (`called`, `started`, `tool`, `returned`, `stopped`, and
`settled` when the parent's turn ends), and the engine keeps a small model per Session that the
Employee's drawer draws as a strip above its terminal.

A product with no subagents leaves it out, and the drawer draws no strip. One that has them keeps
only what the boss reads — the task's name, the prompt's first line, the command running — clipped
short: a hook can carry a whole prompt, and none of it belongs here. Nothing a Session's subagents
report outlives the Session: when the parent ends, so do they.

### `limits`

```ts
detectBudgetExhausted(output: string): boolean
budgetResetAt(output: string, now: Date): Date | null
```

Reads the product's own words for "you have hit your subscription limit", and when it resets —
Claude Code names a clock time, Codex a duration, which is why `now` is passed in. Return `null`
rather than guess.

A Provider that **fronts other products** has no words of its own for most of it: OpenCode relays
whatever the account the boss signed it in with says, so its adapter reads both shapes of a reset
and matches only sentences that name a spent allowance. A bare HTTP 429 is not one — it parks a
working Employee over a throttle that would have cleared by itself.

*If it lies:* Employees keep being handed work they cannot do, or the whole team parks for no
reason.

### `accounts` (optional)

```ts
accounts?(): {
  env: string
  defaultDir: string
  trustFolder?(configDir: string, folder: string): void
  email?(configDir: string): string | null
}
configDirEnv?(configDir: string): Record<string, string>
```

How the product holds more than one sign-in (T173). Claude Code reads `CLAUDE_CONFIG_DIR`, Codex
reads `CODEX_HOME`: an account **is** one of those directories, and a Session spawned with it
pointed there runs as whoever signed in there. **TinyCorp never sees, reads or stores a
credential**, here or anywhere else (decision 3).

The sign-in itself is not the adapter's (T263). The catalogue entry's `auth.signIn` names the
product's own login — its arguments, a first-run variant for a folder nobody has used, and the
steps the sign-in modal lists beside it — and the app runs it in a terminal **inside TinyCorp**,
through the same PTY a Session is spawned with, so it runs wherever the Provider runs. It then
watches that account's login appear with the Usage meter's own read. Two optional answers help:

- `trustFolder` marks the empty folder TinyCorp runs sign-ins in trusted, in a config folder
  TinyCorp made — never the boss's own — for a product that would otherwise stop to ask.
- `email` is the address the product wrote beside its login, read from a file and never by a
  subprocess, so Your profile can tell two accounts apart.

A product with no such variable leaves both out. That is an answer, not a gap: the Provider then
keeps one sign-in, `Add another account` is not drawn, and Your profile says so. Answering one and
not the other is the one thing that is wrong, and the suite says so.

*If it lies:* every Session runs as the same sign-in whichever account the boss picked — the wrong
subscription, and the wrong limit.

### `rewrite` (optional)

```ts
commandRewriteHook?(rtk: RtkHook | null): CommandRewriteHook
```

How this product runs every shell command through [RTK](https://github.com/rtk-ai/rtk) before it
runs it (T179). Most of what an Employee reads is command output — `git status`, a diff, a test run,
a log — and RTK filters that output before the Employee reads it.

What the method answers with is three things: `how`, one line for the Tokens tab's own row; whether
a rewritten command still stops at the product's approval (`keepsApprovals`); and `install(cwd)`,
which writes the rewrite into **the Session's own config in `cwd`**, beside the status hooks.

Three rules, and the suite holds you to all of them:

- **Per Session, never globally.** RTK ships an `rtk init -g` that edits `~/.claude`,
  `$CODEX_HOME/hooks.json` and the like. Never call it, and never write outside `cwd`: the boss's own
  terminal is theirs. The check spawns with a fake `HOME` and fails if anything lands in it.
- **Off means off at the next start.** The method is called at every spawn, including with `null` —
  the Company turned compression off, or RTK went away — and `install` then takes whatever rewrite is
  in that config back out. The hook file lives in the Company folder and outlives the Session that
  wrote it, so nothing else would ever remove it.
- **Permissions never widen.** `keepsApprovals` is a claim about the product: that a *rewritten*
  command still reaches the app's approval and still raises the boss's *needs you*. Claim it only
  where the product really behaves that way, and the suite will then hold you to `rewriteAsk` — the
  product's own permission payload for a rewritten `git push`, which must still read as an ask.
  Answer `false` and the Employees that ask first are left unhooked, which is the honest trade.

A product that cannot rewrite a command leaves the method out. That is an answer: its row on the
Tokens tab reads *not hooked*, and its Employees read what their commands really print.

The environment — `RTK_DB_PATH` and `RTK_TELEMETRY_DISABLED` — is not yours to build: merge
`rtkEnv(sessionRtk(adapter, request))` into the process's environment and that is the whole of it.

*If it lies:* an Employee that asks first runs a `git push` the boss was never asked about, or a
Company that turned compression off goes on being compressed for as long as its folder stands.

### `prompt`

```ts
pushPrompt(session: PtySession, text: string): void
```

Types the text into the Session and submits it — and nothing else.

*If it lies:* the Employee sits looking at a filled-in prompt box forever.

### `shutdown`

`kill()` ends the process once, and after it the adapter stops touching the terminal. Whatever the
dying CLI paints on its way out, the adapter must not answer it.

*If it lies:* the adapter types into a dead terminal. (The suite found exactly this in the Claude
adapter the first time it ran.)

### `install`

```ts
installed(): boolean
```

Whether the CLI is on this machine. An Employee on a missing Provider is never spawned; the drawer
says `<Provider> — not installed` instead of failing the Start button.

Answer it with `onPath(command, env)` and nothing else. `onPath` is `cli-command.ts`'s resolver,
which is the same thing every spawn and every `runCli` goes through, so a Provider it calls
installed is one the app can really start. That equality is the whole point of it: on Windows a
global npm install leaves `codex`, `codex.cmd` and `codex.ps1` on `PATH`, `where codex` finds all
three, and `CreateProcess` starts none of them — so an answer that came from `where` promised a
Session the app could not open (T166). The resolver searches `PATHEXT`, takes only what Windows can
actually start, and a `.cmd` or `.bat` it finds is run through `cmd.exe` by the spawn.

*If it lies:* the drawer says the Provider is here and the Start button dies with `ENOENT`.

### `preflight`

```ts
checkCli(): Promise<ProviderCheck>
```

Whether your CLI can run an Employee **at all**, asked once before the Launcher draws: is the
command here, is the boss signed in, and on what. What comes back is a card — a title, a sentence,
the commands that fix it, and a line beside `Check again` — in your product's own words, because
nobody else has them. A Provider whose CLI is missing or signed out refuses every Session on it
with that same sentence, rather than letting one fail inside a terminal with nothing anywhere
saying why (T129, T135).

The template answers it as `signIn` in `cli-todo.ts`, and `checkProviderCli` in
`provider-preflight.ts` turns those four answers into the card:

```ts
signIn: {
  statusArgs: ['auth', 'status'],           // Codex: ['login', 'status']
  installWith: 'npm install -g example-cli',
  signInWith: 'example auth login',
  verdict: (outcome) => …,                  // 'subscription' | 'api-key' | 'none'
  identity: (outcome) => …,                 // optional: { account, plan }
}
```

`identity` is the one optional answer. Your profile's Providers card lists every Provider on this
Mac with the account it is signed in as and the plan it holds (frame `Oykzs`, T141), and both come
out of the answer `verdict` already read — never a second subprocess. Leave it out when your CLI
will not say: the card then draws the state alone rather than an empty line, which is what Codex's
row looks like today. Never guess one; the suite fails an adapter that names an account for a CLI
nobody is signed into.

Four rules, and the suite holds you to all four:

- **Nothing may spend usage.** It is one status command with a timeout around it — never a
  Session, never a prompt, never a token of the boss's. The runner is handed in, so a test says
  what the CLI answered without any product being on the machine.
- **A command that did not answer is not a login.** A timeout, a crash and an answer you cannot
  parse are all `none`: TinyCorp knows nothing, says so, and the boss presses `Check again`. The
  opposite — reading silence as "signed in" — starts an Employee into a CLI that cannot run it.
- **Say what it is signed in *on*.** A product that can be signed in on a billed API key as well as
  on a subscription answers `api-key`, which is a warning and not a wall: the Employee runs, and
  the boss reads one line about the bill before it arrives rather than after.
- **Name only what your CLI named.** `account` and `plan` are what it printed, or `null`. An
  account invented for a signed-out CLI, or an empty string where there is no answer, is a line in
  Your profile telling the boss they are signed in as somebody.

Claude Code has a state of its own on top — an `ANTHROPIC_API_KEY` exported around TinyCorp itself,
which every Session has stripped from it — and wraps `checkProviderCli` to say so in its own words.
That is the shape to copy if your product has something the four answers cannot express.

*If it lies:* the boss is told a CLI is fine when it is not, and every Employee on it dies inside a
terminal — or the app holds a card in front of a Company that works perfectly.

### `needsGitBash` (optional, catalogue)

```ts
needsGitBash?: boolean
```

Whether your CLI runs its shell tools through `bash` — which on **native Windows** means Git for
Windows' `bash.exe` and nothing else, because a stock Windows has no `bash` at all and the one in
`System32` is the WSL launcher.

Say `true` and the first launch on Windows (T249) looks for it, will not let the boss past a team
that runs on Windows without it, and names your product in the reason. Leave it out and none of
that happens for you — which is right for a CLI that shells out through `cmd.exe` or PowerShell,
and for every Session that runs inside WSL, where the question does not arise.

It is a fact about the product rather than a line in a screen, so a Provider that starts needing it
says so here and every screen follows; `docs/windows.md` is the boss's side of it.

---

## 4. From empty file to green suite

```sh
pnpm install
pnpm provider:new goose --name Goose --command goose
```

That copies the template, renames it, and writes the catalogue entry, the registry line and the
row in the table below. It refuses an id that already exists and never overwrites a file. You now
have:

```
src/main/providers/goose/
  cli.ts          the eleven questions, as an interface
  cli-todo.ts     ← the only file you have to fill in
  adapter.ts      finished: the command line, the hook file, the MCP config, the kill
  adapter.test.ts the conformance suite, with readers to bring into line with your CLI
```

Then:

1. **`pnpm test`** — red, and the failures say what is missing, in words:

   > `resume: the args that start a conversation and the args that continue it is still TODO in
   > providers/goose/cli-todo.ts.`

2. **Fill in one hole in `cli-todo.ts`, run the tests again.** Each member's doc comment shows what
   Claude Code and Codex answer, so you have two real examples of every shape. Eleven holes, eleven
   greens.

3. **Bring `adapter.test.ts`'s readers into line** with the flags you wrote. They are how the suite
   looks at the command line your adapter built — `instructionsOn`, `continues`, `mcpOn`,
   `modelOn` — plus the hook payloads and limit message your product really sends.

4. **Finish the catalogue entry** in `src/shared/domain/providers.ts`: the models your Provider offers
   (every model id is unique across the whole catalogue), how the boss signs in, who maintains it.
   If the product's logo is in one of the two icon sets, name it as `logo` as well —
   [`brand-logos.md`](brand-logos.md) is how, and skipping it just leaves the generic mark.
   If your Provider is one of the products `UNSUPPORTED_PROVIDERS` in
   `src/shared/usage/provider-usage.ts` lists, take its line out of there in the same commit, or the
   Usage page draws it twice.

5. **`pnpm typecheck && pnpm test`** green, and your Provider is in the hiring form, on the Usage
   page and on the drawer's meta strip. No *screen* was edited — a test asserts that none of them
   names a Provider directly (`src/renderer/src/no-provider-names.test.ts`). A handful of **tests**
   read the catalogue by value and go red on the entry you added: `employee-model.test.ts`,
   `forms.test.tsx`, `provider-usage.test.ts` and `provider-new.test.ts`. Bring them up to the
   catalogue you now have — never down to the one you had.

6. **Fold `cli-todo.ts` back into `adapter.ts`** if it helps, the way `providers/claude/adapter.ts`
   writes it. The template's shape is there to make the questions findable, not because the engine
   cares — and for a CLI that is not shaped like Claude Code or Codex it will get in the way. Ten of
   the eleven questions answer with *command-line arguments*; a CLI that takes its system prompt, or
   its MCP server, through a file or an environment variable has nothing to put in them, and
   `providers/opencode/adapter.ts` is what that looks like once it is folded in. Do it early in
   that case rather than last.

7. **Write the real-CLI twin**: a `*.itest.ts` beside `src/main/providers/integration/`, skipped without its
   credential, that starts one Session against the real product and watches a pushed prompt go
   busy and back to idle. The suite pins the command line; only the CLI itself can tell you the
   hook file it loads is one it really reads.

8. Read [CONTRIBUTING.md](../CONTRIBUTING.md) and open the pull request.

### Why it is two lines and not one

The catalogue entry lives in `src/shared/domain/providers.ts` and the adapter line in
`src/main/providers/provider-registry.ts`, because they are on opposite sides of a process boundary:
the renderer draws the hiring form, the drawer and the Usage page from the catalogue, and it cannot
load an adapter, which is node code. `pnpm provider:new` writes both, the registry line only
compiles once the entry exists, and `createProviderAdapters` refuses a set that is missing one — so
a half-registered Provider never reaches an Employee.

---

## 5. Every Provider

| Provider | CLI | Authenticates with | Reads usage | Maintainer |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | Claude subscription, through `claude login` | Yes | TinyCorp |
| Codex | `codex` | ChatGPT subscription, through `codex login` | Yes | TinyCorp |
| OpenCode | `opencode` | Whichever account the boss already has, through `opencode auth login` | No | TinyCorp |
<!-- providers:end -->
| _the template_ | `example` | — | — | — |

`providers/example/` is not a Provider: it is the folder `pnpm provider:new` copies. It is failing
the suite on purpose, and `providers/example/adapter.test.ts` proves it both ways — red with its
holes open, green once they are filled.

A Provider whose row says **No** under *Reads usage* still runs; the Usage page says plainly that
it reports its limit in the Session rather than drawing a zero.

A **Yes** is a read TinyCorp can make without spending a token, with the login the product's own
CLI wrote and never with an API key, in the main process and never in the renderer
(`src/main/features/usage/provider-usage.ts`). There are two of them, and they are the same shape:
Claude Code's login answers at `api.anthropic.com/api/oauth/usage`; Codex's answers at
`chatgpt.com/backend-api/wham/usage` with the 5-hour and weekly percentages the CLI draws itself.
Neither read stores what it read, and neither touches the API key the same file may hold.

**Where that login is is a question with three axes, and `provider-logins.ts` is the only answer
(T257):**

- **the platform.** Claude Code keeps the login in the macOS keychain on a Mac and in
  `<config folder>/.credentials.json` — `CLAUDE_CONFIG_DIR`, or `~/.claude` — on Windows and Linux.
  Codex keeps `<CODEX_HOME>/auth.json`, or `~/.codex/auth.json`, on all three.
- **where the Provider runs** (T167, T249). A Session inside a WSL distro signs in *inside* that
  distro, so its login is in the distro's home, which this Windows process reads over
  `\\wsl.localhost\<distro>\home\<user>\…`. One Provider can be in each place, so it is decided
  per Provider, from the same placement the engine spawns with.
- **which sign-in** (T173). An account *is* a config folder, so every account is read from its own:
  its `.credentials.json` or its `auth.json`, and on a Mac its own keychain item — Claude Code names
  that item `Claude Code-credentials-<first 8 hex of sha256(config folder)>`, which is the CLI's own
  rule and is read out of the installed CLI rather than guessed at.

A row that found no login **says where it looked**, in the words the preflight's own `Looked in:`
line uses — a meter that is blank because the app looked on the wrong machine is the bug T257 was.

Prefer a command over a call when the CLI has one — running the product is the reading that cannot
drift from what the boss sees. Neither of these two has one: `codex doctor --json` reports the login
and not what it has spent, and `claude` prints its percentages only inside a session. So both go to
the endpoint their CLI goes to, and a Provider that adds a `usage` subcommand later should be moved
onto it.

Products TinyCorp lists but has no adapter for are in `UNSUPPORTED_PROVIDERS` in
`src/shared/usage/provider-usage.ts`, and the list is empty: OpenCode was the last of them, and landing
it was moving its line into the catalogue with an adapter behind it, which is what this page is
for. Naming a product before TinyCorp can run it is still one line there, and the popover already
draws the row.
