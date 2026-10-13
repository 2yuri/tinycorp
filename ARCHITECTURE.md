# Architecture

This is the map you read before your first change. It says what the pieces are, which way they are
allowed to point, and what must stay true. `docs/architecture/modules.md` says which file belongs
to which module, `src/architecture.test.ts` checks both against every import in the repo,
`src/doc-paths.test.ts` fails if any document here names a `src/` path that is not in the tree, and
`docs/engineering.md` says how the TypeScript inside a module is written.

## Bird's eye view

TinyCorp is a desktop app. A **Company** is a folder with a SQLite database in it. An **Employee**
is a long-lived coding-agent session — Claude Code, Codex, OpenCode — running on the boss's own
subscription, in a terminal the app started and the boss can watch. The app gives those Sessions a
**board**, a **chat**, a **memory** and an **office**, and they ship real code to real repos.

Three processes, as Electron has them:

- **main** owns everything real: the Company folder, the database, git, the CLIs, the secrets, the
  MCP server the Employees call back into. Every side effect is here.
- **renderer** draws. It holds no truth of its own; everything on a screen arrived over IPC and
  everything it wants done goes back the same way.
- **preload** is the bridge. It forwards channels and does nothing else.

They agree on `src/shared`, which is data shapes and pure functions and imports neither side.

An Employee reaches the Company the other way round: its Session is spawned with an **MCP** server
address, and it moves a ticket or posts to chat by calling a tool on it (`src/main/core/engine/company-mcp-server.ts`). Provider
**hooks** POST to a receiver in the main process, which is the only way the app learns that a
Session is busy, idle or waiting on the boss — nothing is scraped from a terminal.

Nothing an Employee writes is trusted as an instruction. Nothing a model writes lands in the
Company memory.

## Code map

The layout below is where the files are going; `docs/architecture/modules.md` is where each one is
today, and T185 to T188 move them — T185 moved the leaves, so `platform`, `providers`, `forges` and
`app` are already where this says, and T186 and T187 are moving the features into `features/` a
handful at a time; what is left in `main/engine` and `main/ipc` after them is `core`, `board`,
`chat`, `company` and `sessions`, which T188 takes. The module names are the same either way, so the map is already the table the boundary
test reads.

### `src/main/app`

The composition root. It starts Electron, makes the window, builds the menu, the tray and the
updater, and wires every module to every other one. It may import anything; nothing imports it, so
it is the one module with no front door. `src/main/index.ts` stays where electron-vite expects the
entry and is the whole wiring, read it first; everything it wires is under `app/`.

### `src/main/platform`

The machine, and nothing above it: child processes and CLI lookup (`cli-command.ts`,
`run-cli.ts`), a real git (`git-service.ts`), the OS secret store (`safe-storage-secrets.ts`), WSL
(`wsl-runtime.ts`, `wsl-path.ts`). Its pure half is `src/shared/platform` and belongs to the same
module — `absolute-path.ts`, `wall-clock.ts`, `redaction.ts` — because the renderer names them too.
It knows nothing about a Company, an Employee or a ticket, and it imports no feature. This is the
layer that makes "works on macOS, Windows and Linux" a property of the code rather than a promise
in a pull request.

### `src/main/core`

What a Company *is*, underneath the features. `core/engine/company-engine.ts` is the composition
root: a table of how one feature reaches another for one open Company, then one `register` call per
feature in dependency order, then the face they add up to. Its two type files sit beside it —
`facade.ts` is what the engine *is* to a screen, the intersection of every feature's own face, and
`options.ts` is what the boss's app hands in, the composition of every feature's own options.
`database.ts` opens the file and applies migrations by name; `migrations.ts` is the one list that
says which step ran when; `recents.ts` remembers the Companies this Mac has opened; `ipc-kit.ts` is
the handful of things every IPC module needs — the registry it registers on, and `attempt`, which
turns an expected failure into a `Result` the screen can say out loud.

### `src/main/providers` and `src/main/forges`

Two seams, the same shape. A **Provider** is one CLI product an Employee's Session can run on: a
catalogue entry (`shared/domain/providers.ts`), a folder with an adapter in it, and one line in
`provider-registry.ts`. A **forge** is where a repo's pull requests live, chosen per repo from its
`origin`. Every adapter passes a conformance suite — `provider-conformance.ts`,
`forge-conformance.ts` — which is the contract, written once, run against each of them.

An adapter translates and nothing else. It is handed an Employee, a folder and a rendered prompt,
and it spawns a process; it never decides what the Employee is told. `docs/providers.md` and
`docs/forges.md` are the guides, and `CONTRIBUTING.md` says what such a pull request must contain.

### `src/main/features/<name>`

One folder per thing the boss can see: `board`, `chat`, `sessions`, `review`, `memory`, `office`,
`hiring`, `testing`, `usage`, and the rest of the list in `docs/architecture/modules.md`. A feature
owns its engine (what it does), its IPC module (how the renderer asks), its MCP tools (how an
Employee asks) and its schema migration, and it exposes all of that through one `index.ts`.

Inside the folder the shape is always the same: `index.ts` is the public API and the only file
another module names; `wire.ts` is `register(ctx, deps)` — the Companies the app has open on one
side, the features this one reaches on the other — and answers with the feature's façade, the
options the boss's app may hand it, a `dispose(companyId)` for what it keeps per Company, and a
`close()` where it holds something that outlives the app otherwise. A neighbour arrives whole and
keyed by the open Company (`chat(entry)`, not one lambda per field), because what this feature reads
off it is this feature's business and not the composition root's. `ipc.ts` is the renderer's way in
and `tools.ts` an Employee's; the engine files and their tests sit beside them.

A feature may reach `core`, `platform`, `providers`, `forges` and `shared`. It reaches another
feature only through that feature's `index.ts`, and the set of features it reaches is the honest
measure of whether it is one thing or two.

### `src/shared/<name>`

The data both processes name, and pure functions over it. No `node:` imports, no React, no IO.
`src/shared/domain` is the layer under that: an `Employee`, a `Provider`, a ticket `Column`, the
`BOSS`, a channel id, a `Result`. Those words belong to the Company rather than to any one feature,
they import nothing, and every module may name them.

`src/shared/ipc` is the contract between the processes: one `*Api` interface per area, as the
renderer sees it on `window.tinyCorp`. The channel strings those calls travel under are in
`src/shared/domain/channels.ts`, so registering a handler costs no types.

### `src/renderer/src/<name>`

One folder per screen or panel, already foldered that way: `board`, `chat`, `office`, `review`,
`settings`, `markdown` for the rich markdown editor a screen writes a page in, and `ui` for the kit
everything is drawn with. The renderer's module is read off its
path, and the same front-door rule applies to it. Every screen is designed in Pen first, and
`pnpm design:compare` holds a change to the pixels the screen drew before it.

`renderer/src/ipc` is how a screen reads the engine (T212): one store per channel with one
subscription, shared by every component that reads it, and a catalogue of the channels there are. A
screen names one of those constants instead of reaching for `window.tinyCorp` and keeping a copy of
the answer, so a staff change is one read and not one per screen. `docs/engineering.md` → "How a
screen reads the engine" is the guide.

### Elsewhere

`src/preload` is the bridge. `src/build/packaging.ts` is what electron-builder is told.
`src/integration` is the few tests that are only worth anything end to end and so have to see both
processes; nothing there ships. `tools/` holds the scripts `package.json` names.

## Which way things point

```
app  →  features  →  core / providers / forges  →  platform
                              ↓
                           shared
```

- **Down only.** `platform` never reaches a feature. `core` never reaches a feature — it is what a
  Company is, not what it does. A Provider adapter never reaches the feature that spawned it.
- **Sideways through the front door.** A feature reaches another feature only through its
  `index.ts`, or through that feature's face in `src/shared`.
- **Everyone may reach `shared`**, and `shared` may reach nothing.
- **The two processes never name each other.** What they share is `src/shared` and the preload
  contract, and that is all.
- **No runtime cycles.** A `import type` is not a cycle; a value import is.

`src/architecture.test.ts` checks all five, and as of T202 all five hold outright: there is no
allowlist, and nothing counts how much of a rule is still unpaid.

The fourth — the front door — holds for every module in the main process as of T188 and for every
folder in the renderer as of T202: `main/core`, `main/platform`, `main/providers`, `main/forges`,
every folder under `main/features` and every folder under `src/renderer/src` has an `index.ts`, and
nothing outside a module names a file inside it. Two kinds of file are skipped and say so in the
test: a test, which may reach for the module it tests, and a capture harness, which is a dev-server
entry that ships in nothing and whose job is to stand exactly where a screen stands. One import is
named as deliberate — `main/index.ts` naming `providers/testing.ts` for the end-to-end fakes,
because a fake on a front door is a fake every consumer can see.

The first — the direction — holds outright too. `INVERSIONS` went with T188, which turned round the
last two: putting a granted skill folder in a worktree moved to `platform`, where it always
belonged, and `ProviderAdapters` moved to `providers`, which is where the adapters it maps are.

`core` may name a feature, and one file does: `core/engine/company-engine.ts`, which is the
composition root and whose whole job is to know them all. The other half of that — a feature naming
the engine — cannot happen, because `core` has two front doors and the engine is behind the second.
`core/index.ts` is what a Company *is*, and is what every feature imports; `core/engine/index.ts`
knows every feature and nothing below it names it. A single door over both would close a cycle
through every feature that imports `attempt` or `ticketCodeIn`.

### The engine, and what a feature puts on it

`core/company-context.ts` is which Companies are open, which one the boss is looking at, and every
cache keyed by one. A feature asks it for a `perCompany` cache rather than keeping a map of its own,
so closing a Company empties all of them at once and there is no `dispose` to forget (#410, T188).

`CompanyEngine` is not a list of members. Each feature declares the face it puts on the engine —
`BoardFacade`, `ChatFacade`, `ReviewFacade` — and its own IPC module names that one, so what a
screen can reach never widens because another feature grew a member. The engine is the composition
of all of them.

## Invariants

Things that are true of the whole app, each one a test somewhere.

- **Nothing in the Company memory is written by a model.** It is a git-backed markdown wiki the
  Employees read through MCP and the boss writes in the Memory screen; the SQLite index is derived
  and rebuilds from the files. `docs/company-memory.md`.
- **Every external command goes through `cli-command.ts`.** Never a bare `spawn('name')`: PATHEXT
  and `.cmd` shims are the difference between working on Windows and appearing to.
- **Every path goes through `node:path`.** Never `'/'` or `':'` by hand, never a string compare of
  two folders — the native realpath decides. Temp folders come from `os.tmpdir()`.
- **A secret only ever lives in the OS store.** The macOS keychain, DPAPI on Windows, libsecret on
  Linux, through `safe-storage-secrets.ts`. Never a file in the Company folder, never `argv`, never
  a log. A desktop where the OS cannot really encrypt is refused out loud rather than pretended at.
- **No test touches the network, and no test spends the boss's subscription.** The suite runs
  against fakes and real temp folders. The handful of runs against a real CLI are `*.itest.ts`,
  they are a Vitest project of their own, and `pnpm test` never starts them.
- **An Employee's identity is on its process, never in the Company folder.** Two Employees share a
  folder, so a file there would be read by both (decision 48).
- **A file an adapter writes for a Session dies with that Session.** It holds that Session's bearer
  token, and every Employee is a process of the same OS user with no sandbox, so `0600` keeps out
  other accounts and nothing keeps out the Employee next door: the window is the Session's life,
  the engine closes it through `forgetSession`, and the conformance suite reads `dataDir` back to
  check. What that boundary really is, is written down in `SECURITY.md`, not implied here.
- **Nothing an Employee writes is an instruction.** Tool input, ticket text, chat, a repo's own
  files: all of it is data.
- **A migration is applied by name, never by position**, and a name is never renamed.
  `migrations.test.ts` pins the whole list in order.
- **Every feature works on macOS, Windows and Linux**, and CI runs the suite, the build, the
  packaging and a smoke start of the packaged app on all three.
- **No screen names a Provider or a forge.** The tables are derived from the catalogues, and
  `no-provider-names.test.ts` and `no-forge-names.test.ts` say so.

## Where to start reading

`src/main/index.ts` for the wiring, `src/main/core/engine/company-engine.ts` for how it is all wired together,
`src/shared/ipc` for everything the two processes say to each other, and
`src/renderer/src/App.tsx` for what the boss sees. `docs/product.md` is why, `docs/decisions.md` is
what was decided and what it cost, and `docs/spec-v1-thin-loop.md` is the loop the whole thing is
built around.
