# TinyCorp — Roadmap

Ordered by risk, not by feature size. Each milestone ends with something you would actually use.

## v0 — The loop exists (spike, throwaway allowed) — DONE 2026-09-17

Goal: prove the riskiest assumption before building UI. One Claude Code session, one repo, one ticket, end to end, with no office. **Answered YES**, see [spikes/v0-loop.md](spikes/v0-loop.md); code on branch `spike/v0-loop`.

- [x] Spawn `claude` in a node-pty from Node (Electron shell and xterm.js deferred to v1: proven tech).
- [x] App-owned MCP server with `board_list`, `ticket_claim`, `ticket_move`, `chat_post`; injected via `--mcp-config` + CLAUDE.md.
- [x] Claude hooks receiver: `SessionStart` (capture session_id), `Stop` (idle), `PreToolUse` (working/reading).
- [x] Push a prompt into the session on idle; queue while busy.
- [x] Worktree per ticket (PR via `gh` not exercised: proven tech).
- [x] Cold restore with `--resume`.

Exit criterion: type a target in a text box, close the app, reopen it, and the PR still opens.

## v1 — The thin loop (daily-usable)

Built 2026-09-17 by twenty parallel tickets (#19–#37 and #47) dispatched through Orca and landed on `main` with 572 tests. See `docs/spec-v1-thin-loop.md` (issue #1).
- [x] **Workspace:** N repos, per-repo stack constraints, SQLite state file.
- [x] **Employees:** role catalog, persona + capabilities + repo filter, per-employee permission mode, memory file, concurrency cap (default 5), parked state.
- [x] **MCP surface:** full v1 tool list (see product.md), per-employee identity token.
- [x] **Board:** Target → Epic → Ticket → Subtask, kanban with WIP limits, minified board view.
- [x] **Chat:** `#general`, `#tech`, `#prs`, epic channels, DMs, threads, inbox per employee, `@`/`#` autocomplete, wake rules, free-chat intake.
- [x] **Autonomy:** three levels, approvals as chat threads.
- [x] **Code flow:** worktree per ticket, PR per repo, agent review when a reviewer exists, gated merge, worktree cleanup.
- [x] **Hiring / firing:** catalog role + gated chat request, `team_load` tool.
- [x] **Office:** PixiJS stage, seven states, your desk, click → side drawer (terminal, ticket, inbox, memory). Pixel Agents layout + pathfinding ported.
- [x] **Budget exhausted** detection and state.
- [x] **Notifications:** approval, mention, PR opened, budget.
- [x] **Claude Code adapter only**, adapter interface in place.

Exit criterion: run a real week of your own side project through the company without opening a terminal yourself.

## v2 — More providers, more process

- [x] Codex adapter (idle heuristics, AGENTS.md, `codex resume`).
- [x] OpenCode adapter.
- [x] Provider switch on an employee from the UI (regenerate instructions, carry memory file).
- [ ] Sprints: cycle length, planning, backlog split, velocity; switching is a gated request.
- [ ] PTY daemon for warm reattach (Orca-style): sessions survive app quit.
- [ ] Office layout editor (rooms, desks, furniture).
- [ ] One-way board sync out to Linear / GitHub Issues.

## v3 — Beyond one machine

- [ ] Multi-account / budget pooling.
- [ ] Remote workspaces over SSH.
- [ ] Sounds, day/night, office ambience.
- [ ] Shareable role packs and office themes.

## Explicitly not planned

- Direct API-key providers (cost model is "your subscription").
- Agents choosing languages or frameworks (stack is a per-repo constraint, libraries only).
- Animated "feelings" (they live in chat as persona).
