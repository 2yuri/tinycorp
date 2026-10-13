<p align="center">
  <img src="docs/readme/hero.png" alt="TinyCorp — a company of AI employees, on your desktop" width="100%">
</p>

<p align="center">
  <b>A team of AI coding agents that works like a company — on your own subscriptions, on your own machine.</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <a href="https://github.com/2yuri/tinycorp/actions/workflows/ci.yml"><img src="https://github.com/2yuri/tinycorp/actions/workflows/ci.yml/badge.svg" alt="CI: macOS, Windows and Linux"></a>
  <a href="#install"><img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="macOS, Windows and Linux"></a>
</p>

---

TinyCorp is a desktop app. A **Company** is a folder on your disk, and every **Employee** in it is a
long-lived coding-agent session — Claude Code, Codex or OpenCode — running on **your own
subscription**, as you, on your machine. They claim tickets from a board, work in their own git
worktrees, talk in a chat, and open pull requests you review without leaving the app.

It is not a chat window with a code block in it. It is a place where the work has a state you can
see.

<img src="docs/readme/office.png" alt="The pixel office, with Employees at their desks, two in a meeting and one blocked at the counter" width="100%">

Every Employee is somewhere, and where they are is what they are doing: at a desk working, in the
glass room because two of them are talking, at the counter because they are blocked or out of usage.
The room is the status board.

## What it is

- **A Company of AI Employees, on your own subscriptions.** You hire them, name them, pick their
  model and give them the repos they may touch. Each one is a real coding CLI you already have,
  signed in as you.
- **A board, a chat and an office.** Tickets with WIP limits, channels and threads with approval
  cards in them, and a pixel office where every Employee's position is their state.
- **Real pull requests on real repos.** An Employee gets a git worktree of its own, runs the checks
  your repo already has, and opens a PR you read and merge — or send back with a reason.

<table>
<tr>
<td width="50%"><img src="docs/readme/board.png" alt="The board with the ticket drawer open"><br><b>The board.</b> Tickets, epics and WIP limits, and a drawer carrying everything about one ticket: its repos, its branch, its PR, its subtasks, and the restore points you can send an Employee back to.</td>
<td width="50%"><img src="docs/readme/chat.png" alt="A chat channel with an approval card and a hire request"><br><b>The chat.</b> Channels, DMs, threads, pins and search. An approval arrives here as a card you act on where it lands — <code>Approve &amp; merge</code>, <code>Approve hire</code>, <code>Send back</code> — not as a question you go and answer somewhere else.</td>
</tr>
</table>

<img src="docs/readme/files.png" alt="The Files view with a hover card, an outline and the problems bar" width="100%">

**The files.** Read what an Employee is working on while they work on it: the worktree's own tree,
types on hover, go-to-definition, diagnostics from the project's own TypeScript, and an editor that
saves back into the worktree.

## How it is different

- **Bring your own subscription. There are no API keys.** Sessions run on your login, and each
  adapter strips the variables that would make its own CLI bill an API key instead:
  `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` for Claude Code, every `CODEX*` variable for
  Codex, `OPENCODE_API_KEY` and `OPENCODE_AUTH_CONTENT` for OpenCode. The work is billed to the
  subscription you already pay for.
- **Plans, reviews and asks come before a merge.** An Employee writes a plan you can send back
  before it writes code, and the things the Company treats as gated — merging, hiring, spending past
  a budget — wait for you in the Inbox. Nothing merges because an agent decided it was finished.
- **Employees write into worktrees, never into your checkout, and never commit to your default
  branch.** Work arrives as a branch and a pull request. Every ticket worktree keeps restore points
  you can send an Employee back to, including what was never committed.
- **Claude Code, Codex and OpenCode are equals.** A Provider is a folder and two lines, every
  adapter answers the same conformance suite, and one installed CLI is enough to use the app. Which
  product an Employee runs on is a per-Employee setting, so a Company can mix them.
- **It is yours, on your disk.** A Company is a folder with a SQLite database in it. There is no
  server, no account and no telemetry.

## Install

There is no published release yet — **releases coming soon**. Until then, build from source below;
if you were sent a private build, [`docs/beta.md`](docs/beta.md) is the page for you.

When a release exists, each platform gets:

| Platform | What you download | Notes |
| --- | --- | --- |
| **macOS** | the `.dmg` | Apple Silicon. Unsigned, so the first open is right-click → **Open**, not a double-click. |
| **Windows** | `TinyCorp-Setup-<version>-x64.exe` | Windows 10 or later, x64. Installs for you alone and needs no administrator. SmartScreen warns once: **More info → Run anyway**. |
| **Windows + WSL** | the same installer | The app itself runs on Windows; a Provider CLI installed **inside a distro** is a first-class place for it to run — see [`docs/windows.md`](docs/windows.md). |
| **Linux** | `TinyCorp-<version>-x86_64.AppImage` or `TinyCorp-<version>-amd64.deb` | x86-64, Ubuntu 22.04 / Debian 12 / Fedora 39 or newer. The `.deb` declares its own dependencies and `apt` installs them; an AppImage cannot, so read [`docs/linux.md`](docs/linux.md) first. |

Nothing auto-updates yet. The app asks GitHub's public releases API whether a newer build exists and
tells you where to get it; that one request is unauthenticated and carries nothing of yours.

### Build from source

Every platform needs **Node 24 or newer** and **pnpm** (`corepack enable` takes the version in
`package.json`).

```sh
git clone https://github.com/2yuri/tinycorp.git
cd tinycorp
pnpm install
pnpm dev        # the app
```

If the window opens, you are done — there is nothing else to configure. To build an installer for
the machine you are on:

- **macOS** (Apple Silicon): `pnpm package` writes `release/mac-arm64/TinyCorp.app` and an unsigned DMG.
  Nothing is compiled; `node-pty` ships a darwin-arm64 prebuild.
- **Windows** (x64): `pnpm package:win` writes the NSIS installer, from either host. Nothing is
  compiled. To *develop* on Windows, [Git for Windows](https://git-scm.com/downloads/win) is worth
  having: the suite's real-git tests want it.
- **Linux** (x86-64): `pnpm package:linux` writes an AppImage and a `.deb`. This one **does**
  compile `node-pty` against Electron's headers, so it needs `build-essential` and `python3`, plus
  the libraries a packaged Electron app links against. [`docs/linux.md`](docs/linux.md) has the
  `apt-get` line, and `libsecret-1-0` with a running keyring is the one to notice: without it
  TinyCorp refuses to store a secret rather than pretend to encrypt it.

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the full per-platform setup, and the checks:

```sh
pnpm lint       # Biome: the formatter and the linter in one pass
pnpm typecheck
pnpm test       # Vitest; never spends a subscription
pnpm build
```

To actually *run* an Employee you need one agent CLI — `claude`, `codex` or `opencode` — signed in
on your own subscription. Nothing in `pnpm test` needs one.

## Quick start

Your first Company is five steps, and the app walks you through them:

1. **Company** — name it and point it at a folder. That folder is the Company: its database, its
   memory and its worktrees live there.
2. **Team preset** — the shape of the office: Solo builder, Product squad, Full studio, or Start
   empty and hire by hand.
3. **Your team** — the names and the models. Every seat is proposed on a Provider this machine can
   actually run.
4. **Repositories** — where the work happens. Point it at a real repo you do not mind branches
   appearing in, or a scratch clone for the first hour.
5. **First ticket** — give them something to build.

Then an Employee claims it, gets a worktree off your default branch, writes code, runs your repo's
own checks, opens a pull request and says so in `#prs`. You review the diff inside the app and
approve it, or send it back.

## How it works

Electron and TypeScript: React in the renderer, PixiJS for the office, node-pty for the sessions,
`node:sqlite` for a Company's database with named migrations. The **main** process owns everything
real — the folder, the database, git, the CLIs, the secrets — the **renderer** only draws what
arrived over IPC, and **preload** is the bridge and nothing else. An Employee reaches back the other
way: its session is spawned pointing at a local **MCP** server, and it moves a ticket or posts to
chat by calling a tool on it. The app learns a session is busy, idle or waiting on you from the
Provider's own **hooks**, never by scraping a terminal.

```
src/main       the Company engine, the Providers, the forges, IPC
src/preload    the bridge
src/renderer   React — office, board, chat, files, review
src/shared     types and the IPC contract
docs/          product, decisions, specs, guides
```

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the map: the modules, which way they are allowed to point,
and the invariants that hold everywhere. `src/architecture.test.ts` checks it against every import
in the repo, so it cannot quietly stop being true.

Every screen was designed in [pen.dev](https://pen.dev) before it was built, and
`pnpm design:compare` shoots every screen of the running app against how it drew before, so drift is
a number rather than an opinion.

## Providers

An Employee runs on a **Provider**: the CLI product that does the work. This table is the catalogue
in [`src/shared/domain/providers.ts`](src/shared/domain/providers.ts), which is the only place a
screen ever gets a Provider's name from — a test asserts that no renderer file names one.

<!-- providers:start -->
| Provider | CLI | Sign in with | Reads your usage |
| --- | --- | --- | --- |
| Claude Code | `claude` | Claude subscription, through `claude login` | Yes |
| Codex | `codex` | ChatGPT subscription, through `codex login` | Yes |
| OpenCode | `opencode` | Whichever account the boss already has, through `opencode auth login` | No |
<!-- providers:end -->

**Adding one is meant to be a pull request**, and `pnpm provider:new <id>` writes the three places it
touches: an entry in that catalogue, a folder under `src/main/providers/` whose adapter passes
[`src/main/providers/provider-conformance.ts`](src/main/providers/provider-conformance.ts), and one
line in [`src/main/providers/provider-registry.ts`](src/main/providers/provider-registry.ts). Every
adapter answers the same suite — spawn, resume, MCP injection, idle detection, usage limits, a clean
kill — so the second Provider cannot break somewhere the first one does not.
[`docs/providers.md`](docs/providers.md) is the guide, written for someone who has never opened this
repo.

Where a repo's pull requests live is a **forge**, read from the repo's own `origin`, per repo — so
one Company can hold repos on several. Adding one is the same shape
([`docs/forges.md`](docs/forges.md)):

<!-- forges:start -->
| Forge | CLI | Detected on | Sign in with |
| --- | --- | --- | --- |
| GitHub | `gh` | `github.com` | GitHub account, through `gh auth login` |
| GitLab | `glab` | `gitlab.com`, `gitlab.*` | GitLab account, through `glab auth login` |
<!-- forges:end -->

A repo on a forge with no adapter still works for everything local — worktrees, branches, diffs, a
local merge — and says plainly that it can open no pull request.

## Privacy and security

- **It runs locally.** No server, no account, no analytics, no crash upload. A Company is a folder.
  The one request TinyCorp makes on its own is an unauthenticated read of GitHub's public releases
  API, to notice a newer build; it carries no name of yours.
- **TinyCorp does not hold your credentials.** It never stores a subscription login or a forge
  token, never writes one into a config of its own and never passes one as an argument. The CLIs own
  their auth: you sign in with the CLI itself — `claude /login`, `codex login`, `gh auth login` —
  and the app spawns a process that is already signed in. To answer *are you signed in?* it runs the
  CLI's own status command — `claude auth status`, `codex login status`, `opencode auth list` — and
  never opens the credential file.
- **Secrets live in the OS store.** One store with one backend per platform
  ([`src/main/platform/safe-storage-secrets.ts`](src/main/platform/safe-storage-secrets.ts)): the
  login keychain on macOS, DPAPI on Windows, libsecret on Linux. The encrypted blobs sit in the
  app's own `userData`, never in the Company folder people zip and hand to each other. On a desktop
  where encryption would not really be encryption, TinyCorp refuses out loud.
- **Environment values never reach an Employee.** The names are rows in the database; the values are
  in the OS store, read at one moment only — the child process a run spawns — and both its streams
  come back with every value replaced.
- **An Employee is not sandboxed, and that is the deal.** It can do what you can do in a terminal.
  The limits on it are the app's gates and the Provider's own permission prompts. Prompt injection
  is a real risk here: a ticket, a PR comment or a README in a repo an Employee reads is data, and an
  Employee that treats it as an instruction is a bug worth reporting.

[`SECURITY.md`](SECURITY.md) is the whole attack surface, what is already known and not a finding,
and how to report a vulnerability privately.

## Contributing

Pull requests are welcome, and a **new Provider or a new forge** is the one we are actively hoping
for: both are a catalogue entry, a folder and one registry line, and the conformance suite tells you
what is still missing.

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setting up on macOS, Windows, WSL and Linux, your first pull
  request step by step, the four tiers of test, the sign-off and the title format
- [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`docs/engineering.md`](docs/engineering.md) — where a
  change goes, and how the TypeScript in it is written
- [`docs/providers.md`](docs/providers.md) · [`docs/forges.md`](docs/forges.md) — the two guides
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- [`docs/README.md`](docs/README.md) — every document in the repo, one line each

Commits are signed off (`git commit -s`, the [DCO](https://developercertificate.org/) — there is no
CLA), and a pull request title is Conventional Commits with the ticket as its scope:
`feat(T182): the office remembers where everyone was sitting`.

## Licence

TinyCorp is licensed under the [Apache License 2.0](LICENSE).

[`NOTICE`](NOTICE) carries the credits. The Company memory — a git-backed markdown wiki with a
derived index — follows the design of [ai-memory](https://github.com/akitaonrails/ai-memory) by Fabio
Akita (MIT); what was taken is the shape rather than the code.
[ponytail](https://github.com/DietrichGebert/ponytail) (MIT) is vendored under `tools/bench/` so that
one arm of `pnpm bench:tokens` measures the real ruleset instead of a paraphrase of it, and its
insistence on isolating the arms and publishing the limitations is what
[`docs/bench-tokens.md`](docs/bench-tokens.md) is modelled on.
