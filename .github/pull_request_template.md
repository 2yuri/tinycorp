<!--
The title is checked by a workflow: Conventional Commits, and the ticket is the scope.

    feat(T182): the office remembers where everyone was sitting
    fix(chat): a thread with one reply no longer shows two

Types: feat, fix, refactor, chore, docs, test, perf, build.
-->

## What this does

<!-- One paragraph. What changed, and why it needed to. Link the issue: `Closes #123`. -->

## How to see it

<!-- The steps a reviewer follows to watch it work — not the tests, the app. -->

## Checks

- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` are green, on top of a merged `origin/main`.
- [ ] Every commit is signed off (`git commit -s`). The DCO workflow checks this.
- [ ] **Tested on:** macOS · Windows · Linux — *(strike what you could not, and say so below)*
- [ ] A test that would have caught the bug, rather than a test that describes the code.
- [ ] Schema changes are a **named** migration appended to `src/main/core/engine/migrations.ts` — never a
      renamed or reordered one.
- [ ] The change points the way `ARCHITECTURE.md` says: every module is reached through its
      `index.ts`, and no new exception was argued into `src/architecture.test.ts`.
- [ ] Paths through `node:path`, CLIs through `cli-command.ts`, shell snippets written per platform.

### Screens

- [ ] No screen changed. *— or —*
- [ ] Screens changed: a capture of each, before and after, is attached to this pull request, and
      `pnpm design:compare` names the states that moved.

### If this adds a Provider or a forge

<!-- CONTRIBUTING.md holds the full lists. These are the ones a review is refused over. -->

- [ ] The adapter is in its own folder, and the conformance suite (`describeProviderConformance` /
      `describeForgeConformance`) runs from its own test file and is green.
- [ ] The catalogue entry and the one registry line, and the row in `docs/providers.md` /
      `docs/forges.md` — a test checks the table and the catalogue agree.
- [ ] No renderer file names it: the screens read the catalogue, and a test asserts that.
- [ ] **No API keys and no forge tokens.** A Session runs on the boss's own subscription login;
      TinyCorp never holds a forge credential.
- [ ] **No test that spends usage** and none that opens a real pull request — a real-CLI check is a
      `*.itest.ts` that skips itself without its credential.
- [ ] **No telemetry, and no network call the boss did not ask for.**
- [ ] **No `where`/`which`/`child_process` of your own** to find a CLI: `onPath` is the one answer.
- [ ] **No git of your own**, and nothing written into the Company folder beyond your hook file.
- [ ] A command rewrite (`commandRewriteHook`) per Session, or the method left out on purpose —
      never `rtk init -g`, which would edit the boss's own global agent config.

## What I left out, and what I had to decide

<!--
Anything out of scope, anything that stayed red, and anything the ticket did not settle that you
decided anyway. Say it here rather than burying it in the code.
-->

---

By opening this pull request I certify the [Developer Certificate of
Origin](https://developercertificate.org/): I wrote this, or I have the right to submit it under
this project's licence (Apache-2.0). That is what `git commit -s` records.
