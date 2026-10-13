# Contributing

TinyCorp is a desktop orchestrator: a Company is a team of Employees, each a long-lived session of
some coding CLI, running on your own subscription. Start with [`docs/product.md`](docs/product.md),
then [`docs/decisions.md`](docs/decisions.md) — every decision in that file was paid for once, and
re-opening one is a conversation, not a patch.

The project is **Apache-2.0** ([`LICENSE`](LICENSE)), contributions are certified with a **sign-off**
rather than a CLA, everyone here is held to the [Code of Conduct](CODE_OF_CONDUCT.md), and a security
problem goes through [private reporting](SECURITY.md) rather than an issue.

## Your first pull request

1. **Set up** for your platform (below), then `pnpm install` and `pnpm dev`. If the app opens, you
   are ready — nothing else needs configuring, and no API key is involved anywhere.
2. **Pick something.** `good first issue` and `help wanted` are the two labels worth filtering on.
   A new Provider or a new forge is a pull request we are actively hoping for: see
   [`docs/providers.md`](docs/providers.md) and [`docs/forges.md`](docs/forges.md).
3. **Read [`ARCHITECTURE.md`](ARCHITECTURE.md)** for where your change goes and which way it is
   allowed to point, and [`docs/engineering.md`](docs/engineering.md) for how the TypeScript in it
   is written. Both are short, and `src/architecture.test.ts` enforces the first one.
4. **Write the test that would have caught it**, then the code. `pnpm test` is Vitest, it never
   spends a subscription, and it runs on every platform.
5. **Commit with `git commit -s`** — the sign-off is checked (see below) — and keep a move separate
   from an edit: a pure `git mv` commit, then the rewrites.
6. **Open the pull request.** `pnpm typecheck`, `pnpm test` and `pnpm build` green on top of a
   merged `origin/main`; the title is `type(scope): subject`; the template's checklist is the review,
   including which platforms you could test on and, if a screen changed, a capture of it before
   and after. Say what you left out and what you had to decide — out loud in the body, not buried in the
   code.

## Setting up

Every platform needs **Node 24 or newer** and **pnpm**, which comes with Node: `corepack enable`
takes the version in `package.json`'s `packageManager` field and nothing else. Then:

```sh
pnpm install
pnpm dev          # the app
pnpm lint         # Biome: the formatter and the linter, in one pass
pnpm typecheck
pnpm test         # Vitest; never spends a subscription
pnpm knip         # what nothing imports
pnpm build
pnpm test:e2e     # the built app, driven through Playwright; no CLI, no network
```

You only need an agent CLI — `claude`, `codex`, `opencode` — to *run* an Employee, and then signed in
on your own subscription rather than with an API key. Nothing in `pnpm test` needs one.

### macOS

Apple Silicon. Nothing to compile: `node-pty` ships a prebuild for darwin-arm64, and `pnpm package`
makes `release/TinyCorp.app` and an unsigned DMG.

### Windows, natively

x64, Windows 10 or later. Install **Git for Windows** — it is optional for the app (a hook runs in
PowerShell without it) but it is what the suite's real-git tests and your own `git` want.
`node-pty` ships a win32-x64 prebuild, so there is nothing to compile, and `pnpm package:win` builds
the installer.

The suite starts hundreds of short-lived node processes; on Windows that is several minutes rather
than the Mac's few, which is normal and not a hang. Read [`docs/windows.md`](docs/windows.md) before
touching anything that spawns a process or joins a path.

### Windows with WSL

A Provider installed **inside a distro** is a first-class place for it to run, and most of
[`docs/windows.md`](docs/windows.md) is about that: path translation, the WSL virtual switch, the
firewall prompt. It is where the CLI lives, not where TinyCorp is developed — a `pnpm dev` inside the
distro is the *Linux* app, so fix the Windows build from Windows.

### Linux

x86-64, Ubuntu 22.04 / Debian 12 / Fedora 39 or newer ([`docs/linux.md`](docs/linux.md) says why
those floors). There is no `node-pty` prebuild for Linux, so packaging compiles it against Electron's
own headers, and a desktop needs the libraries a packaged Electron app links against:

```sh
sudo apt-get install -y build-essential python3 \
  libgtk-3-0 libnss3 libgbm1 libasound2t64 libsecret-1-0 libnotify4 xdg-utils
```

The `.deb` declares all of that and `apt` installs it for you; an AppImage cannot, which is why the
list is here. **`libsecret-1-0` and a running keyring** (GNOME Keyring or KWallet) are the ones to
notice: without them TinyCorp refuses to store a secret at all, out loud, rather than pretending to
encrypt it. On a headless box, `pnpm package:linux` and then `xvfb-run node tools/smoke-packaged.mjs`
is what CI does.

## The four tiers of test

Each tier answers a question the one below it cannot, and costs more to run than it does. Write in
the cheapest tier that can catch the bug, and go up only when it genuinely cannot.

| Tier | Named | Runner | What it proves | Command |
| --- | --- | --- | --- | --- |
| **unit** | `*.test.ts`, `*.test.tsx` | Vitest, node | A module does what it says, against fakes | `pnpm test` |
| **dom** | `*.dom.test.tsx` | Vitest, jsdom | A component renders and reacts to a click | `pnpm test` |
| **real** | `*.itest.ts` | Vitest, node | The loop works against a real CLI on your login | `pnpm test:claude` |
| **e2e** | `e2e/*.spec.ts` | Playwright, Electron | The built app opens and a boss can get through a screen | `pnpm test:e2e` |

**unit** is where nearly everything belongs, and it is the tier the whole suite is fast because of.
**dom** is the same runner with a document: a test that needs one says so in its *name*, which is
how `vitest.config.ts` picks the project — never a comment at the top of the file.

**real** is separate and always will be: it runs against a real CLI on your own login, it is slow,
it spends your usage, and each test skips itself without its credential.

**e2e** starts the app that `pnpm build` produced — the real main process, the real engine, a real
SQLite database in a real folder — and drives the real screens through Playwright's Electron
support. Two things in it are not what a boss runs, and both are gated:

- **The Provider is the suite's own fake**, through `TINYCORP_E2E`, which a packaged build ignores
  (`src/main/app/e2e-mode.ts`). Nothing in an e2e run starts a CLI, asks GitHub about a release or reads
  the keychain, so a run costs nothing and works on a train.
- **The operating system's folder picker is answered rather than opened**, in the main process, by
  the run itself. Nothing in a page can click a native dialog.

Everything the run touches is in `os.tmpdir()` — the whole `userData` folder and the Company it
creates — so your own profile and Companies are never opened. There are **no screenshot
comparisons**: fonts differ per operating system, and `pnpm design:compare` is where a screen is
held against how it drew before. CI runs this tier on Linux only, under `xvfb-run`.

```sh
pnpm test:e2e                      # builds, then runs both specs
pnpm exec playwright test --debug  # step through one, with the app on screen
```

An e2e test is a last resort, not a first one: it is the slowest thing in the repo and the only one
that can fail for a reason that is not the code. It earns its place for what no other tier can see —
that the bundle starts, that the processes talk to each other, that a screen draws at all.

## Running one test file

`pnpm test` takes everything Vitest does, so a file, a folder or a substring of a path narrows it:

```sh
pnpm test src/main/engine/board.test.ts     # one file
pnpm test provider                          # every path matching "provider"
pnpm test src/main/engine/board.test.ts -t 'moves a ticket'   # one test by name
pnpm exec vitest                            # watch mode, while you work
```

## Signing your commits off

There is no CLA. Instead every commit carries a `Signed-off-by:` line, which is the
[Developer Certificate of Origin](https://developercertificate.org/): you wrote that patch, or you
have the right to submit it under Apache-2.0.

```sh
git commit -s -m 'fix(chat): a thread with one reply no longer shows two'
```

`git config --global format.signoff true` makes it the default. A branch that is already written
takes `git rebase --signoff origin/main` and a force-push. The `DCO` workflow checks every commit in
the pull request and names the ones that are missing it; nothing else about the check is manual, and
no bot needs to be installed.

## The pull request title

Conventional Commits, because the release notes are generated from them. **The scope is the ticket**
where there is one:

```
feat(T182): the office remembers where everyone was sitting
fix(chat): a thread with one reply no longer shows two
chore(deps): electron 45
```

The types are `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf` and `build`; the subject
starts lower case and says what the change *does*. `.github/workflows/pr-title.yml` is the check, and
it comments on the pull request saying what to fix.

If you change a workflow, [`actionlint`](https://github.com/rhysd/actionlint) reads
`.github/workflows/` and finds the things a failed run tells you about twenty minutes later — a typo
in an expression, an unquoted variable in a `run:` step. It is not installed by this repo and it is
not in CI: `brew install actionlint shellcheck`, then `actionlint`.

## Adding a Provider

A Provider is a CLI product an Employee's Session can run on — Claude Code and Codex today, yours
next. The whole guide is [`docs/providers.md`](docs/providers.md). The short version:

```sh
pnpm provider:new goose --name Goose --command goose
pnpm test
```

That copies the template, renames it, and writes the catalogue entry, the registry line and the row
in the docs table. `pnpm test` is then red, and each failure says what is missing and which part of
the contract it belongs to. Fill in `cli-todo.ts` until it is green.

### What a Provider pull request must include

- **The adapter**, in its own folder under `src/main/providers/<id>/`.
- **The registry entry**: the catalogue entry in `src/shared/domain/providers.ts` and the adapter line in
  `src/main/providers/provider-registry.ts`. `pnpm provider:new` writes both; finish the TODOs it
  leaves (the models, how the boss signs in, who maintains it).
- **The conformance suite, green.** `describeProviderConformance` runs from the adapter's own test
  file. Anything your Provider does that no other one does goes in tests beside that call.
- **A row in the table** at the end of `docs/providers.md`: the product, its CLI, how it
  authenticates, whether TinyCorp can read its usage, and who maintains it. A test checks the table
  and the catalogue agree, so this is not optional.
- **The shell your hooks run in, on every platform, looked up rather than assumed.** Say in the
  adapter's comment where you found it. Claude Code runs a hook in Git Bash on Windows only when
  Git for Windows is installed and in PowerShell when it is not; Codex runs one through `cmd.exe`
  and reads a `commandWindows` of its own. `hookCommand` has a form for each (decision 64), and a
  hook written for the wrong shell fails silently — the Session starts, works, and the app never
  hears another word about it.
- **A `forgetSession`, if your adapter puts anything on the disk.** A per-Session config in the
  app's `dataDir` holds that Session's bearer token, and every Employee runs as the same OS user
  with no sandbox between them — so the file is readable by all of them until it is deleted
  (T199, finding H5). Write it with `writeSessionFile` and take it away in `forgetSession`, which
  the engine calls wherever a Session ends. The suite reads `dataDir` back and fails an adapter
  that left a token behind.
- **A command rewrite, or a clear no.** Most of what an Employee reads is command output, and RTK
  filters it before the Employee reads it (T179). If your product can rewrite a shell command before
  it runs, answer `commandRewriteHook` — into the Session's own config in `cwd`, never through
  `rtk init -g`, and only where a rewritten command still stops at the boss's approval. If it
  cannot, leave the method out: the Tokens tab then says *not hooked* for your Provider, which is an
  answer. `docs/providers.md#rewrite` has the three rules the suite holds you to.
- **`pnpm typecheck` and `pnpm test` green**, with no screen naming your Provider: a test asserts
  that no renderer file names one directly. CI runs both on Windows as well as Linux.

### What it must not include

- **No API keys, anywhere.** A Session runs on the boss's own subscription login. Your adapter
  strips every API-key variable from the environment it spawns with. If your Provider genuinely
  needs a key of its own, it asks for it in the hiring form and holds it in the OS keychain — never
  in the Company database, never in a log, never in `argv`.
- **No test that spends usage.** The conformance suite runs against a fake process. A real-CLI
  check goes in a `*.itest.ts` that skips itself without its credential.
- **No telemetry.** No analytics, no crash upload, no version ping that names the boss, the Company
  or the repo.
- **No network call the boss did not ask for.** The adapter's only traffic is the CLI's own, and
  the local MCP server on `127.0.0.1` the engine hands it.
- **No `where`, no `which`, no `child_process` of your own to find your CLI.** `onPath` is the one
  answer, and it is the same resolver the spawn uses (decision 63), so the drawer can never promise
  a Provider the app cannot start.
- **No writing into the Company folder** beyond your hook file, and **no git**. Two Employees share
  that folder (decision 48), and the engine owns every worktree, branch and merge (decision 44).

A pull request that breaks one of these is refused, whatever else it does well. They are why this
is a desktop app people are willing to point at their own repos.

## Adding a forge

A forge is where a repo's pull requests live — GitHub and GitLab today, Azure DevOps next. Which
one a repo is on is read from its `origin`, per repo, so one Company can hold repos on several. The
whole guide is [`docs/forges.md`](docs/forges.md), and the shape is the Provider one: a catalogue
entry in `src/shared/forges/index.ts`, a folder under `src/main/forges/<id>/` whose adapter passes
the conformance suite in `src/main/forges/forge-conformance.ts`, and one line in
`src/main/forges/forge-registry.ts`.

### What a forge pull request must include

- **The adapter**, in its own folder, and **your CLI written as a function** beside it — what it
  prints for each call, which is the only thing the suite cannot know.
- **The conformance suite, green.** `describeForgeConformance` runs from the adapter's own test
  file. Anything your forge does that no other one does goes in tests beside that call.
- **A row in the table** at the end of `docs/forges.md`. A test checks the table and the catalogue
  agree, so this is not optional.
- **`pnpm typecheck` and `pnpm test` green**, with no screen naming your forge: a test asserts that
  no renderer file names one directly.

### What it must not include

- **No tokens, anywhere.** TinyCorp never holds a forge credential: the CLI has it, and the boss
  signs in with that CLI's own command. Nothing the adapter runs may carry a token — not in an
  argument, not in the environment it runs the CLI with, not in a config TinyCorp writes.
- **No phoning home.** A CLI that reports usage or checks for updates on every command has that
  turned off through the `env` the adapter runs it with — never by editing the boss's CLI config.
- **No test that opens a pull request.** The suite runs against a fake CLI. Nothing in `pnpm test`
  touches a network or a real repository.
- **No git.** The worktree, the branch, the push and the local merge are the engine's (decision
  44); by the time your adapter is called the branch is already pushed.
- **No policy.** Whether a pull request may be opened or merged is decided before the adapter is
  called, by the autonomy level and the merge gate. An adapter that can merge is not one that may.

## Everything else

- Schema changes are named migrations: the `Migration` is declared beside the code that reads the
  tables it makes, and appended to the list in `src/main/core/engine/migrations.ts`. The runner applies
  by name, never by position; names are unique and never renamed (decision 24).
- Engine tests use `inMemoryDatabases()` / `inMemoryRecents()` from `src/main/core/testing.ts`.
- Screens are designed in Pen first and exported under `design/`; see `docs/agents/` for the rest
  of the working agreements.
