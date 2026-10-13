# Spec — v1 "the thin loop"

Status: published as https://github.com/2yuri/tinycorp/issues/1 (label `ready-for-agent`) · Source: `docs/decisions.md` (1–22), `docs/product.md`, `docs/spikes/v0-loop.md`

Vocabulary note: no `CONTEXT.md` exists yet. This spec uses **Company** (not workspace), **Employee** (not agent, for the domain entity), **Session** (an Employee's running CLI process), **Provider** (the CLI product a Session runs on). These are the recommended canonical terms pending the glossary session.

## Problem Statement

I want to hand a goal to a small team of AI coding agents and get real, reviewable code back in my real repos, without babysitting terminals. Today's orchestrators give me a tab list of terminals. I still have to break the work down, tell each agent what to do, notice when one is stuck or idle, and stitch the results together myself. Nothing gives me a team: people with roles who talk to each other, keep a board, ask me only when it matters, and tell me when they need help or more hands. And nothing shows me at a glance what everyone is doing.

## Solution

A desktop app where each Company is a team of Employees, and each Employee is a long-lived Claude Code session on my own subscription. I talk to the Company in a Slack-like chat. Whoever holds the `intake` capability turns my message into targets, epics and tickets on a kanban board. Engineers claim tickets, work in a git worktree per ticket, open a PR per repo, and hand off for review. Merges and hires wait for my approval unless I raise the autonomy level. A pixel-art office shows every Employee's real state, and clicking one opens their live terminal, current ticket and inbox.

## User Stories

### Company and repos
1. As the boss, I want to create a Company from a folder, so that all its state lives in one place I can back up or delete.
2. As the boss, I want to attach one or more git repos to a Company, so that a frontend, a backend and a service repo can be worked by the same team.
3. As the boss, I want to describe each repo in free text and optionally set its checks (install, build, test, lint), so that Employees know what the repo is and how to verify it. (Revised by decision 40; the stack used to be mandatory.)
4. As the boss, I want to open a previously created Company and find its board, chat, employees and office exactly as I left them, so that the team feels continuous.
5. As the boss, I want to switch between Companies, so that I can run several products.

### Employees and roles
6. As the boss, I want a catalog of roles (PM, PO, Tech Lead, Frontend, Backend, DevOps, QA, HR) to hire from, so that I do not write personas from scratch.
7. As the boss, I want to edit a role template's persona, capabilities and repo filter, so that the company matches how I work.
8. As the boss, I want to create my own role templates, so that unusual companies are possible.
9. As the boss, I want an Employee to have a name, a role, a persona, capabilities, a repo filter, a provider and a permission mode, so that each one is a distinct person with a defined job.
10. As the boss, I want a one-person Company with a single Employee holding every capability to be valid, so that I can start small.
11. As the boss, I want each Employee to keep a memory file that persists across sessions and provider switches, so that they remember the repos and their own habits.
12. As the boss, I want to set a per-Employee permission mode (skip permissions or interactive), so that I control risk per person.
13. As the boss, I want to fire an Employee, keeping their memory file, so that I can rehire them later.

### Sessions and lifecycle
14. As the boss, I want an Employee's Session to start when the Company opens and live until it closes, so that context is retained across tickets.
15. As the boss, I want the app to spawn Sessions with a clean environment, so that a Session started from inside another Claude Code session still saves transcripts and can be resumed.
16. As the boss, I want the app to answer the folder-trust dialog for worktrees it created, so that a Session never dies on a default "No, exit".
17. As the boss, I want closed Sessions to resume with their previous context on reopen, so that an Employee remembers what it was doing yesterday.
18. As the boss, I want a Session that cannot be resumed to start fresh and be told its current ticket and recent chat, so that work continues either way.
19. As the boss, I want a resumed Session to check the worktree state before continuing, so that half-finished edits are noticed.
20. As the boss, I want a concurrency cap (default 5) with extra Employees parked, so that my usage limits are respected.
21. As the boss, I want the app to detect when the subscription limit is hit, mark every Session out of budget, tell me once with the reset time and stop pushing prompts, so that agents do not silently stall.

### Company hands: MCP and instructions
22. As an Employee, I want tools to list the board, create, claim, move and update tickets, and toggle subtasks, so that I can do my job without a human moving cards.
23. As an Employee, I want tools to post to a channel, DM someone, reply in a thread and read recent messages, so that I can communicate.
24. As an Employee, I want tools to create targets and epics, so that intake can be done by whoever holds the capability.
25. As an Employee, I want tools to request an approval, request a hire and read team load, so that gated actions and proposals go through the Company.
26. As an Employee, I want a tool to write to my memory file, so that I can learn across tickets.
27. As an Employee, I want my instructions (persona, company rules, repo stacks, board rules, wake rules) written into my working directory at spawn, so that I know how this Company works.
28. As the boss, I want every MCP call to carry the Employee's identity, so that the app always knows who did what.
29. As the boss, I want the MCP server injected via the CLI's config flag, not a project file, so that no approval prompt blocks startup.

### Inbox, wake rules and pushing
30. As an Employee, I want messages, ticket assignments and approval results to queue in my inbox while I am busy, so that nothing is lost.
31. As an Employee, I want the next inbox item pushed to me as a prompt as soon as I am idle, so that I never have to poll.
32. As the boss, I want an Employee woken only by a DM, an @mention, a reference to a ticket they hold, or a message in an epic channel they belong to, so that `#general` chatter costs nothing.
33. As the boss, I want `@channel` to wake everyone on purpose, so that broadcasts are possible.
34. As the boss, I want to see each Employee's inbox, both pending and handled, so that I know what they are about to do.

### Board
35. As the boss, I want a kanban board with Planning, Ready, Doing, Review and Done, so that I see the flow of work, and nothing is picked up before it is planned (T171).
36. As the boss, I want a hierarchy of Target, Epic, Ticket and Subtask, so that a sentence, a feature or a discovery can each enter the system.
37. As the boss, I want subtasks as a checklist inside a ticket, on the same branch and PR, so that one person's work stays in one place.
38. As the boss, I want a subtask that needs another person or repo to become a ticket, so that assignee and worktree boundaries coincide.
39. As the boss, I want WIP limits per column, so that overload is visible and feeds hiring proposals.
40. As the boss, I want a minified board view and a full board view, so that I can glance or dig.
41. As the boss, I want to drag tickets and edit them myself, so that I can override the team.
42. As the boss, I want tickets referenced as `TC-142` or `#142` in chat to link to the ticket and wake its holder, so that conversation and board stay connected. (Revised by decision 33; the id used to be `#12` alone.)

### Chat
43. As the boss, I want channels `#general`, `#tech`, `#prs`, one channel per epic, and DMs, so that conversation is organized.
44. As the boss, I want threads and replies on every message, so that approvals and discussions stay attached to their subject.
45. As the boss, I want `@` to autocomplete employees and `@channel`, and `#` to autocomplete tickets and channels, so that typing is fast.
46. As the boss, I want to type a target in free chat and have the intake Employee structure it, so that I never fill a form.
47. As the boss, I want `#prs` to receive PR opened, review requested and merge approved events automatically, so that code flow is visible in chat.
48. As the boss, I want Employees to talk to each other in the same channels, so that handoffs are visible and interruptible.
49. As the boss, I want to intervene mid-conversation with a DM or mention, so that I can redirect anyone.

### Autonomy and approvals
50. As the boss, I want three autonomy levels per Company (Supervised, Managed, Autonomous) defaulting to Managed, so that I decide how much to delegate.
51. As the boss, I want merges and hires to always ask me under Managed, so that money and main branch stay mine.
52. As the boss, I want approvals to arrive as chat threads with approve and reject actions, so that the chat is my inbox.
53. As the boss, I want a rejected approval to return to the requesting Employee with my reason, so that they can adjust.
54. As the boss, I want a pending approval to show as a "!" over the Employee's head in the office, so that I notice it.

### Code flow
55. As an engineer Employee, I want claiming a ticket to create a worktree and branch per repo in scope and move my Session there, so that I never collide with a colleague.
56. As an engineer Employee, I want to open a PR per repo linked to the ticket when done, so that review can begin.
57. As the boss, I want a PR to be reviewed by an Employee with the `review` capability when one exists, so that quality is checked before I look.
58. As a reviewer Employee, I want to request changes and bounce the ticket back, or approve and forward the merge request, so that the loop closes.
59. As the boss, I want merge to be the gated action and the worktree removed after merge, so that disk and branches stay clean.
60. As the boss, I want injected files never committed to my repos, so that the Company leaves no trace in the codebase.

### Hiring
61. As an Employee with `hire`, I want a `team_load` tool returning WIP per person, unassigned tickets and skill gaps, so that my proposals are grounded.
62. As an Employee with `hire`, I want to request a hire with a role and a reason, so that overload becomes a proposal.
63. As the boss, I want approving a hire to spawn the Employee with a generated name, a sprite, a desk and a hello in `#general`, so that the company visibly grows.

### Office
64. As the boss, I want a pixel-art office with one sprite per Employee and a desk for me, so that I see the team at a glance.
65. As the boss, I want each sprite to show exactly one of Idle, Working, Reading, Talking, Waiting on you, Blocked, Off, so that every animation is backed by a real state.
66. As the boss, I want to click a sprite and get a side drawer with live terminal, current ticket, inbox and memory, so that the office stays visible while I read.
67. As the boss, I want to click my own desk to open `#general` and my pending approvals, so that the office is also my inbox.
68. As the boss, I want to pan and zoom the office, so that larger teams fit.
69. As the boss, I want Employees over budget or parked to sit in the coffee area or an empty chair, so that budget state is visible.

### Notifications
70. As the boss, I want a native notification when an approval is requested, when I am mentioned, when a PR opens and when the budget is exhausted, so that I can walk away.
71. As the boss, I want a per-Company toggle for notifications, so that a noisy company can be silenced.

### Terminal
72. As the boss, I want to see and type into any Employee's live terminal, so that I can intervene at the lowest level.
73. As the boss, I want interactive permission prompts to be answerable from the terminal drawer, so that interactive-mode Employees are usable.

## Implementation Decisions

### Shape
- Electron + TypeScript, own codebase (decision 10). Main process owns everything stateful; the renderer is a client over IPC.
- One **Company engine** module in the main process is the heart. It owns the SQLite state, the inbox and wake rules, the autonomy gate, the board, chat, approvals and hiring. Both the renderer (via IPC) and the Employees (via MCP) are thin clients of this one module. Nothing else holds domain state.
- Around the engine, four infrastructure services with narrow interfaces: **ProviderAdapter** (spawn, instructions, MCP injection, resume, idle detection, push), **PTY manager** (node-pty sessions, output fan-out to terminals), **Git service** (worktrees, branches, PR via `gh`), **Hook receiver** (HTTP endpoint the CLI hooks POST to).
- The office is a pure projection: a function from engine state to sprite states, rendered by PixiJS in the renderer. Pixel Agents' layout and pathfinding logic is ported as pure TypeScript.

### Data model (single SQLite file per Company)
Company, Repo (with stack constraints), RoleTemplate, Employee, Session (provider session id, status, last hook), Target, Epic, Ticket (column, assignee, blocked, wip), Subtask, Worktree (ticket × repo), PullRequest, Channel, Message (thread parent, mentions, ticket refs), InboxItem (employee, payload, status), Approval (kind, subject, the ticket and PR it names, status, decision reason), HireRequest, MemoryFile pointer.

### Employee status machine (from spike v0, hook-driven)
```
off ──spawn──▶ starting ──SessionStart(+~1.5s)──▶ idle
idle ──push prompt──▶ busy      (confirmed by UserPromptSubmit)
busy ──Stop──▶ idle             (drain inbox on entry)
busy ──PreToolUse/PostToolUse──▶ busy (working vs reading derived from tool name)
* ──approval_request──▶ waiting_on_boss (overlay, not a status; clears on decision)
* ──budget pattern──▶ out_of_budget (no pushes until reset time)
* ──exit──▶ off
parked = exists in company, no Session, waiting for a concurrency slot
```
- SessionStart is the ready signal. No Stop fires at startup and `idle_prompt` was not observed (spike finding 2).
- Push recipe: write text, wait ~250 ms, write `\r` (spike finding 6). A push with no UserPromptSubmit within a timeout is logged and retried once.

### Spawning (from spike v0)
- Command: `claude --session-id <app-chosen uuid> --mcp-config <file> --strict-mcp-config [--dangerously-skip-permissions] --append-system-prompt <the Employee's whole rendered instructions>` with cwd = worktree or company folder. The instructions ride on the process because Employees of one Company share its folder (decision 48).
- Environment: inherited env with every `CLAUDE*` variable removed (spike finding 1).
- Resume: same command with `--resume <uuid>`; fallback to fresh with a primed prompt.
- Folder trust: pre-trust worktree paths or auto-answer "Yes, I trust this folder" with Down+Enter (spike finding 5).
- Hooks: written to `.claude/settings.json` in the cwd, events SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, Notification(idle_prompt), each POSTing stdin JSON to the hook receiver.
- Injected files (`.claude/`, memory) are excluded from the repo via `.git/info/exclude`; a `CLAUDE.md` an earlier build generated into the Company folder is deleted at spawn.

### MCP surface (HTTP, streamable, one server per Company)
- Per-Employee bearer token in the injected config's `headers`; the engine resolves the caller from it.
- Tools: `board_list`, `ticket_create`, `ticket_claim`, `ticket_move`, `ticket_update`, `subtask_toggle`, `target_create`, `epic_create`, `chat_post`, `chat_read`, `thread_reply`, `approval_request`, `hire_request`, `team_load`, `memory_write`.
- Tool calls are the source of truth for "who is doing what"; hooks refine timing.

### Wake and drain rules
- Wake triggers: DM, @mention, @channel, reference to a ticket the Employee holds, message in an epic channel they belong to, ticket assigned, approval decided. `#general` never wakes.
- Each wake creates an InboxItem. Drain happens only in `idle`, one item per turn, oldest first. Items delivered are marked handled.
- Prompt shape: `[company] <kind> from <who> in <where>: "<text>"` plus a reminder to reply through MCP.

### Autonomy gate
| Action | Supervised | Managed | Autonomous |
|---|---|---|---|
| ticket create/reorder | free | free | free |
| assign, start | ask | free | free |
| open PR / merge | ask | ask | ask only if CI red or limit exceeded |
| hire | ask | ask | ask above max headcount |
| fire / switch provider | ask | ask | ask |
| process change (sprints) | ask | ask | free |
Gated actions create an Approval and a chat thread; the requesting Employee is told to wait; the decision is delivered via inbox.

### Capabilities
`intake`, `plan`, `code`, `review`, `hire`. Routing: targets go to `intake`; PRs go to any `review` holder else to the boss; `hire_request` requires `hire`. Job titles are labels only.

### Git
- Worktree per ticket per repo under the Company folder, branch `ticket-tc-142-<slug>` — the ticket's display id in lowercase (decision 33). PR per repo via `gh`, linked to the ticket. Worktree removed after merge.

### Office projection
- Pure function: (Employee status, inbox, approvals, current tool) → one of seven sprite states plus optional bubble. Talking = a `chat_post` in the last few seconds.

### Renderer
- React. Office (PixiJS stage in one component), Board (full and minified), Chat (channels, threads, composer with autocomplete), Employee drawer (xterm.js with WebGL addon, ticket, chats, memory). Native notifications via Electron.

## Testing Decisions

- A good test drives the Company engine through its public API and asserts on observable outcomes: what is on the board, what is in an inbox, which prompt would be pushed, which approval exists. It never inspects SQLite rows directly or internal function calls.
- **Primary seam: the Company engine with a fake ProviderAdapter and an in-memory SQLite file.** The fake adapter records spawn calls and lets the test emit hook events (SessionStart, Stop, PreToolUse) and capture pushed prompts. This one seam covers wake rules, drain order, the status machine, autonomy gating, capabilities routing, hiring, ticket hierarchy rules and resume fallback.
- **Secondary seam: the MCP surface over HTTP.** A test acts as an Employee with a token and calls tools, asserting the same engine outcomes. This proves the agent-facing contract without a real CLI.
- **Office projection** is tested as a pure function: given engine state, expect sprite states.
- **Real Claude adapter: an integration test in CI.** The spike v0 scenario, automated: spawn a real `claude` in a throwaway worktree, deliver one ticket through the MCP surface, assert the five spike sub-questions (spawned, MCP called with token, idle via hook, push accepted, resume remembers). It runs in a dedicated CI job that is skipped when no Claude credential is present on the runner, so forks and offline runs stay green. It authenticates with the developer's existing Claude subscription login, never an API key; on a CI runner without a login, a long-lived token from `claude setup-token` is provided as a secret. It is slow and costs subscription usage, so it runs on main and on demand, not on every push.
- Prior art: none in this repo. The spike's evidence checklist (five sub-questions) is the model for what an integration test asserts.
- No renderer unit tests in v1 beyond the projection function.

## Out of Scope

- Codex and OpenCode adapters (the seam exists; only Claude ships).
- Sprints, velocity, retros.
- PTY daemon and warm reattach across app quit.
- Sync to Linear or GitHub Issues.
- Multi-account or budget pooling.
- Office layout editor, sounds, day and night.
- Remote or SSH companies.
- Animated feelings. Personality lives in chat text.
- Any direct API-key provider.

## Further Notes

- Idle detection for non-Claude providers is the known open risk and is why v1 is Claude only.
- Budget-exhausted detection is pattern-based on terminal and hook output and was not exercised in the spike.
- The bypass-permissions warning dialog will appear once on a fresh machine and must be auto-answered like the trust dialog.
- Glossary and ADRs are still to be written; a grilling session was started and paused at the Company vs workspace question.
