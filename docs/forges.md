# Adding a forge

TinyCorp's Employees ship real code to real repos. A ticket gets a worktree, a branch and commits,
and when it reaches Review the app opens a **pull request** into the repo's base branch.

Where that pull request lives is the **forge**. GitHub is one. GitLab is one. Azure DevOps,
Bitbucket, Gitea, a self-hosted Forgejo — each is one, and a Company can hold repos on several at
once, because a person with ten repos does not get to choose where their employer hosts them.

Which forge a repo is on is not a setting. It is a fact about the repo's `origin`, read from the
remote when the repo is attached, and shown on the repo card.

This page is how to add one, from a cold start, without reading the engine. The shape of the work:
one folder, two lines, one file to fill in — the same as [`docs/providers.md`](providers.md), for
the other seam.

---

## 1. What a forge is here

A forge is a **product that hosts pull requests**. TinyCorp does not call its API and holds no
token for it: it drives the forge's own command line, the one the boss is already signed into, the
way a person would. `gh` for GitHub. `glab` for GitLab. Whatever yours ships.

So a forge is worth writing an adapter for when its CLI can do six things:

| It must | Because |
| --- | --- |
| **Open a pull request** for a branch that is already pushed | That is the whole point: the app pushes with git, and the forge turns the branch into a change someone can review |
| **Find the pull request a branch already has** | A ticket goes back to Doing and returns to Review; the second attempt must land on the PR that is open, never open a second one |
| **Read a pull request's state** — its size, whether it merges cleanly, what CI said | The review screen draws it, and the merge gate refuses a red one |
| **Read its whole change as a patch** | The boss reads the diff inside TinyCorp and comments on its lines; a rendered web page is not a diff |
| **Comment**, on the pull request and on one line of its head | A review TinyCorp ran says what it found where the change is |
| **Merge** it | The last step of a ticket, behind the Company's autonomy level and the merge gate — never a decision the adapter makes |

A CLI that cannot do one of these is worth saying so in the pull request rather than faking it. A
repo on a forge with no adapter still works for everything local — worktrees, branches, diffs, a
local merge — and says, in words, that the pull request is the boss's to open. That is a good
outcome. An adapter that pretends is not.

---

## 2. What TinyCorp requires of one

These are not style points. A pull request that breaks one of them is refused.

### Authentication is the CLI's

TinyCorp never holds a forge token. It never reads one out of the environment, never writes one
into a config of its own, never passes one as an argument — `ps` shows every argument of every
process on the Mac to everyone on it — and never asks the boss for one.

The boss signs in once with the CLI's own command (`gh auth login`, `glab auth login`), and the
adapter runs that CLI. That is the entire authentication story, and the conformance suite checks
it: a check watches every command an adapter runs and fails it for anything that looks like a
credential.

### The adapter decides nothing

An adapter that can merge is not an adapter that may. Whether a pull request may be opened at all,
and whether it may be merged, is decided before the adapter is called — by the Company's autonomy
level, the `merge` approval and the merge gate (decision 44). An adapter that checks a policy, or
skips one, is wrong in both directions.

### No adapter touches git

The worktree, the branch, the commits, the push and the local merge are the engine's. By the time
`openPullRequest` is called the branch is already pushed. An adapter that shells out to `git` is
doing somebody else's job, and the suite fails it for that.

### No test may touch a network or a real repository

`pnpm test` opens no pull request, reads no repository and signs into nothing. The conformance
suite hands your adapter a **fake CLI**, which you write, and reads back what it did.

### Nothing phones home

No telemetry, no analytics, no version ping. The adapter's only traffic is the forge's own work:
opening, reading, commenting on and merging pull requests.

That includes the CLI's habits. Some CLIs report usage to their own servers, or check for a new
release, on every command they run — `glab` does both by default. Find the switches that turn
those off (usually environment variables: the CLI's docs, or `<cli> config --help`) and lay them
over every command through `env` (see [the runner](#the-runner-and-the-path)). Never change the
boss's own CLI config to do it: the boss uses the same CLI in a terminal.

---

## 3. The `ForgeAdapter` contract

`src/shared/forges/adapter.ts` is the interface; `src/main/forges/forge-conformance.ts` is the
same contract as a test suite, and every failure says which part below it belongs to. The contract
is in `shared` rather than beside the adapters because git talks to a forge through it and the
machine sits below the forge seam, so `main/platform/git-service.ts` names it too (T186a).

### `open`

```ts
openPullRequest(request: { cwd, branch, base, title, body }): Promise<{ url, number }>
```

Opens a pull request from `branch` into `base`, from the checkout in `cwd` — every forge CLI reads
the repo from the folder it runs in, so run it there and nowhere else. The branch is already
pushed. Answer the URL, and the number when the forge's URLs carry one (null when they do not; the
board draws the URL instead).

The URL is the only handle the engine keeps: every later call — read, diff, comment, merge — is
handed it back. If your CLI needs more than the URL to act on a pull request (a project path, a
repository id), read it out of the URL rather than asking for it; and tell the suite what your
URLs look like with `url` (step 4), or its world hands you GitHub-shaped ones.

A branch that already has an open pull request must **end on that pull request**. Either answer it
here, or fail in a way `findPullRequest` can recover — most CLIs refuse a duplicate in their own
words, and unpicking those words is not your job.

### `find`

```ts
findPullRequest(request: { cwd, branch }): Promise<{ url, number } | null>
```

The open pull request for `branch`, or `null` when it has none. `null` is an answer, not an error:
the engine asks this whenever opening one fails.

### `read`

```ts
readPullRequest(request: { cwd, url }): Promise<PullRequestView>
```

What the forge says about the pull request right now: its title, whether it is open, merged or
closed, its head and base, how many lines and files it changes, whether it merges cleanly, and
every check with its state and duration. Fields the forge does not report are left empty — never
invented. This is one read: the CI state the merge gate uses is taken from the checks in it, so no
forge is ever asked twice.

A pull request that cannot be read **throws**, carrying the CLI's own sentence: that sentence is
what the boss reads in the drawer and in `#prs`. Strip what the CLI draws around it for a terminal
(banners, colours, padding) — `forgeFailure` in `shared/forges/adapter.ts` writes the rest of the sentence.
A CLI that answers "not found" with a successful, empty answer (GraphQL does) is still a failure:
throw one in your own words.

`PullRequestView` and its words are in `src/shared/code/index.ts`. Every forge has richer states than
the contract; translate into the contract's, and keep your forge's words inside your folder:

| Field | Means | When your forge says more |
| --- | --- | --- |
| `state` | `open`, `merged` or `closed` | A pull request the forge is merging right now is still `open` |
| `mergeable` | `mergeable`, `conflicting` or `unknown`: **whether it merges cleanly**, which is a question about conflicts | Approvals, drafts, required pipelines and unresolved threads are the forge's policy, not conflicts: read them as `mergeable`. Whether TinyCorp may merge is the merge gate's question, and the forge says its policy again if a merge is tried. `unknown` is only for "still computing" |
| `checks[].name` | The check, e.g. `build` | |
| `checks[].workflow` | What groups it, e.g. the workflow on GitHub or the stage on GitLab; empty for a plain commit status | |
| `checks[].state` | `passing`, `failing`, `pending` or `skipped` | A failure the forge does not count against the change (allowed to fail, neutral) is `skipped`. Cancelled is `failing`. Anything still waiting — queued, running, a manual step the pipeline is blocked on — is `pending` |
| `checks[].durationMs` | Start to finish | `null` while it runs, and when the forge does not say |
| `additions`, `deletions`, `changedFiles` | The size | `0` when the forge does not report it — never counted by hand from the patch |

### `diff`

```ts
readDiff(request: { cwd, url }): Promise<string>
```

The whole change as a unified patch — what `git diff --patch` would print. The review parses it and
the boss comments on its line numbers, so ask the CLI for a patch rather than a rendered page, and
hand it back untouched: no trimming, no truncating, no re-wrapping. Patches are large; the runner
already allows for that.

### `comment`

```ts
comment(request: { cwd, url, body }): Promise<void>
commentOnLine(request: { cwd, url, path, line, body }): Promise<string | null>
```

The first comments on the pull request. The second comments on one line of its head, under the
pull request's review comments, and answers the new comment's URL so the app can link to it — or
`null` when the forge gives none.

A comment on the whole pull request is TinyCorp's summary of a review, not a question: where the
forge can make a comment that does not block merging (GitLab's threads do, when a project requires
every thread resolved), make that one.

### `review`

```ts
postReview?(request: { cwd, url, summary, verdict, threads }): Promise<ForgeReview>
replyToThread?(request: { cwd, url, threadId, body }): Promise<string | null>
resolveThread?(request: { cwd, url, threadId }): Promise<void>
```

TinyCorp's agents review each other on the pull request itself (T170): the reviewer opens a thread
on a line, the assignee answers it — with the commit that fixed it, or with a reason not to — and
the reviewer resolves it or leaves it as a note. One **round** of that conversation goes up as
**one review**, never as a scatter of comments posted one at a time, so the boss opens the pull
request and reads a review.

`postReview` answers one entry per thread it was given, **in the same order**, each with the id
this adapter will recognise again; the engine pairs them by position and stores the id as text.
`replyToThread` and `resolveThread` are handed that id back. Resolving a thread that is already
resolved counts as resolved and must not throw, for the same reason merging a merged pull request
does not: the boss may have done it on the web while TinyCorp was asking.

The three are optional and travel together. A forge whose CLI cannot open a resolvable thread
leaves all three out; TinyCorp then keeps that Company's review conversation in the app alone and
says so in the review panel, and everything else still works.

How a forge shapes a review is its own business. GitHub has a review object with a body, an event
and its comments, so the whole round is one request. GitLab has no such object: the round is a
note above one **discussion** per thread, and the verdict is said in that note rather than spent
on GitLab's own approval, which is the project's to configure and not TinyCorp's to give. Say
where your CLI leaves a round's summary with `reviewSummaries` in your conformance spec, and the
suite will look there instead of at GitHub's shape.

### `merge`

```ts
merge(request: { cwd, url }): Promise<void>
```

Merges, squashing where the forge offers it. A pull request that is **already merged counts as
merged**: the boss merges one on the web while TinyCorp is asking, or the engine asks again after a
restart, and neither is a failure. Rather than read the CLI's refusal for the word "merged", ask the
forge what the pull request is when a merge fails.

When `merge` resolves, the pull request **is merged**. Some CLIs, asked to merge while CI is still
running, quietly queue it instead — `glab mr merge` turns on auto-merge by default — and answer
success for a pull request that is still open. The merge gate has already decided; merge now, or
fail.

### `remote`

```ts
createRemote?(request: { cwd, name, visibility: 'private' | 'public' }): Promise<{ webUrl, cloneUrl }>
```

**Optional.** Creates an empty repository on the forge, under the account the CLI is signed in as,
so a repo the boss started in the app can get a remote without leaving it. Leave it out and the
app offers no remote for your forge; a repo with no remote works everywhere else in the app.

It creates the repository and nothing else. Adding `origin` and pushing the first commit are the
engine's, so the adapter never runs git. A repository is private unless the boss asked otherwise,
`cloneUrl` uses the protocol the boss set the CLI to clone with (an SSH user's first push must not
ask for an https credential), and a name already taken on the forge is refused in the CLI's words.
The checks for this part pass trivially for an adapter that does not have the method.

### `auth`

Not a method: a rule the suite checks over everything the adapter did. No command it runs may
carry a credential — not a token, not a password, not an `Authorization` header — in an argument
or in the `env` it is run with. The boss signed
in with the CLI, and the CLI finds its own login where it put it. If your product's CLI has no
such command, say so in the pull request: that is a conversation, not something to work around.

### `install`

```ts
installed(): boolean
```

Whether the CLI is on this machine, by looking at `PATH` — `onPath(command)` in `on-path.ts` does
it and caches the answer. Use `options.installed` when it is given: that is how the suite plays a
missing CLI. A repo whose forge CLI is missing can open no pull request, and the app says so up front
instead of failing when an Employee's work is done.

### `preflight`

```ts
checkCli(): Promise<ProviderCheck>
```

Whether the CLI can open a pull request at all, and your product's own words for fixing it when it
cannot. The same shape a Provider's preflight answers in (T135): the renderer cannot load an
adapter, so the words travel as data.

`checkForgeCli` in `forge-preflight.ts` writes the card for you. You answer five things only you
know: the args that ask where the boss stands, the command that installs the CLI, the command that
signs in, what the answer means, and who it names.

It is one status command with a timeout. It never opens, closes, comments on or merges anything —
a check that asks by *doing* is a check nobody can run twice.

It runs in the app's own folder (`options.cwd`), not in a repo, so a CLI that answers for "the
instance this folder points at" answers for none. Ask for every host it is signed into (`glab auth
status --all`), and name the host beside the account when there can be more than one. Read both
streams: `glab` writes its status to stderr.

### The runner and the path

`ForgeAdapterOptions` hands the adapter everything it needs, and a test replaces each part:

- `runForge` runs the CLI. Left out, use `runForge` from `run-forge.ts` — the real one, which
  resolves for any exit code, reports `code: null` only when the command is not there, and already
  allows a patch-sized stdout. Its options take `cwd` and `env`: the settings laid over the app's
  environment for that one command (see *Nothing phones home*).
- `installed` answers whether the CLI is on `PATH`. Left out, use `onPath(command)`.
- `cwd` is the app's own folder, for the preflight. Left out, the process's working directory.
- `command` and `name` come from your catalogue entry.

---

## 4. From empty file to green suite

```sh
mkdir -p src/main/forges/<id>
```

1. **Add the catalogue entry** in `src/shared/forges/index.ts` (`ForgeEntry` documents each field):

   ```ts
   {
     id: 'gitlab',                 // what a repo's forge is stored as
     name: 'GitLab',               // the repo card's title, and every sentence about a PR
     shortName: 'GitLab',          // what a chip carries
     command: 'glab',
     hosts: ['gitlab.com'],        // the hosted service, lowercase
     instanceLabels: ['gitlab'],   // optional: a self-hosted host that says what it is (below)
     icon: 'fox',                  // a mark from ForgeIcon; one nobody draws yet renders as plain git
     auth: { how: 'GitLab account, through `glab auth login`', signOut: 'glab auth logout' },
     maintainer: 'TinyCorp',
   }
   ```

   The mark is a drawing, and drawings come from the Pen frames in `design/`: name one from
   `ForgeIcon`, and if nobody has drawn it the card shows the plain git mark until someone does.
2. **Write the adapter** in `src/main/forges/<id>/adapter.ts`, taking `ForgeAdapterOptions`
   — the command and the name come from your entry, and `runForge` runs your CLI.
3. **Write your CLI as a function**, in `fake-<cli>.ts` beside it: what it prints for each call the
   adapter makes, in a world the suite sets up. This is the only thing the suite cannot know.

   The world (`ForgeWorld` in `forge-conformance.ts`) is the forge's pull requests, each with the
   `view` a read must answer and the `patch` a diff must answer, plus whether the CLI is `missing`,
   `signed-out` or `signed-in`. Read it to answer; write to it to record what a command did — push
   onto `opened`, set `merged`, append to `comments` or `lineComments`. The view is in the
   contract's words, so your fake translates it *into* your forge's JSON, and your adapter
   translates it back.

   Copy the real CLI's output, don't imagine it — including how it fails and which stream it writes
   to. You can learn it without touching anyone's repository: read a public project's pull
   requests, and point the CLI at a small HTTP server on `localhost` for what it sends when it
   writes. Then keep the fake honest with an `adapter.itest.ts` beside it (run by `pnpm
   test:claude`, skipped when the CLI is not signed in) that asks the real CLI the same read-only
   questions.
4. **Run the suite** from `adapter.test.ts`:

   ```ts
   describeForgeConformance({
     forge: entry.id,
     label: entry.name,
     command: entry.command,
     url: (number) => `https://your-forge.example/acme/app/-/pulls/${number}`, // your forge's shape
     create: createYourAdapter,
     cli: fakeYourCli,
   })
   ```

5. **Add the registry line** in `src/main/forges/forge-registry.ts`.
6. **Add your row** to the table at the end of this page. `forge-docs.test.ts` holds it to the
   catalogue: the CLI in backticks, `auth.how` word for word, and every host — then every
   instance label as `` `<label>.*` `` — in backticks, comma-separated.

`pnpm test` is red until the adapter is finished, and each failure says what is missing and which
part of the contract it belongs to.

### Why it is two lines and not one

The catalogue and the adapter live on opposite sides of a process boundary. The renderer draws the
repo card from `shared/forges.ts` and cannot load an adapter, which is node code. The registry line
only compiles once the entry exists, and `createForgeAdapters` refuses a set that is missing one —
so a catalogued forge with no adapter never reaches a repo, where it would look supported on the
card and fail at the moment an Employee was ready.

Nothing else in the app names a forge, and `no-forge-names.test.ts` says so.

### What a self-hosted instance does today

`hosts` is a list of hostnames, and nobody can list an employer's. So a remote says which forge it
is on only through its host's name, and `instanceLabels` reads the first label of it:
`instanceLabels: ['gitlab']` detects `gitlab.acme.com` and `git@gitlab.acme.io:team/app.git`. A
host `hosts` lists always wins over one a label reads.

An instance on a host that does not say so — `git.acme.com`, `code.acme.io` — is **not** detected:
the repo attaches, works locally, and says it can open no pull request. Naming such a host is a
Company setting, and nobody has asked for one yet — when someone does, it is a field beside the
repo, not a new forge.

Detection runs in the renderer as well as in the engine (the repo card draws it), so it can only
read the remote. What the CLI knows — the instances it is signed into — is the engine's, and does
not decide it.

---

## 5. Every forge

| Forge | CLI | Authenticates with | Detected on | Maintainer |
| --- | --- | --- | --- | --- |
| GitHub | `gh` | GitHub account, through `gh auth login` | `github.com` | TinyCorp |
| GitLab | `glab` | GitLab account, through `glab auth login` | `gitlab.com`, `gitlab.*` | TinyCorp |
<!-- forges:end -->

A repo whose `origin` is on none of these still works: worktrees, branches, diffs and a local merge
all carry on. It cannot open a pull request, and the card, the ticket and the Employee's own
instructions say so in the same words.
