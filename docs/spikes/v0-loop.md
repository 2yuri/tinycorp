# Spike v0 — does the employee loop work?

**Date:** 2026-09-17 · **Verdict: YES** · **Prototype:** branch `spike/v0-loop` (throwaway, `pnpm spike` inside `spike-v0-loop/`)

## Question

Can a plain Node process run Claude Code as a long-lived employee? Five sub-questions, all had to hold or decision 5 (long-lived sessions, push-on-idle) was wrong:

| # | Sub-question | Result | Evidence |
|---|---|---|---|
| 1 | Spawn interactive `claude` in a node-pty inside a per-ticket git worktree | ✓ | `git worktree add` + `pty.spawn("claude", …, {cwd})`; commit `c173925 Add hello.txt greeting` landed on branch `ticket-1` |
| 2 | Give it hands via an app-owned MCP server it actually calls | ✓ | `board_list → ticket_claim(#1) → ticket_move(#1,review) → chat_post(#tech)`, all authenticated by a per-employee header |
| 3 | Learn idle/busy purely from hooks | ✓ | `Stop` flipped busy→idle after the task; `UserPromptSubmit`/`PreToolUse` flipped idle→busy |
| 4 | Push a queued prompt into stdin only when idle, and see it accepted | ✓ | Prompt written to PTY, `UserPromptSubmit` hook arrived within the same second |
| 5 | Kill it, respawn with `--resume <id>`, still knows its ticket | ✓ | `SessionStart source=resume` with the same id; agent replied "Status: on ticket #1 (Add hello.txt greeting), now in review" |

Whole run: 48 seconds wall clock, one Claude Max subscription, no API key.

## Findings that change the product

1. **Strip inherited `CLAUDE*` env vars when spawning.** A child `claude` inheriting `CLAUDE_CODE_CHILD_SESSION` prints "Transcript saving is off" and cannot be resumed. Orca strips the inherited env for the same reason. Any Electron main process launched from a terminal that has run Claude Code will hit this.
2. **SessionStart is the ready signal.** No `Stop` fires at startup, and `Notification/idle_prompt` did not arrive in 6 minutes of idling. Treat `SessionStart` (both `startup` and `resume`) as "idle after ~1.5 s"; treat `Stop` as idle for every later turn. Orca does the same.
3. **`--session-id <uuid>` pre-assigns the id** and `--resume <that uuid>` finds it later, so the app can choose ids instead of harvesting them from hooks. Hooks still confirm it.
4. **`--mcp-config <file> --strict-mcp-config` needs no approval prompt** for an HTTP server with a `headers` token, unlike project `.mcp.json`. Use this form for injection.
5. **Folder trust dialog (2.1.274):** "Quick safety check … ❯ No, exit / Yes, I trust this folder". Default is *No*, so blind Enter kills the session. Answer with Down+Enter, and match on `Yes,\s*I\s*trust\s*this\s*folder` because the TUI positions text with cursor moves and stripped output loses spaces. Acceptance is persisted per folder: it appeared once and never again for the same worktree. A real app should pre-trust worktree paths or answer this dialog.
6. **Prompt push recipe:** write the text, wait ~250 ms, write `\r`. Worked every time.
7. **Hooks via project `.claude/settings.json` in the worktree** fire fine with a `curl --data-binary @-` command. Add `.claude/` and `CLAUDE.md` to the target repo's `.git/info/exclude` so the agent does not commit them.
8. **node-pty via pnpm:** build scripts are skipped by default and the prebuilt `spawn-helper` ships without the execute bit (`posix_spawnp failed`). `chmod +x prebuilds/darwin-*/spawn-helper` or allow the build in `pnpm-workspace.yaml`.

## Still unknown (not tested here)

- Idle detection for Codex and OpenCode (no Stop hook). Deferred with decision 14.
- Behaviour when the subscription usage limit is hit mid-turn (decision 18).
- The bypass-permissions warning dialog never appeared because it was accepted earlier on this machine; a fresh machine will see it once.
