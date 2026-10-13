# TinyCorp

A desktop orchestrator where a Company is a team of Employees, each a long-lived coding-agent session (Claude Code, Codex or OpenCode) on the user's subscription, shipping real code to real repos through a board, a chat and a pixel office. Start with `docs/product.md`, then `docs/decisions.md`, then `docs/spec-v1-thin-loop.md`.

`ARCHITECTURE.md` is the map — the modules, which way they are allowed to point, and the invariants
that hold everywhere; `docs/architecture/modules.md` says which file is in which module, and
`src/architecture.test.ts` checks both against every import in the repo. `docs/engineering.md` is
how the TypeScript inside a module is written: errors, parsing at the boundaries, naming, fakes,
and the rule that less code beats more. Load the `typescript-expert` skill when it is available, and tick
the checklist at the end of `docs/engineering.md` in every pull request.

## Commands

- `pnpm dev` boots the Electron app; `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest), `pnpm build`.
- Biome is the linter and the formatter, configured in `biome.jsonc`: `pnpm lint` (`biome ci .`, what
  CI runs on all three platforms) and `pnpm format` (`biome check --write .`). A rule that is off
  carries the reason beside it, or the ticket that turns it back on. lefthook runs the formatter on
  staged files at commit; typecheck and the suite stay out of the hook. The one formatting commit is
  in `.git-blame-ignore-revs` — `git config blame.ignoreRevsFile .git-blame-ignore-revs` once, and
  `git blame` walks past it.
- `pnpm knip` says what nothing imports: files, exports, dependencies. `knip.json` names every way
  into the repo, so a new entry point — a capture harness, a tool — is a line there too. CI runs it
  on Linux only. It runs with `--no-gitignore`, because knip reads `.git/info/exclude` as well —
  a file that belongs to the clone, not the repo — and a line of it silently took two `memory`
  folders out of the graph (T238); `src/knip-config.test.ts` keeps the flag and its reason together.
- The suite is three Vitest projects in one `vitest.config.ts`: `unit` (node), `dom` (jsdom) and
  `real` (`*.itest.ts`). A test that needs a document is named `*.dom.test.tsx`, which is how the
  config picks it — never a comment at the top of the file. `pnpm test` runs unit and dom;
  `pnpm test:coverage` adds coverage over `src/main` and `src/shared`, with no thresholds yet.
- `pnpm test:e2e` is the fourth tier: Playwright drives the built app (`out/main/index.js`) through
  the real screens, in a throwaway `userData` folder and Company folder under `os.tmpdir()`. The
  Provider is the suite's fake and nothing reaches the network, through `TINYCORP_E2E` — a variable
  a packaged build ignores, so there is no switch in a shipped app to flip (`src/main/app/e2e-mode.ts`).
  Specs live in `e2e/`; no screenshot comparisons, because fonts differ per OS and `design:compare`
  covers visuals. CI runs it on Linux only, under `xvfb-run`. CONTRIBUTING has the four tiers.
- `pnpm package` builds `release/TinyCorp.app` and a DMG (macOS arm64, unsigned); its configuration is `src/build/packaging.ts`, read through `electron-builder.config.mjs`.
- Layout: `src/main` (the machine in `src/main/platform`, the two seams in `src/main/providers` and `src/main/forges`, the composition root in `src/main/app`, and a folder per feature under `src/main/features`, each reached through its `index.ts`), `src/preload`, `src/renderer` (React), `src/shared` (types and the IPC contract; `src/shared/domain` is the vocabulary every module may name). A module with an `index.ts` is reached through it and never by naming a file inside it. `ARCHITECTURE.md` has the code map and where it is going, and a test fails if a document names a `src/` path that is not there.
- `pnpm test:claude` runs `src/**/*.itest.ts`: the spike v0 loop against a real `claude` on your subscription login (never an API key), and its Codex twin against a real `codex` on your ChatGPT login. Slow and spends usage; each is skipped without its credential. CI runs it on main and on demand (`.github/workflows/real-claude.yml`) with a `CLAUDE_CODE_OAUTH_TOKEN` secret from `claude setup-token`.
- Adding a Provider is one folder and two lines, and `pnpm provider:new <id>` writes all three: an entry in `src/shared/domain/providers.ts`, a folder `src/main/providers/<id>/` whose adapter runs `describeProviderConformance` from `src/main/providers/provider-conformance.ts` in its own test file, and one line in `src/main/providers/provider-registry.ts` (decisions 55, 56). `docs/providers.md` is the guide for someone who has never opened this repo, and `CONTRIBUTING.md` says what a Provider PR must and must not include. Nothing else lists the Providers: the UI and the engine derive their tables from the catalogue, and a test asserts no renderer file names one.
- Adding a forge — where a repo's pull requests live — is the same shape: an entry in `src/shared/forges/index.ts`, a folder `src/main/forges/<id>/` whose adapter runs `describeForgeConformance` from `src/main/forges/forge-conformance.ts`, and one line in `src/main/forges/forge-registry.ts`. Which forge a repo is on is read from its `origin`, per repo. `docs/forges.md` is the guide; a test asserts no renderer file names a forge, and a repo on a forge with no adapter works locally and says it can open no PR.
- `pnpm design:baseline` writes `design/baseline/<harness>/<state>.png`: every state of every
  capture harness, as the app draws it **today**. `pnpm design:compare` shoots them again and fails
  on any state over `COMPARE_FLOOR` (0.3%), printing a table and, for what moved,
  `docs/design-audit/baseline-moved.png` — baseline, now, and the two blended. It asks whether a
  screen looks like it did before the change, which is what a refactor that must not change pixels
  needs. Neither folder is in the repo (both are in `.gitignore`): shoot the baseline on `main`,
  switch to your branch, and compare. Adding a state is a row in `STATES` of
  `tools/design-baseline.mjs`. Every run prints a coverage table — one line per renderer folder
  with CSS, and the states that really drew each sheet — and refuses to write a baseline for a
  state that mounted nothing or shot differently twice.
- **Every editor and every diff is Monaco — VS Code's own (T222, T243).** `editor/monaco.ts`
  composes it from three pieces: the editor's contributions, the Monarch grammars, and the API. It
  leaves out the four language services, because the real language server already runs in the main
  process (T115). `src/renderer/src/editor` is a module of its own because two screens draw it —
  the Files view edits a file in `CodeEditor`, and both the Review screen and the Files view's
  Changes tab read a diff in `DiffEditor` — and its front door exports the two seams and plain data
  and never `monaco.ts`, because a barrel that named the editor would make every importer eager.
  Whichever seam is mounted first pulls the one lazy chunk and the other finds it there; the
  startup bundle holds neither, the way xterm and Pixi arrive since T211. Its worker is inlined by
  Vite and started from a `blob:` URL, which `worker-src 'self' blob:` in
  `main/app/window-policy.ts` is there for: Chromium will not start a worker from the `file:` URL a
  packaged renderer is served over, and nothing is ever fetched. Everything decided *about* the
  editors is plain data in `editor/monaco-model.ts`, `editor/monaco-theme.ts` and
  `editor/diff-model.ts`, which is what the tests read, because Monaco cannot run in jsdom;
  `files-view.dom.test.tsx` stubs the two lazy imports and nothing above them.
- **A diff is two whole files, never hunks (T243).** Monaco computes the change itself, so the
  engine answers `reviews.diff` with the file *list* — path, status, `+`/`−` — and
  `reviews.fileSides` with one file's two sides, read when the boss opens it and prefetched when
  they hover its row. A patch is cached in the main process against the commit it is of, not on a
  clock: `shared/review/diff-parse.ts` reads a patch for its file list and nothing else, and no
  `DiffHunk` or `DiffLine` crosses IPC any more.
- **The diff's layout is a width until the boss chooses, and a thread spans all of it (T244).**
  A pane narrower than `SPLIT_MIN_WIDTH` (900px, Monaco's own breakpoint) opens inline, because two
  columns of 560px are 250px a side; pressing the toggle is a choice, and a choice is remembered and
  honoured at every width. A thread is **not** drawn inside the view zone: the zone reserves the
  height and the thread hangs in a layer over the whole diff, moved by the zone's own `onDomNodeTop`,
  because a view zone belongs to one editor and in side by side that is half the width, clipped.
  The `review-threads-split` state of `pnpm design:baseline` is the shot that says it still spans both.
- **A logo belonging to somebody else is a vendored file, never a package (T246).** The marks the
  app draws beside a Provider or an MCP preset are individual SVGs copied unmodified from LobeHub
  Icons (MIT) and Simple Icons (CC0) into `src/renderer/src/ui/logos/`, licence text beside them
  and an entry in `NOTICE`; neither set is a dependency. A catalogue entry names its own file and
  an entry that names none keeps its generic mark, so adding a Provider is still one folder and two
  lines. `logo-assets.ts` globs the folder rather than importing by name, because the renderer may
  write down no product; a `-color` file is the set's colour variant and is never filtered, while a
  monochrome one is inverted under the dark theme and only there, because this app's `:root` is
  Dark and those marks are published black. `logos.test.ts` fails on a name with no file, on a file
  no catalogue names, and on a name whose contents say the other variant. `docs/brand-logos.md` is
  the guide.
- **A screen reads the engine through `src/renderer/src/ipc`, never `window.tinyCorp` directly**
  (T212): one store per channel with one subscription however many components read it, a catalogue
  of the channels in `resources.ts`, and one `company.onChanged` for the whole renderer that drops
  an answer arriving after a Company switch. A new channel is one `const` there and one row in
  `resources.dom.test.ts`'s table. `docs/engineering.md` → "How a screen reads the engine".
- **The renderer is written in Tailwind v4, and there is no CSS left (T216).** Every screen and
  every kit component states its own styling as utilities on the element it draws; `pnpm dev`
  compiles one stylesheet and `find src/renderer -name '*.css'` lists two files —
  `ui/tailwind.css`, the setup, and `ui/tokens.css`, the custom properties it reads and the Dark
  values each of them takes. `ui/stylesheets.test.ts` fails on a third. A screen with more than one
  tab keeps the vocabulary they share in a module of its own — `settings/settings-classes.ts`,
  `repositories/repo-classes.ts` — named in `@source` like any other.
  `ui/tailwind.css` is the whole of the setup: the utilities layer only, so preflight never reaches
  another screen; the document defaults in `@layer base`, and no class rule at all; every
  token as `@theme inline`; and one `@source` line per folder or file that writes a class. It is
  compiled by `electron.vite.config.ts` and by the capture config of every folder. One screen per
  folder imports `ui/tailwind.css`, and so does every kit component and any component another
  folder draws — the evidence card in chat, the Review button, the diff in the Files view — because
  a bundle only holds what its own entry reaches. A capture harness missing it renders its screen
  unstyled, which is the one drift `design:compare` cannot see past.
- **`cx` is `tailwind-merge`, configured for our theme (T216).** The kit writes `gap-8` on its own
  element and a screen writes `gap-6` on the same one; both are one class in `@layer utilities` with
  the same specificity, so Tailwind's sort order would decide it rather than the caller.
  `cx(kitClasses, className)` puts the caller last and `tailwind-merge` drops what it replaces.
  **It has to be told our scales or it unties the wrong ones**: our type scale is custom, so an
  unconfigured `tailwind-merge` reads `text-13` as a colour and drops it beside `text-foreground`.
  The four scales are in `ui/kit/cx.ts` and `cx.test.ts` pins each against the keys `tailwind.css`
  really declares. Kit variants are `class-variance-authority` tables — size, tone, state — in place
  of BEM modifiers.
- **A kit component's parts are `data-slot`, and that is what a screen reaches for.** `data-slot`
  and `data-variant` / `data-size` / `data-tone` / `data-error` are on the element, the way
  shadcn/ui does it, so a screen adjusts a part with `[&_[data-slot=field-control]]:h-36` — a
  two-part selector, which beats the component's own one-class utility on specificity. A screen
  that adjusts the padding of a control adjusts its `focus-within` padding too, because there the
  two weigh the same. What a whole component takes goes through `className` and `cx` settles it;
  what no selector can reach is a prop, as `Select`'s `lead` is. A test reads `data-slot`, never a
  class list.
- **One cascade order, declared once, in `src/renderer/src/ui/tailwind.css` (T208, T216):**
  `@layer theme, base, utilities;`. `theme` is Tailwind's, empty while every key is `inline`;
  `base` is the document defaults and declares no class — a shared reset is a class list instead
  (`SHELL_BUTTON`, `CHOICE_INPUT` in `ui/kit/resets.ts`), passed through `cx`; `utilities` is last,
  so one class beats the reset under it without `!`. The `kit` and `screens` layers went with the
  sheets that were in them. `ui/tokens.css` is in no layer: it declares the tokens, including the
  type scale (`--type-11-5` is 11.5px on a 17px line), and nothing competes with it.
  `src/renderer/src/ui/tailwind.test.ts` compiles the real setup and fails on the three things
  Tailwind does silently: a missing theme key, a theme key that maps to itself, and a class whose
  source text is not what React writes. `docs/engineering.md` → "How we style" is the guide.
- Engine tests use `inMemoryDatabases()` / `inMemoryRecents()` from `src/main/core/testing.ts`. A
  fixture that names a path writes it POSIX and wraps it in `onDisk()` from the same file, so the
  test says the same thing on the Windows runner; `removeFolder()` is how a temp folder goes away
  where something may still hold a handle on it.
- `pnpm package:win` builds the Windows installer from either host, `pnpm package:linux` builds an
  AppImage and a `.deb` on a Linux host (where node-pty is compiled against Electron), and
  `node tools/smoke-packaged.mjs` starts what came out of any of them: no Company, one window,
  exit 0. CI has one job per platform — `ubuntu-latest`, `macos-latest`, `windows-latest` — and
  each runs the suite, the build, the packaging and that smoke run. `docs/linux.md` is the Linux
  guide, `docs/windows.md` the Windows one.
- The Company memory is a git-backed markdown wiki in `<company folder>/memory/company`, read and
  written by every Employee through MCP and by the boss in the Memory screen; the SQLite index is
  derived and rebuilds from the files. Nothing in it is written by a model. See `docs/company-memory.md`.
- An Employee's **own** notes are separate and private: an append-only log at
  `<company folder>/memory/<employee id>/log`, one note per line and at most 280 bytes each, with a
  rebuildable cache of summaries in `tree/` beside it (T193, after OptMem — credited in `NOTICE`).
  Nothing in it is ever edited or deleted. A Session reads the whole history at start inside a
  budget the boss sets per Company — Company settings → Tokens — because the newest notes go in word
  for word and everything older as summaries that double their reach going back. `docs/company-memory.md`
  has the tools and the file format.
- **Add-ons are optional ways of working, off until the boss turns one on** (Company settings →
  Add-ons, T194). Each one is an entry in a searchable list that says what it does, where it came
  from and what `pnpm bench:tokens` measured for it; the first is **Lean builder**, ponytail's
  ladder in our words (MIT, credited in `NOTICE`), which adds one section to every Employee's
  instructions. The setting is `buildStyle` in `src/shared/build-style.ts`, read at every spawn, so
  turning it off takes at the next Session and never mid-turn. A new add-on is one more entry, its
  own setting, and a benchmarked number — never a claim.
- **The second add-on is Caveman** (T261): Employees answer *the boss* in few words, at one of
  three intensities, and never each other — a colleague DM is the colleague voice's business (T180).
  Code, commands, paths, errors, ids, numbers and a security warning go through word for word, and
  commits, pull requests, plans and ticket text stay in full sentences. The setting is `caveman` in
  `src/shared/caveman.ts` and the section is one function there; the idea is caveman's, taken in our
  own words and credited in `NOTICE` — its engine and proxy are BSL-1.1 and nothing of either is
  here. **It ships with its toggle disabled**, because `CAVEMAN_MEASURED` is null until
  `pnpm bench:tokens --mode boss` has been run: that is "no token claim ships unmeasured" with a
  switch on it rather than a promise.
- **The third add-on is Sandbox** (T260): every Employee's Session runs inside
  [ai-jail](https://github.com/akitaonrails/ai-jail) — a fresh home each launch, its worktrees
  writable, its Session config read-only, its Provider login mounted, and the boss's own home
  unreachable. ai-jail is **GPL-3.0-only**, so TinyCorp finds it on the runtime's `PATH` and runs
  it, and never vendors, bundles or installs it. The setting is `sandbox` in
  `src/shared/sandbox/index.ts`; the jail is put around a Session in
  `src/main/platform/sandbox-runtime.ts`, below every adapter and **outside** the WSL wrap, so
  ai-jail runs inside the distro — the only place on a Windows it runs at all. **The network stays
  open and the card says why**: ai-jail's filtered egress cannot reach this computer's loopback, so
  it cannot reach TinyCorp's hook receiver or Company MCP server, and the add-on guards the files
  rather than implying a filtering it does not do. `docs/sandbox.md` has the evidence and the one
  upstream flag that would unlock the other half.
- **Five settings are read once at an Employee's spawn, and the cards say so**
  (T237, T260, T261): the colleague voice, the notes budget, the build style, Caveman and the
  Sandbox add-on — `src/shared/spawn-settings.ts` names them. The first four are written into the
  instructions; Sandbox changes the command the Session is started with, and belongs in the list
  for the same reason. Each card carries *Applies from each Employee's next Session*, who is still on the old
  one, and **Apply now**, which restarts every *idle* Session where it stands (`--resume`, fresh
  instructions) and waits for the turn of every busy one. A setting that changes what a Session is
  told at spawn belongs in that list; one the engine reads when it is used — who tests before a
  merge, the concurrency cap — does not.
- Most of what an Employee reads is command output, and [RTK](https://github.com/rtk-ai/rtk)
  filters it before the Employee reads it (T179). It is found on `PATH`, never installed by
  TinyCorp, and hooked **per Session** into the config each adapter already writes — never through
  `rtk init -g`, which would edit the boss's own global agent config. A Provider answers
  `commandRewriteHook` or says it rewrites nothing; `docs/providers.md#rewrite` is the contract, and
  Company settings → Tokens is the boss's side of it.
- **No token claim ships unmeasured.** `pnpm bench:tokens` runs real Claude Code sessions on a
  pinned real repo, one arm at a time — baseline, RTK, the terse voice, ponytail's ladder — and
  writes `tools/bench/results/<date>-<model>[-<mode>].md`: medians with interquartile ranges, as a
  percentage of baseline, where above 100 means the arm spent *more*. `--dry-run` is free and a real
  run needs `--yes`; it spends the subscription, takes `--budget <usd>` for the whole run, and
  refuses outright when `ANTHROPIC_API_KEY` is set. Every cell's isolation is checked against its own
  transcript, because a benchmark whose baseline secretly runs the treatment is the one failure this
  whole tool exists to avoid. **The shape of the run is the measurement**: `--mode long` is one
  Employee working three tickets with the suite and `git diff` between them, which is where RTK's
  filtering happens at all, and `--mode duo` is two Employees coordinating one ticket over a real DM
  thread, which is where the terse voice is paid for (T197). A number measured in the wrong shape is
  the first round's mistake, not a result. See `docs/bench-tokens.md`.
- Schema changes are named migrations: a feature declares its own `Migration` beside the code that reads the tables it makes, and the step is appended to the list in `src/main/core/engine/migrations.ts`. `database.ts` is the runner and imports no feature. The runner applies by name, never by position; names are unique and never renamed, and `migrations.test.ts` pins the whole list.

## Pull requests

- **The title is Conventional Commits, and the scope is the ticket:** `feat(T182): the office
  remembers where everyone was sitting`. The types are `feat`, `fix`, `refactor`, `chore`, `docs`,
  `test`, `perf` and `build`; the subject starts lower case and says what the change does. A workflow
  (`.github/workflows/pr-title.yml`) fails the pull request and comments when it does not, and the
  release notes are generated from these titles, so a wrong type is a wrong release.
- **Every commit is signed off** — `git commit -s`, the DCO. There is no CLA, and the `DCO` workflow
  names any commit that is missing the line. `git rebase --signoff origin/main` fixes a branch.
- **A move is a pure `git mv` commit.** Renames in one commit, the import rewrites and edits in the
  next; never the two together, or the history of the file is gone.
- `.github/pull_request_template.md` is the checklist a review actually runs through: the three
  green commands, which platforms it was tested on, the Pen frame behind any changed screen, and —
  for a Provider or a forge — the must / must-not lists from `CONTRIBUTING.md`. Fill it in rather
  than deleting it, and say in it what you left out and what the ticket did not settle.

## Platforms

Every change works on **macOS, Windows and Linux** — designed that way from the start, not ported later.

- Paths through `node:path` (`join`, `delimiter`, `isAbsolutePath` in `src/shared/platform/absolute-path.ts`), never `'/'` or `':'` by hand; compare folders through the native realpath. Temp folders from `os.tmpdir()`.
- CLIs and child processes through `src/main/platform/cli-command.ts` (PATHEXT, `.cmd` shims), never a bare `spawn('name')`. Shell snippets are written per platform (POSIX sh, PowerShell, `cmd.exe`), as `hookCommand` does.
- Secrets through one store with one backend per platform (`src/main/platform/safe-storage-secrets.ts`): the macOS keychain, Electron `safeStorage` on Windows (DPAPI) and Linux (libsecret), never a file in the Company folder. A desktop where `safeStorage` would not really encrypt is refused out loud rather than pretended at. A Mac-only affordance (Touch ID, the menu bar extra, traffic lights, `Cmd`) has a stated equivalent or fallback elsewhere, and the UI says `Ctrl` where it means it — and never names a keychain on a machine that has a keyring. Every word that names the machine — *this Mac*, *Reveal in Finder*, *the keychain*, `Cmd` — is `machineWords(platform)` in `src/shared/platform/machine-words.ts` (T265), and `no-mac-words.test.ts` fails on one written anywhere else under `src/renderer` or `src/shared`.
- WSL is a place a Provider can run (T167): anything that spawns a Provider goes through the runtime layer, and paths crossing into it are translated.
- CI runs the suite, the build, the packaging and a smoke start of the packaged app on Ubuntu, Windows and macOS; a test that only passes on one of them is a bug in the test or the code.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `2yuri/tinycorp`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root and `docs/adr/` for decisions, both created lazily. See `docs/agents/domain.md`.
