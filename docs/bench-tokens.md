# `pnpm bench:tokens` — measuring before claiming

TinyCorp claims token savings. RTK filters what an Employee reads (T179), the terse colleague voice
cuts what Employees write to each other (T180), and an "engineering style" may one day ship a
ladder like [ponytail](https://github.com/DietrichGebert/ponytail)'s. Until this ticket none of it
was measured, and the one benchmark anybody had run in this space found that a terse-prose skill
made whole agent sessions spend **7% more** tokens, not fewer.

So: measure first, claim second, and never round a loss into a win.

```bash
pnpm bench:tokens --dry-run                        # the plan and what it will spend. Costs nothing.
pnpm bench:tokens --yes --n 2                      # a real run: every arm, every ticket, Sonnet
pnpm bench:tokens --mode long --yes --budget 20    # RTK where commands happen (T197)
pnpm bench:tokens --mode duo  --yes --budget 12    # the terse voice where DMs happen (T197)
pnpm bench:tokens --mode boss --yes --budget 8     # Caveman where the boss is reading (T261)
```

Results land in `tools/bench/results/<date>-<model>.md` with the raw JSONL beside them.

## What it does

One **cell** is one unit of work in its own fresh copy of a real repo, measured end to end: the
tokens it moved, what it cost, what it changed and whether the suite still passes. A run is every
unit × every arm × `--n` repeats, and the report is medians per arm as a percentage of the arm
everything is compared against.

A cell is not a process. What it is depends on the **shape** of the run, and the shape matters more
than any of the arms:

| `--mode` | one cell is | the arms | what it can answer |
|---|---|---|---|
| `solo` (default) | one cold session, one ticket | `baseline`, `rtk`, `terse-voice`, `ponytail`, `rtk+ponytail` | what an arm costs on a cold session (T190) |
| `long` | **one** session resumed through six legs: three tickets, and a checkpoint after each that runs the whole suite, the whole `git diff` and `git log` | `baseline`, `rtk` | what RTK does where command output actually happens (T197) |
| `duo` | **two** Employees working one ticket, talking through a real DM thread | `dm-plain`, `dm-terse` | what the terse voice costs and saves on the messages it is about (T197) |
| `boss` | **one** Employee working one ticket, reporting to a scripted boss over a DM thread | `boss-plain`, `caveman` | what Caveman costs and saves on the messages it is about, and whether the answers still say it (T261) |

The first round measured only `solo`, and its two headline numbers were both about that: RTK spent
26% more tokens having filtered 385 commands, and the terse voice spent 12% more having written no
DM at all. Neither is wrong; both are answers to a question nobody is asking of the app, which runs
long-lived Employees that spend hours running commands and DMing each other. `--mode long` and
`--mode duo` are those two questions, and each of them is priced and guarded like the first.

### The arms

| arm | what it adds |
|---|---|
| `baseline` | nothing |
| `rtk` | RTK's `PreToolUse` command rewrite, hooked through a per-run `--settings` file |
| `terse-voice` | TinyCorp's *Between Employees* section (T180), prepended to the system prompt |
| `ponytail` | ponytail's `SKILL.md` (MIT, vendored in `tools/bench/vendor/ponytail/`), prepended |
| `rtk+ponytail` | both |
| `dm-plain` | the app's *How you write* section alone (`duo` only) |
| `dm-terse` | *How you write* **and** *Between Employees* — what the Company toggle really adds (`duo` only) |
| `boss-plain` | the app's *How you write* section alone (`boss` only) |
| `caveman` | *How you write* **and** *How you answer the boss* at Full — what that toggle really adds (`boss` only) |

Every arm gets the same shared rules on top of its own text, so two arms differ by exactly one
thing. `tools/bench/arms.test.ts` asserts that, including that the `terse-voice` file is still word
for word the `TERSE_RULES` the app actually sends, that `arms/plain-voice.md` is still `PLAIN_RULES`,
and that `dm-terse` is `dm-plain` plus exactly the Between Employees section — the bench measuring a
voice the repo no longer ships would be worse than not measuring it.

An arm belongs to the modes it means something in, and asking for one outside them is refused rather
than run: `--mode long --arms terse-voice` would produce a number with no baseline behind it.

### The long session (`--mode long`)

One `--session-id`, resumed six times: ticket, checkpoint, ticket, checkpoint, ticket, checkpoint.
The three tickets are `discussion-count`, `search-discussions` and `sort-users`, in that order, and
every checkpoint is the same words — run `npx vitest run`, `git --no-pager diff` and
`git --no-pager log --oneline -20`, fix the suite if it is red, then say in two lines where the work
is. The diff grows with every ticket, which is the point: that is the command output RTK exists to
filter, and the first round never generated any.

The report adds a **per-leg** table, so a checkpoint is read apart from the ticket before it.

### The two Employees (`--mode duo`)

Two sessions, one ticket (`edit-comment`), and a DM thread between them. `Ada` holds the ticket;
`Vega` knows the codebase, answers questions and reviews the diff without editing anything. The lead
is woken with the ticket; every DM either of them posts wakes the other with the app's own
`inboxPrompt` shape, including the clause that names the voice for that one message — in TinyCorp the
engine decides the voice and the model never judges its own audience (T180), so here the arm decides
it and the wake says it. Five wakes a cell at most, which is a cost guard as much as a protocol.

The chat is a **stand-in**: `tools/bench/dm-mcp.mjs`, an MCP server over one JSONL file, registered
under the name the app registers its own Company server under, so an Employee calls
`mcp__company__chat_post` here exactly as it does in the app. Its tool descriptions are word for word
the app's, minus the sentences about things it does not have (attachments, pins, a topic), and
`dm-mcp.test.ts` starts it as a real process and passes a DM between both Employees' ends. The real
server needs an Electron main process, a Company folder, SQLite and two live Sessions to wake; what
the bench needs from it is what the Employee reads and writes.

The report adds **the two Employees** (what each spent, how many wakes, whether the ticket landed)
and **the DM thread** (messages, characters, words, an estimate in tokens, and that estimate doubled,
because every DM is paid once by the Employee that writes it and once by the one woken with it).

### The boss's side (`--mode boss`)

One session, one ticket (`edit-comment`), and a DM thread with the boss at the other end of it. The
Employee is told to report twice — before it writes code, and when the change is ready — and after
each message it sends, **the boss asks the next of three fixed questions**: which files, did the
suite pass and how many tests, anything needed before this is closed out. Every cell of every arm is
asked the same three in the same words, because a boss that answered a fragment differently from a
paragraph would make the arms differ by their own input as well as by the section under test. The
boss is a script, not a session: nothing here starts a second agent.

It is a mode of its own rather than a reuse of `duo` because **the shape is the measurement**. Every
message in a `duo` cell is a colleague message, which is the one place Caveman is forbidden to
reach; there are no boss-facing messages in that transcript to isolate, so a number measured there
would be a number about nothing.

The chat is the same stand-in `duo` uses, with `BENCH_DM_PEER=boss`, so `chat_post` to `@boss` lands
in the thread the harness reads. Each wake carries `voiceHint`'s own boss clause — *The boss can read
this → plain words, full sentences.* — word for word and identically in both arms, because that
clause is what the add-on's own section has to settle rather than what the arms differ by.

The report adds **what the boss was sent** (the Employee's messages only, in characters, words and
an estimate in tokens, beside what the whole session spent) and **whether the answers still said it**
— every question that was put, and whether the reply carried the fact asked for. That second table
is what stops a saving from being bought with an answer that says nothing: a keyword check for a
path, a digit and a yes or no, never a review of the answer, and a question that drew no reply counts
as wrong so an arm cannot score better by answering less.

### The fixture

`alan2207/bulletproof-react`, the `apps/react-vite` app, pinned at a commit. A real TypeScript
React application: 130 source files, a mocked API, and its own vitest suite that runs offline in
five seconds.

It is cloned and installed **once** into a cache under `os.tmpdir()`, and each cell gets a fresh
copy of the working tree with its own `git init` and a link to that one `node_modules`. Nothing an
agent writes reaches another cell. The one thing cells share is the installed tree, so every cell
checks it is unchanged afterwards and says so in the report if it is not.

### The tickets

Eight, in `tools/bench/tasks/*.md`, of mixed size and each written as a one-line ticket so the
agent chooses how much to build. Two carry an over-build trap on purpose — a **date picker** (where
`<input type="date">` will do) and a **CSV export** (where `join` will do) — because that is where a
ladder like ponytail's should show up if it shows up anywhere.

### What is measured, per cell

- input, output, cache-read and cache-write tokens, and cost, from the CLI's own result JSON;
- wall time and turns;
- `git diff --numstat` lines added and removed, lockfiles and generated files excluded;
- whether the fixture's own suite still passes;
- for the RTK arms, `rtk gain` against that cell's own `RTK_DB_PATH`.

## Isolation, and why it is the important part

`claude -p` is started with `--setting-sources project,local` and `--strict-mcp-config`, so the
boss's own settings, hooks, plugins, skills and MCP servers are not in the session. This is exactly
the bug that made ponytail's first agentic benchmark publish a number its authors later withdrew:
the plugin under test had a `SessionStart` hook that fired on *every* arm, so the baseline was
secretly running the treatment.

A flag is a claim until something checks it. After every cell the harness reads back the transcript
Claude Code wrote for that session and fails the cell when:

- a hook fired that the arm does not declare (`baseline` declares none; the RTK arms declare
  `PreToolUse:Bash`);
- an MCP server was called that the arm does not declare (only the `duo` and `boss` arms declare one, the
  stand-in chat server; every other arm reaching any server at all is a contaminated cell);
- a skill came from a plugin;
- the system prompt is missing the arm's own text, or holds another arm's;
- no transcript was written at all — a cell whose isolation was never checked is not a cell whose
  isolation passed.

A `duo` cell has two transcripts and both are checked, with the Employee named in any breach. A
`long` cell has one for all six legs, because the legs are one session.

Where one arm's text contains another's on purpose — `rtk+ponytail` is `ponytail` plus a hook,
`dm-terse` is `dm-plain` plus a section — finding it proves nothing either way, so the check looks
only for a text the arm's own does not already contain.

Contaminated cells are named in the results file rather than quietly averaged in.

## Cost guard

- `--dry-run` prints the plan and an estimate and spends nothing.
- A real run needs `--yes`.
- `--budget <usd>` stops the run before the cell that would pass it, and the results file says it
  stopped. The per-cell `--max-budget-usd` stops one runaway session; this stops a run. They are
  different guards, and the first round needed the second one it did not have: it finished at $55.
- It spends the boss's Claude subscription. If `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is
  set, the run **refuses** rather than unsetting it: a key that is there is a machine configured for
  something else, and which of the two was meant is the boss's call. The key is also stripped from
  every cell's environment.
- Each cell carries `--max-budget-usd`, so one runaway session stops instead of finishing the run.

## Flags

| flag | default | |
|---|---|---|
| `--mode` | `solo` | `solo`, `long`, `duo` or `boss` — what one cell is |
| `--budget` | none | what the whole run may spend before it stops |
| `--model` | `sonnet` | pinned to a model id, not an alias |
| `--n` | `3` | repeats per task and arm |
| `--arms` | all | comma-separated |
| `--tasks` | all | comma-separated task ids |
| `--workers` | `1` | cells at a time |
| `--out` | `results/<date>-<model>.md` | |
| `--keep` | off | keep each cell's workspace for inspection |
| `--dry-run` / `--yes` | | see above |
| `--rescore <run dir>` | | re-read a finished run and report it again, offline |

`--rescore` is there because a measurement bug found halfway through a run is otherwise a bill for
a second run. It re-reads `cells.jsonl` from a run folder, recomputes the isolation checks from the
transcripts those sessions wrote, and writes the results file again under the date the run actually
happened. The first real run of this bench needed it: the isolation check was calling `ponytail` and
`rtk+ponytail` contaminated for sharing a text on purpose.

## Reading a results file

Every number is a **median** with an interquartile range beside it, never a mean alone: three agent
sessions on one ticket can differ by more than any of the gaps in these tables, and a gap smaller
than the spread is not a result. The `%` columns are percentages of baseline, so **above 100 means
the arm spent more** — the report has no branch that treats that case differently.

Read the limitations section. It is not boilerplate: one ticket per cold session is the worst case
for an arm that adds text to a system prompt and the best case for one that changes behaviour every
turn, and TinyCorp's Employees are long-lived sessions where neither holds.

## Cross-platform

Node only, no shell scripts. Paths through `node:path`, `claude` and `rtk` found by the same
`PATH` × `PATHEXT` walk `src/main/platform/cli-command.ts` uses, `node_modules` linked with a junction
on Windows, and `npx` rather than a path into `node_modules/.bin`. It has been run on macOS; the
Windows and Linux paths are written but not yet exercised.

## Adding to it

- A ticket is a file in `tools/bench/tasks/` with `id`, `size` and `trap` in its front matter.
- An arm is an entry in `ARMS` in `tools/bench/arms.mjs`; it declares every hook it writes, every
  MCP server it reaches, and the modes it means anything in.
- A fixture is a row in `FIXTURES` in `tools/bench/fixture.mjs`, pinned by a full commit sha.
- A shape of run is a row in `MODES` in `tools/bench/plan.mjs`: what a cell of it works, what it is
  priced at, and a runner that hands back one part per `claude` process it started.
