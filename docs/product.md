# TinyCorp — Product

The codename was `better-office` until 2026-09-17; the product is **TinyCorp** (package `tinycorp`).

## One sentence

A desktop app where a workspace is a **company**: employees are parallel AI coding agents running on your own CLI subscription, you are the boss, and the company takes targets from you in chat and ships real code to real repos. The pixel-art office is the primary view.

## Why another orchestrator

Orca, Warp and friends give you *terminals with tabs*. Pixel Agents gives you *a cute view of terminals*. Neither gives you a **team**: roles, a board, a message bus, hiring, review, and a boss who approves or overrides. TinyCorp is the team layer, with the office as the window into it.

## Core model

```
Workspace (company)
├── Repos            N git repos, each with a free-text brief and optional checks (decision 40)
├── Employees        each = persona + capabilities + provider + repo filter + CLI session
├── Board            Target → Epic → Ticket → Subtask (kanban, WIP limits)
├── Chat             channels, DMs, threads, inboxes, approvals
├── Office           PixiJS scene, one sprite per employee, your desk
└── State            one SQLite file in the workspace folder
```

### Employees

- **Roles are data, not code.** A role is a template: persona prompt, default capabilities, default repo filter. Ships with a catalog (PM, PO, Tech Lead, Frontend, Backend, DevOps, QA, HR) that you can edit or extend. A one-person company with a PM who also codes is valid.
- **A role specialises by the kind of work, not by the repo's name.** Everyone who codes works in every repo you let them into — a monorepo is the normal shape — and an Employee may own **areas** instead: paths inside a repo, `src/renderer/**`, `packages/api/**`. A ticket goes to whoever owns the paths or the label it carries; the lead plans and reviews and takes a ticket only when no engineer can. A filter that lets somebody into no repo is never silent: the cards, Edit Employee, Repositories and the hire flow say so and offer **Allow all repos** (decision 70).
- **Capabilities** drive routing instead of job titles: `intake`, `plan`, `code`, `review`, `hire`.
- **Every employee is a CLI session** (`claude`, later `codex`, `opencode`) spawned by the app on your subscription login. No API keys. Non-coding employees get the company folder as their cwd instead of an app repo.
- **Permission mode** is per employee (`--dangerously-skip-permissions` or interactive), not global.
- **Memory file** per employee in the company folder, updated by the agent at the end of each ticket. Personality and learned repo knowledge survive restarts and provider switches.

### How agents touch the company

Agents know nothing about the board or chat by default. The app gives them hands and a head:

- **Hands: an app-owned MCP server** injected into every session's config. Every board move, chat post, target creation, hire proposal and approval request is an MCP tool call. The app therefore has perfect knowledge of who is doing what, which drives the office sprites without transcript parsing. Each session gets a per-employee identity token in its MCP config so the server knows who is calling.
- **Head: generated instructions.** At spawn the app renders the Employee's instructions — persona, company rules, each repo's brief and checks, how to use the board, the subtask rule, the wake rules — and gives them to that process alone, on `--append-system-prompt`. They are never written into the cwd: every Employee of a Company shares its folder, so a `CLAUDE.md` there would describe one of them to all of them (decision 48). Switching providers renders them in the new format.

Tool surface (v1): `board_list`, `ticket_create`, `ticket_claim`, `ticket_move`, `ticket_update`, `subtask_toggle`, `target_create`, `epic_create`, `chat_post`, `chat_read`, `thread_reply`, `approval_request`, `hire_request`, `team_load`, `note` / `recall` / `zoom` / `nap` / `forget` (the Employee's own append-only notes, T193), `memory_search` / `memory_read` / `memory_write` / `memory_link` (the Company memory, T175), `repo_set_checks` (decision 40).

### Sessions and waking

- **Long-lived sessions.** One interactive CLI process per employee for as long as the workspace is open. Click the pixel → live xterm terminal.
- **The app pushes prompts on idle.** When a message, ticket or approval result arrives for an idle employee, the app writes a prompt into its stdin. While busy, events queue in the employee's **inbox**.
- **Idle detection** is the riskiest technical piece. Claude Code's `Stop` hook makes it solid; other providers fall back to last-MCP-call and prompt-echo heuristics. This is why v1 is Claude Code only.
- **Cold restore.** The Claude `SessionStart` hook yields a `session_id`; it is stored on the employee. On reopen the app relaunches with `claude --resume <id>`. If that fails, a fresh session is primed with the current ticket, the last chat messages and a "run `git status` first" instruction. Warm reattach via a PTY daemon (as Orca does) is deferred.

### Chat

- **Channels:** `#general`, `#tech`, `#prs` (system channel: PR opened, review requested, merge approved), one channel per epic, DMs. Threads and replies everywhere.
- **Composer:** free text. `@` autocompletes employees, `@channel` wakes everyone, `#` autocompletes tickets (`#12`) and channels. Later `/` for commands.
- **Wake rules:** an agent is woken only by a DM, an `@mention`, a reference to a ticket it holds, or a message in an epic channel it belongs to. `#general` does not wake anyone; agents read its history the next time they wake. Same rules for agent-to-agent.
- **Approvals live in chat** as threads with approve/reject actions. Hire proposals, merge requests, provider switches and process changes all arrive this way.
- **Intake is free chat.** "hey @pm, magic-link login, frontend and backend repos, by Friday" → whoever holds `intake` creates the target, epic and tickets via tools. Structure is the agent's job.

### Board

- **Hierarchy:** Target (what you asked) → Epic (PM grouping) → Ticket (one assignee, one worktree per repo, one PR per repo) → Subtask (checklist inside a ticket, same branch, same PR).
- **The subtask rule:** if a subtask needs another person or another repo, it is a ticket. The MCP tool refuses to assign a subtask to someone else.
- **Kanban only in v1** with per-column WIP limits. WIP limits are what feed hire proposals. Sprints are on the roadmap and switching to them will be a gated request.
- **Own local board, SQLite, source of truth.** One-way sync out to Linear / GitHub Issues later.
- **Only the boss deletes a ticket, and only one that holds no work** (T275), from the ticket's drawer:
  - **It goes with everything that hangs off it:** its subtasks, links, plan, restore points, and a worktree and branch nobody did anything in.
  - **Whoever held it is told to drop it.**
  - **A ticket stays when its history matters:** one that opened a PR, was reviewed, tested or given a security pass, or whose branch holds commits or changes nobody merged. The drawer says which.
  - **No MCP tool deletes a ticket.**

### Code flow

1. Engineer claims ticket → app creates a worktree + branch per repo in scope, tells the session its new cwd.
2. Engineer works; subtasks tick off; pushes; opens a PR per repo via `gh`, linked to the ticket. Event lands in `#prs`.
3. If any employee holds `review`, the PR is assigned to them. They pull the branch read-only, comment, and either bounce the ticket back or approve.
4. Merge is a gated action (see autonomy). On merge the worktree is removed.

### Autonomy

Per-workspace level, default **Managed**:

| Action | Supervised | Managed (default) | Autonomous |
|---|---|---|---|
| Create / reorder tickets | free | free | free |
| Assign tickets | ask | free | free |
| Start work | ask | free | free |
| Open PR / merge | ask | ask | ask only if CI red or limit exceeded |
| Hire | ask | ask | ask only above max headcount |
| Fire / switch provider | ask | ask | ask |
| Switch kanban → sprints | ask | ask | free |

Autonomy says *when TinyCorp asks you*. What it may do at all is on each repo (decision 61), as a ladder
whose rungs are each a superset of the last:

| Rung | What it allows |
|---|---|
| `local only` | never pushes. Work stays in the worktree and you take it from there |
| `PR only` | pushes a branch and opens a PR, never merges |
| `merges` | may merge, subject to the level above |

A newly attached repo may merge. Where the two disagree the repo wins: no level, Autonomous included,
merges into a `PR only` repo, and the engine refuses before anything is pushed.

### Hiring

- Any employee with `hire` can call `hire_request(role, reason)`. `team_load` returns WIP per person, unassigned tickets and skill gaps so the proposal is reasoned, not guessed. Triggers live in the hirer's instructions, not in code.
- Your approval spawns the employee: generated name, sprite, desk, session, hello in `#general`.
- Firing is the reverse, gated, and keeps the Employee's note log so rehiring is possible.

### Budget

- **Concurrency cap** per workspace, default 5, user-adjustable. Employees beyond the cap exist on the board and in chat but are parked (sprite "Off") until a slot frees.
- **Budget exhausted:** the Claude adapter detects the usage-limit pattern, marks sessions "Out of budget", posts once in `#general` with the reset time, stops pushing prompts. Sprites go to the coffee area. No multi-account juggling in v1.

### Office

PixiJS (WebGL) stage inside a React component. Pixel Agents' layout and pathfinding logic ported as pure TypeScript. Sprites from the MetroCity pack (CC0). Clicking a sprite opens a side drawer (not a modal) with terminal, current ticket, their chats and memory. You have a desk too: clicking it opens `#general` and shows pending approvals.

| State | Source of truth | Animation |
|---|---|---|
| Idle | no ticket, session waiting | at desk, fidget |
| Working | ticket claimed, write tools firing | typing |
| Reading | ticket claimed, read-only tools | reading |
| Talking | posting to chat | walks to the other desk / meeting room |
| Waiting on you | approval pending | "!" bubble |
| Blocked | a ticket they hold is blocked and their session is not busy (T273) | coffee area, "?" bubble |
| Parked / Out of budget | over the concurrency cap / usage limit hit | coffee area |
| Off | session not running | empty chair |

Feelings are not animated; they live in chat text as persona.

### Notifications

Native OS notifications for: approval requested, you were mentioned, PR opened, budget exhausted. Per-workspace toggle.

## Stack

Electron + TypeScript, own codebase.

- **Main process:** node-pty sessions, MCP server, git/worktree management, SQLite, provider adapters, hooks receiver, notifications.
- **Renderer:** React, xterm.js with WebGL addon, PixiJS office, board, chat.
- **Lifted under MIT:** Pixel Agents (layout editor, pathfinding, state→animation ideas), Orca (node-pty setup, provider resume command table, hook relay).

## Provider adapter seam

```ts
interface ProviderAdapter {
  spawn(employee, cwd, company): PtySession  // instructions on the process, not in the cwd
  injectMcp(cwd, serverUrl, token): void
  resumeCommand(sessionId): string[] | null
  detectIdle(session): AsyncIterable<'idle' | 'busy'>
  detectBudgetExhausted(output): boolean
  pushPrompt(session, text): void
}
```

v1 implements `ClaudeCodeAdapter` only. Provider is a field on the employee from day one.
