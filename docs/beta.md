# TinyCorp, private beta

TinyCorp is a desktop app where a **Company** is a team of **Employees**, and every Employee is a
long-lived coding-agent session (Claude Code, Codex or OpenCode) working on your own subscription. They pick up tickets from a board,
work in their own git worktrees, talk in a chat, and open pull requests you review inside the app.

This is a private build. It is not signed and it does not update itself. It runs on Apple Silicon
Macs and on Windows 10 or later, x64.

## Before you install

You need **Claude Code, signed in on a Claude subscription**. Not an API key — TinyCorp strips
`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from every session it starts, on purpose, so the work
is billed to your subscription and nothing else.

On a Mac:

```sh
npm install -g @anthropic-ai/claude-code   # if you do not have it
claude /login                              # sign in with your Claude account
claude auth status                         # should say you are logged in
```

On Windows, in PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex    # if you do not have it
claude /login                              # sign in with your Claude account
claude auth status                         # should say you are logged in
```

[Git for Windows](https://git-scm.com/downloads/win) is worth having: TinyCorp needs `git` either
way, and Claude Code uses its Git Bash for the Bash tool. TinyCorp works without it — its Employees'
status hooks are written for PowerShell when Git Bash is not there.

Everything an Employee does runs as you, on your machine, with your subscription. A busy Company can
spend a lot of it.

## Install

**On a Mac:**

1. Download the `.dmg` and drag **TinyCorp** to Applications.
2. The first time, **right-click the app and choose Open**, then Open again in the dialog.

That second step is not optional, and it is not a sign anything is wrong: the build is unsigned, so
macOS refuses a plain double-click and says the app is damaged. Right-click → Open is how you tell
it otherwise. (The terminal equivalent, if you prefer: `xattr -dr com.apple.quarantine
/Applications/TinyCorp.app`.)

Signing and notarisation need an Apple Developer Program membership. It is on the list; it is not in
this build.

**On Windows:**

1. Download `TinyCorp-Setup-<version>-x64.exe` and run it. It installs for you alone and needs no
   administrator.
2. SmartScreen will say *Windows protected your PC*. Choose **More info → Run anyway**.

That is the same story as the Mac's: the build is unsigned, so Windows has nothing to check it
against. Code signing is on the list; it is not in this build.

## What to expect

- **Your first Company** asks for a folder, then walks you through a preset, a team and your repos.
  Point it at a real repo you do not mind branches appearing in — or a scratch clone for the first
  hour.
- **Employees write into git worktrees, never into your checkout, and never commit to your default
  branch.** Work lands as a branch and a pull request you approve.
- **Approvals are yours.** Anything the Company treats as gated waits for you in the Inbox and, if
  you let it, in a desktop notification.
- **Files** opens what an Employee is working on, with types on hover and go-to-definition, and lets
  you edit and save into the worktree.

## What is rough

- macOS on Apple Silicon, and Windows x64. Nothing for Intel Macs or Linux.
- **On Windows:** the app itself, the Providers, the worktrees and the hooks are all tested on a
  Windows runner, but a few corners are still written for a Mac — `Open in…` offers no editor and
  falls back to whatever Windows opens the file with, and some of the app's own sentences still say
  "this Mac". Running the CLIs inside WSL is not supported yet.
- No auto-update: when there is a new build you will be told where to get it, and you install it the
  same way.
- The office, the board and the chat are further along than the edges around them. Some buttons in
  the design are still inert.

## Telling us something broke

- If a screen breaks, the app says so and offers **Copy report**. Paste that. It carries the error,
  the screen you were on and the version — nothing from your repos.
- Otherwise: what you did, what you expected, what happened, and the version from
  **Your profile**, on the version row at the foot of its left column. A screenshot is worth more
  than a description.

Say what actually happened, including the parts that make the app look bad. That is the whole point
of a beta.
