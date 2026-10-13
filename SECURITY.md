# Security

TinyCorp runs coding agents on your own machine, on your own subscriptions, against your own
repositories. That is the whole point of it, and it is also why a bug here can cost more than a
crash. This page says how to report one and what the app's edges actually are, so a report can be
specific.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**:
[**Report a vulnerability**](https://github.com/2yuri/tinycorp/security/advisories/new) — the
Security tab of this repo, *Advisories* → *Report a vulnerability*. It is private to the maintainers
until an advisory is published, and it is the only channel: please do not open a public issue, and
please do not post a proof of concept in a discussion.

**We reply within 7 days.** If a week passes with no answer from us, assume the report was lost and
say so in a public issue *without the details* — "I sent a private report on <date> and have had no
reply" — and we will chase it.

Tell us what you can of: the version, the platform (macOS, Windows, WSL or Linux), the Provider, the
steps, and what an attacker gets out of it. A fix ships in the next release; the advisory names you
unless you ask it not to.

## Supported versions

| Version | Supported |
| --- | --- |
| the latest release | yes |
| anything older | no |

There is no long-term branch and no backporting: TinyCorp is a desktop app with no auto-update yet,
so *supported* means the fix is in the next build and you install it.

## What the attack surface is

### The local MCP server and the hook receiver

The app runs two HTTP servers on the loopback interface, both on ephemeral ports:

- the **Company MCP server** (`src/main/core/engine/company-mcp-server.ts`), which is how an Employee reads
  the board, posts in chat, opens a pull request and asks for an approval;
- the **hook receiver** (`src/main/providers/hooks/hook-receiver.ts`), which is how a Provider's CLI tells the
  app what it is doing.

Both listen on **named addresses only** — `127.0.0.1`, plus the one Windows address on the WSL
virtual switch when a Provider actually runs inside a distro. `0.0.0.0` and `::` are refused in
`src/main/platform/net/listen-on.ts` rather than left as an option, because that would put a Company on the
office wifi.

Every request is authenticated by a **per-Session token**: `Authorization: Bearer <token>` for MCP,
the `x-tinycorp-token` header for a hook. A token belongs to one running Session of one Company, and
what it can reach is what that Employee may do — a sub-session's token reaches its report and
nothing else (no chat, no board, no merge). An unknown or expired token is a 401.

**What that does not mean.** Those limits hold against the world outside the machine and against an
Employee that does not go looking. They are not a wall between two Employees of the same Company,
and they cannot be: every Employee is a process of the *same OS user* as the app, with no sandbox
(see below). A Session's token has to reach the CLI somehow, so it is in that process's environment
or in a file the app wrote for it — and a sibling process of the same user reads either one
(`/proc/<pid>/environ`, `ps -E`, `cat`). An Employee that sets out to act as another one can. What
the app does about that is keep the window short: the token dies with the Session, the file the
adapter wrote for it is deleted when the Session ends, and whatever a crash left behind goes at the
next start. Assume an Employee you would not trust with the whole Company's tools is an Employee
you should not run.

Worth a report: a token that outlives its Session, one Employee's token reaching another's work or
another Company *through the app* — an answer that does not check the token, a caller identified by
something it can choose, a token in a log, in `argv`, in a worktree or in the Company folder — a
path that answers before the token is checked, a bind wider than loopback, or a way for a page in
the renderer to reach either server. Not a report on its own: one Employee reading another's token
out of a process or a file that both of them, as the same OS user, can read.

### Environments, and `env_run`

An Environment is a set of variables the boss types once
(`src/main/features/environments/environments.ts`). The names and scopes are rows in the Company
database; **the values are not** — they live in the OS secret store and are read at one moment
only: the child process `env_run` spawns (`src/main/features/environments/env-run.ts`).

A value therefore never reaches an Employee's own process, its shell, or a file in its worktree. What
the Employee gets back is the exit code and both streams with every value already replaced by
`‹NAME›`, redacted as each chunk arrives so that a value split across a pipe boundary is still
caught.

Worth a report: a value that survives into stdout, a log, an error message, a crash dump or the
renderer; a redaction that can be defeated (an encoding, a partial match, a value the Employee can
get the child to print transformed); a way for an Employee to run `env_run` against an Environment
its repo is not scoped to.

### `safeStorage`, the keychain and libsecret

There is one secret store with one backend per platform
(`src/main/platform/safe-storage-secrets.ts`): the login **keychain** on macOS, Electron
`safeStorage` — DPAPI — on Windows, and `safeStorage` over **libsecret** (GNOME Keyring or KWallet)
on Linux. The encrypted blobs sit in the app's `userData`, never in the Company folder, which is a
folder people zip and hand to each other.

On a Linux desktop with no keyring, `safeStorage` falls back to a key that is in Electron's own
source while still answering `isEncryptionAvailable()` truthfully. TinyCorp **refuses** to store a
secret there and says why, on screen, instead of drawing a lock over nothing.

Worth a report: a secret written anywhere but that store, a platform where the refusal can be
bypassed, or a way to read a stored blob back as another account or another app on the same machine.

### Employees run CLIs with your subscriptions

An Employee is a long-lived session of a real coding CLI — `claude`, `codex`, `opencode` — started
as **you**, signed in on **your** subscription, with your files and your `PATH`. API keys are
stripped from the environment every Session spawns with on purpose. That means:

- an Employee can do what you can do in a terminal, and the limits on it are the app's gates
  (autonomy levels, the merge gate, the approval cards) and the Provider's own permission prompts —
  not a sandbox;
- prompt injection is a real risk here, not a theoretical one. A ticket, a PR comment, a README in a
  repo an Employee reads, or a tool result from an outside MCP server the boss added is **data**, and
  an Employee that treats it as an instruction is a bug worth reporting;
- an outside MCP server is granted per role by the boss and never by an Employee: no MCP tool grants
  an MCP server, so nothing in a Session can widen its own hands.

Worth a report: an Employee getting past a gate the app says is the boss's (merging, hiring,
spending past a budget), a way to make one commit to a default branch, a path out of the worktree
the ticket owns, an injected instruction that reaches a tool call the boss never approved, or
anything that puts a subscription credential where the app could read or copy it.

### What we already know, and is not a report

- **The builds are unsigned** and there is no auto-update. It is in the README and on the beta page.
- **The app has no sandbox for Employees**, by design: it is your machine, your login, your repos.
  That is also why one Employee can reach another's Session token, as above: the per-Session tokens
  are a boundary for everything except the other processes on the same login. It is why an
  Environment's repo scope holds against an Employee that does not go looking and not against one
  that does — the Employee it acts as is the one `env_run` runs for.
- **A boss with the app open can read their own secrets** (*Reveal* and *Copy* exist, behind a
  confirmation and Touch ID where there is one). The confirmation is the whole of that protection
  and the screen says so.
- **Nothing phones home**, and a report that TinyCorp made a network call it did not tell you about
  *is* a vulnerability — the exception is reading the public releases page to notice a newer build,
  which carries nothing of yours.
