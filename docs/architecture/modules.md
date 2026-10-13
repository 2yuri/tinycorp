# The module map

Every file under `src/` outside the renderer, and which module owns it. It is the table
`src/architecture.test.ts` reads: rule 3 (a module is reached through its front door) is checked
against exactly this list, so a file that moves without moving here fails the suite.

The renderer is not listed. It is already foldered by feature, so its module is read off its path:
a file under `src/renderer/src/<name>/` belongs to module `renderer/<name>`, and the few files
directly under `src/renderer/src/` are the renderer's own composition root, `renderer`. Since T202
each of those folders has an `index.ts` too, and rule 3 holds for them the same way.

A test file belongs to the module of the file it tests — `foo.test.ts` follows `foo.ts`. A test
that stands on its own, named after a flow rather than a file, is listed here like any other file.

Paths are relative to `src/` and written with `/` on every platform. See `ARCHITECTURE.md` for
what the modules are allowed to do to each other.

### activity (7)

The append-only log of what the Company did (decision 36).

`main/features/activity/activity-sources.ts`, `main/features/activity/activity.ts`, `main/features/activity/index.ts`, `main/features/activity/ipc.ts`, `main/features/activity/wire.ts`, `shared/activity/index.ts`, `shared/activity/ipc.ts`

### app (37)

The composition root: the Electron process, the window, the menu, the tray, the updater. It wires every other module and nothing imports it.

`main/app/app-capture.ts`, `main/app/app-identity.ts`, `main/app/boss-name.ts`, `main/app/boss-profile-file.ts`, `main/app/crash-ipc.ts`, `main/app/crash-log.ts`, `main/app/e2e-mode.ts`, `main/app/keep-awake-file.ts`, `main/app/keep-awake-ipc.ts`, `main/app/keep-awake.ts`, `main/app/launcher-ipc.ts`, `main/app/menu/app-menu.ts`, `main/app/menu/application-menu.ts`, `main/app/recents-file.ts`, `main/app/rename-migration.ts`, `main/app/reveal-prompt.ts`, `main/app/shell-ipc.ts`, `main/app/single-instance.ts`, `main/app/smoke-run.ts`, `main/app/tray/background.ts`, `main/app/tray/electron-tray.ts`, `main/app/tray/menu-bar.ts`, `main/app/tray/tray-menu.ts`, `main/app/update-check.ts`, `main/app/updates-ipc.ts`, `main/app/window-chrome.ts`, `main/app/window-policy.ts`, `main/app/windows-machine-ipc.ts`, `main/app/windows-machine.ts`, `main/index.ts`, `shared/app/app-name.ts`, `shared/app/crash.ts`, `shared/app/keep-awake.ts`, `shared/app/menu.ts`, `shared/app/shortcuts.ts`, `shared/app/tray.ts`, `shared/app/updates.ts`

### approvals (10)

What an Employee must ask the boss before it does, and how it asks.

`main/features/approvals/approval-subject.ts`, `main/features/approvals/approvals.ts`, `main/features/approvals/index.ts`, `main/features/approvals/ipc.ts`, `main/features/approvals/tools.ts`, `main/features/approvals/wire.ts`, `shared/approvals/approval-subject.ts`, `shared/approvals/approval-summary.ts`, `shared/approvals/index.ts`, `shared/approvals/ipc.ts`

### board (13)

Tickets and the columns they move through.

`main/features/board/board.ts`, `main/features/board/column-entries.ts`, `main/features/board/facade.ts`, `main/features/board/index.ts`, `main/features/board/ipc.ts`, `main/features/board/ticket-extras.ts`, `main/features/board/ticket-links.ts`, `main/features/board/ticket-removal.ts`, `main/features/board/tools.ts`, `main/features/board/wire.ts`, `shared/ticket-extras.ts`, `shared/ticket-id.ts`, `shared/ticket-links.ts`, `shared/ticket-refs.ts`, `shared/url-links.ts`, `shared/ticket-removal.ts`

### architecture (1)

The boundaries, as a test. `architecture.test.ts` reads this map and holds every import in the repo to it; `doc-paths.test.ts` holds every document to the tree it describes.

`doc-paths.test.ts`

### build (1)

What `electron-builder` is told. Not part of the running app.

`build/packaging.ts`

### catalogue (13)

The Company’s MCP servers and skill folders, and who is granted them.

`main/features/catalogue/index.ts`, `main/features/catalogue/mcp-import.ts`, `main/features/catalogue/mcp-ipc.ts`, `main/features/catalogue/mcp-servers.ts`, `main/features/catalogue/mcp-sources.ts`, `main/features/catalogue/skill-sources.ts`, `main/features/catalogue/skill-worktrees.ts`, `main/features/catalogue/skills-ipc.ts`, `main/features/catalogue/skills.ts`, `main/features/catalogue/wire.ts`, `shared/catalogue/ipc.ts`, `shared/catalogue/mcp-import.ts`, `shared/catalogue/mcp-presets.ts`, `shared/catalogue/mcp-servers.ts`, `shared/catalogue/mcp-sources.ts`, `shared/catalogue/skill-sources.ts`, `shared/catalogue/skills.ts`

### chat (22)

Channels, DMs, messages, threads and attachments.

`main/features/chat/agent-pairs.ts`, `main/features/chat/attachments.ts`, `main/features/chat/channel-extras.ts`, `main/features/chat/channel-removal.ts`, `main/features/chat/chat-drafts.ts`, `main/features/chat/chat-read-marks.ts`, `main/features/chat/chat.ts`, `main/features/chat/employee-chats.ts`, `main/features/chat/facade.ts`, `main/features/chat/index.ts`, `main/features/chat/ipc.ts`, `main/features/chat/message-rows.ts`, `main/features/chat/thread-audience.ts`, `main/features/chat/tools.ts`, `main/features/chat/voice-ipc.ts`, `main/features/chat/wire.ts`, `shared/agent-pairs.ts`, `shared/attachments.ts`, `shared/channel-extras.ts`, `shared/channel-removal.ts`, `shared/drafts.ts`, `shared/employee-chats.ts`

### code (9)

Worktrees, branches, pull requests and the merge gate.

`main/features/code/code-flow.ts`, `main/features/code/facade.ts`, `main/features/code/index.ts`, `main/features/code/ipc.ts`, `main/features/code/merge-gate.ts`, `main/features/code/tools.ts`, `main/features/code/wire.ts`, `shared/code/index.ts`, `shared/code/ipc.ts`

### company (15)

Creating, opening, moving, renaming and forgetting a Company.

`main/features/company/boss-profile.ts`, `main/features/company/company-attention.ts`, `main/features/company/company-logo.ts`, `main/features/company/company-move-ipc.ts`, `main/features/company/company-move.ts`, `main/features/company/company-profile.ts`, `main/features/company/company-removal.ts`, `main/features/company/company-summaries.ts`, `main/features/company/facade.ts`, `main/features/company/index.ts`, `main/features/company/ipc.ts`, `main/features/company/missing-folders.ts`, `main/features/company/missing-marks-file.ts`, `main/features/company/profile-ipc.ts`, `main/features/company/wire.ts`, `shared/boss-profile.ts`

### domain (6)

The Company’s own words — an Employee, a Provider, a ticket Column, the boss, a channel id, a Result. No imports of its own, and every module may name them.

`shared/domain/board.ts`, `shared/domain/channels.ts`, `shared/domain/chat.ts`, `shared/domain/providers.ts`, `shared/domain/result.ts`, `shared/domain/staff.ts`

### core (22)

What a Company *is* — its SQLite database and which folder that file is in, the migration shape, its key, the two call edges — and, one folder down behind a front door of its own, the engine that wires every feature against it. Every feature reaches `core/index.ts`; only `core/engine` reaches a feature.

`main/core/colleague-voice.ts`, `main/core/company-context.ts`, `main/core/company-data-ignore.ts`, `main/core/company-databases.ts`, `main/core/company-key.ts`, `main/core/database-lock.test.ts`, `main/core/database.ts`, `main/core/engine/company-engine.ts`, `main/core/engine/company-mcp-server.ts`, `main/core/engine/facade.ts`, `main/core/engine/index.ts`, `main/core/engine/mcp-caller.ts`, `main/core/engine/migrations.ts`, `main/core/engine/options.ts`, `main/core/index.ts`, `main/core/ipc-kit.ts`, `main/core/mcp-kit.ts`, `main/core/recents.ts`, `main/core/testing.ts`, `main/core/ticket-input.ts`, `shared/colleague-voice.ts`, `shared/company.ts`, `shared/ipc/index.ts`

### environments (10)

The Company's secrets, and the commands that are allowed to use one (T176).

`main/features/environments/env-run.ts`, `main/features/environments/environment-runs.ts`, `main/features/environments/environments.ts`, `main/features/environments/facade.ts`, `main/features/environments/index.ts`, `main/features/environments/ipc.ts`, `main/features/environments/tools.ts`, `main/features/environments/wire.ts`, `shared/environments/index.ts`, `shared/environments/ipc.ts`

### files (23)

Reading and writing the files in a worktree, and the editors that open them.

`main/features/files/editor-choice-file.ts`, `main/features/files/editors-ipc.ts`, `main/features/files/editors.ts`, `main/features/files/facade.ts`, `main/features/files/file-changes.ts`, `main/features/files/file-tools.ts`, `main/features/files/file-writes.ts`, `main/features/files/files-ipc.ts`, `main/features/files/files.ts`, `main/features/files/index.ts`, `main/features/files/language-ipc.ts`, `main/features/files/language.ts`, `main/features/files/lsp-client.ts`, `main/features/files/path-links.ts`, `main/features/files/paths-ipc.ts`, `main/features/files/wire.ts`, `shared/files/editors.ts`, `shared/files/file-changes.ts`, `shared/files/file-edits.ts`, `shared/files/files.ts`, `shared/files/ipc.ts`, `shared/files/language.ts`, `shared/files/path-links.ts`

### forges (13)

Where a repo’s pull requests live: an adapter per forge, chosen from `origin`.

`main/forges/forge-conformance.ts`, `main/forges/forge-preflight.ts`, `main/forges/forge-registry.ts`, `main/forges/github/adapter.ts`, `main/forges/github/fake-gh.ts`, `main/forges/gitlab/adapter.ts`, `main/forges/gitlab/fake-glab.ts`, `main/forges/index.ts`, `main/forges/pr-details.ts`, `main/forges/run-forge.ts`, `main/forges/testing.ts`, `shared/forges/adapter.ts`, `shared/forges/index.ts`

### hiring (8)

Proposing, approving and making a hire.

`main/features/hiring/hiring-proposals.ts`, `main/features/hiring/hiring.ts`, `main/features/hiring/index.ts`, `main/features/hiring/ipc.ts`, `main/features/hiring/tools.ts`, `main/features/hiring/wire.ts`, `shared/hiring/index.ts`, `shared/hiring/ipc.ts`

### inbox (11)

What is waiting for an Employee, and what is waiting for the boss.

`main/features/inbox/answerer-ipc.ts`, `main/features/inbox/answerer.ts`, `main/features/inbox/boss-inbox.ts`, `main/features/inbox/index.ts`, `main/features/inbox/inbox.ts`, `main/features/inbox/ipc.ts`, `main/features/inbox/wire.ts`, `shared/inbox/answerer.ts`, `shared/inbox/boss-inbox.ts`, `shared/inbox/index.ts`, `shared/inbox/ipc.ts`

### memory (23)

An Employee’s own append-only note log (T193) and the Company’s shared wiki (T175).

`main/features/memory/company-memory-capture.ts`, `main/features/memory/company-memory-files.ts`, `main/features/memory/company-memory-git.ts`, `main/features/memory/company-memory-ipc.ts`, `main/features/memory/company-memory-page.ts`, `main/features/memory/company-memory-terms.ts`, `main/features/memory/company-memory-tools.ts`, `main/features/memory/company-memory.ts`, `main/features/memory/facade.ts`, `main/features/memory/index.ts`, `main/features/memory/notes-budget.ts`, `main/features/memory/notes-files.ts`, `main/features/memory/notes-ipc.ts`, `main/features/memory/notes-log.ts`, `main/features/memory/notes-migrate.ts`, `main/features/memory/notes-tools.ts`, `main/features/memory/notes-tree.ts`, `main/features/memory/notes-wake.ts`, `main/features/memory/notes.ts`, `main/features/memory/wire.ts`, `shared/memory/company-memory.ts`, `shared/memory/ipc.ts`, `shared/memory/notes.ts`

### notifications (8)

What the desktop is told, and when.

`main/features/notifications/index.ts`, `main/features/notifications/ipc.ts`, `main/features/notifications/native-notifications.ts`, `main/features/notifications/notification-icon.ts`, `main/features/notifications/notifications.ts`, `main/features/notifications/wire.ts`, `shared/notifications/index.ts`, `shared/notifications/ipc.ts`

### office (26)

The pixel office: rooms, desks, sprites and where everyone is.

`main/features/office/index.ts`, `main/features/office/ipc.ts`, `main/features/office/office-room.ts`, `main/features/office/office.ts`, `main/features/office/wire.ts`, `shared/office/at-work.ts`, `shared/office/boss.ts`, `shared/office/bubbles.ts`, `shared/office/characters.ts`, `shared/office/coffee-queue.ts`, `shared/office/counter.ts`, `shared/office/doors.ts`, `shared/office/garage-startup.ts`, `shared/office/greenhouse.ts`, `shared/office/ipc.ts`, `shared/office/layout.ts`, `shared/office/legend.ts`, `shared/office/logo-spots.ts`, `shared/office/movement.ts`, `shared/office/night-city.ts`, `shared/office/night-shift-room.ts`, `shared/office/painted-room.ts`, `shared/office/plumbob.ts`, `shared/office/projection.ts`, `shared/office/reading.ts`, `shared/office/rooms.ts`, `shared/office/scandi-daylight.ts`, `shared/office/warm-loft.ts`

### onboarding (6)

The first-run walk through setting a Company up.

`main/features/onboarding/index.ts`, `main/features/onboarding/ipc.ts`, `main/features/onboarding/onboarding.ts`, `main/features/onboarding/wire.ts`, `shared/onboarding/index.ts`, `shared/onboarding/ipc.ts`

### planning (10)

Plans, the questions they ask the boss, and the daily digest.

`main/features/planning/daily-digest.ts`, `main/features/planning/digest-ipc.ts`, `main/features/planning/index.ts`, `main/features/planning/ipc.ts`, `main/features/planning/planning.ts`, `main/features/planning/tools.ts`, `main/features/planning/wire.ts`, `shared/planning/daily-digest.ts`, `shared/planning/ipc.ts`, `shared/planning/planning.ts`

### platform (38)

The machine: paths, processes, CLIs, git, the OS secret store, WSL. It imports no feature and knows nothing about a Company.

`main/platform/cli-command.ts`, `main/platform/clipboard-copy.ts`, `main/platform/git-bash.ts`, `main/platform/git-exclude.ts`, `main/platform/git-runner.ts`, `main/platform/git-service.ts`, `main/platform/index.ts`, `main/platform/login-path.ts`, `main/platform/net/listen-on.ts`, `main/platform/node-pty-spawn.ts`, `main/platform/on-path.ts`, `main/platform/power-save-blocker.ts`, `main/platform/pty.ts`, `main/platform/run-cli.ts`, `main/platform/run-in.ts`, `main/platform/safe-storage-secrets.ts`, `main/platform/sandbox-runtime.ts`, `main/platform/secrets.ts`, `main/platform/shell-command.ts`, `main/platform/skill-folders.ts`, `main/platform/testing.ts`, `main/platform/wake-lock.ts`, `main/platform/wsl-network.ts`, `main/platform/wsl-path.ts`, `main/platform/wsl-runtime.ts`, `main/platform/wsl.ts`, `shared/platform/absolute-path.ts`, `shared/platform/assert-never.ts`, `shared/platform/clock-time.ts`, `shared/platform/company-folder.ts`, `shared/platform/git-bash.ts`, `shared/platform/machine-words.ts`, `shared/platform/redaction.ts`, `shared/platform/temporary-folder.ts`, `shared/platform/terminal-right-click.ts`, `shared/platform/wall-clock.ts`, `shared/platform/windows-machine.ts`, `shared/platform/wsl.ts`

### preload (2)

The bridge script. It forwards channels and nothing else.

`preload/index.d.ts`, `preload/index.ts`

### providers (29)

One adapter per CLI product an Employee’s Session can run on, and the conformance suite they all pass.

`main/providers/claude/account-config.ts`, `main/providers/claude/adapter.ts`, `main/providers/codex/adapter.ts`, `main/providers/example/adapter.ts`, `main/providers/example/cli-todo.ts`, `main/providers/example/cli.ts`, `main/providers/example/filled.ts`, `main/providers/hooks/hook-receiver.ts`, `main/providers/index.ts`, `main/providers/integration/claude-credential.ts`, `main/providers/integration/codex-credential.ts`, `main/providers/integration/opencode-credential.ts`, `main/providers/opencode/adapter.ts`, `main/providers/opencode/plugin.ts`, `main/providers/orchestrator-env.ts`, `main/providers/preflight-ipc.ts`, `main/providers/preflight.ts`, `main/providers/provider-adapter.ts`, `main/providers/provider-conformance.ts`, `main/providers/provider-hooks.ts`, `main/providers/provider-preflight.ts`, `main/providers/provider-registry.ts`, `main/providers/provider-runtimes.ts`, `main/providers/session-files.ts`, `main/providers/subscription-env.ts`, `main/providers/testing.ts`, `main/providers/wsl-adapter.ts`, `shared/providers/claude-usage.ts`, `shared/providers/preflight.ts`, `shared/providers/slash-commands.ts`

### repos (17)

The Company’s repos: finding them, reading their stack, and the rules each one runs under.

`main/features/repos/facade.ts`, `main/features/repos/index.ts`, `main/features/repos/ipc.ts`, `main/features/repos/nearby-repos.ts`, `main/features/repos/repo-init.ts`, `main/features/repos/repo-inspector.ts`, `main/features/repos/repo-remote.ts`, `main/features/repos/repo-rules.ts`, `main/features/repos/repo-scan.ts`, `main/features/repos/repo-walk.ts`, `main/features/repos/repos.ts`, `main/features/repos/stack-detection.ts`, `main/features/repos/tools.ts`, `main/features/repos/wire.ts`, `shared/repos/found-repos.ts`, `shared/repos/ipc.ts`, `shared/repos/repo-line.ts`, `shared/repos/repo.ts`

### restore-points (7)

A worktree’s snapshots, and putting one back.

`main/features/restore-points/index.ts`, `main/features/restore-points/ipc.ts`, `main/features/restore-points/restore-points-git.ts`, `main/features/restore-points/restore-points.ts`, `main/features/restore-points/wire.ts`, `shared/restore-points/index.ts`, `shared/restore-points/ipc.ts`

### review (17)

Diffs, line comments, review threads and rounds, and the security pass that reads the same change beside them (T241).

`main/features/review/facade.ts`, `main/features/review/index.ts`, `main/features/review/ipc.ts`, `main/features/review/review-comments.ts`, `main/features/review/review-diff.ts`, `main/features/review/review-flow.ts`, `main/features/review/review-threads.ts`, `main/features/review/security-flow.ts`, `main/features/review/tools.ts`, `main/features/review/wire.ts`, `shared/review/diff-parse.ts`, `shared/review/index.ts`, `shared/review/ipc.ts`, `shared/review/review-diff.ts`, `shared/review/review-entry.ts`, `shared/review/review-threads.ts`, `shared/review/security.ts`

### rtk (6)

Compressing what an Employee reads before it reads it (T179).

`main/features/rtk/index.ts`, `main/features/rtk/ipc.ts`, `main/features/rtk/rtk.ts`, `main/features/rtk/wire.ts`, `shared/rtk/index.ts`, `shared/rtk/ipc.ts`

### sandbox (6)

Running every Employee’s Session inside ai-jail, when the boss turns the add-on on (T260).

`main/features/sandbox/index.ts`, `main/features/sandbox/ipc.ts`, `main/features/sandbox/sandbox.ts`, `main/features/sandbox/wire.ts`, `shared/sandbox/index.ts`, `shared/sandbox/ipc.ts`

### sessions (31)

A Session’s life: starting it, its instructions, its terminal, its wakes, its sub-sessions.

`main/features/sessions/brief.ts`, `main/features/sessions/build-style-ipc.ts`, `main/features/sessions/build-style.ts`, `main/features/sessions/capacity-ipc.ts`, `main/features/sessions/capacity.ts`, `main/features/sessions/caveman-ipc.ts`, `main/features/sessions/caveman.ts`, `main/features/sessions/facade.ts`, `main/features/sessions/general-wakes.ts`, `main/features/sessions/handoff-prompt.ts`, `main/features/sessions/index.ts`, `main/features/sessions/instructions.ts`, `main/features/sessions/ipc.ts`, `main/features/sessions/pause.ts`, `main/features/sessions/restore.ts`, `main/features/sessions/sessions.ts`, `main/features/sessions/spawn-settings-ipc.ts`, `main/features/sessions/spawn-settings.ts`, `main/features/sessions/sub-session-git.ts`, `main/features/sessions/sub-sessions.ts`, `main/features/sessions/subagents.ts`, `main/features/sessions/terminal-ipc.ts`, `main/features/sessions/terminals.ts`, `main/features/sessions/thread-wakes.ts`, `main/features/sessions/ticket-wakes.ts`, `main/features/sessions/tools.ts`, `main/features/sessions/wire.ts`, `shared/build-style.ts`, `shared/capacity.ts`, `shared/caveman.ts`, `shared/session.ts`, `shared/spawn-settings.ts`, `shared/sub-sessions.ts`, `shared/subagents.ts`

### staff (13)

Roles, Employees and what each one is allowed to do.

`main/features/staff/capability-routing.ts`, `main/features/staff/facade.ts`, `main/features/staff/index.ts`, `main/features/staff/ipc.ts`, `main/features/staff/role-follow.ts`, `main/features/staff/staff-defaults.ts`, `main/features/staff/staff.ts`, `main/features/staff/wire.ts`, `shared/staff/ipc.ts`, `shared/staff/models.ts`, `shared/staff/role-follow.ts`, `shared/staff/role-templates.ts`, `shared/staff/roster-draft.ts`, `shared/staff/team-presets.ts`

### testing (10)

The QA pass a ticket gets after review (T174).

`main/features/testing/app-runs.ts`, `main/features/testing/facade.ts`, `main/features/testing/index.ts`, `main/features/testing/ipc.ts`, `main/features/testing/test-flow.ts`, `main/features/testing/test-settings.ts`, `main/features/testing/tools.ts`, `main/features/testing/wire.ts`, `shared/testing/index.ts`, `shared/testing/ipc.ts`

### usage (16)

Subscription accounts, what they have spent, and which one a Session runs on.

`main/features/usage/accounts-file.ts`, `main/features/usage/facade.ts`, `main/features/usage/index.ts`, `main/features/usage/outages-file.ts`, `main/features/usage/provider-accounts.ts`, `main/features/usage/provider-logins.ts`, `main/features/usage/provider-usage.ts`, `main/features/usage/routing-ipc.ts`, `main/features/usage/sign-in-ipc.ts`, `main/features/usage/sign-in.ts`, `main/features/usage/usage-ipc.ts`, `main/features/usage/usage-limits.ts`, `main/features/usage/usage-routing.ts`, `main/features/usage/wire.ts`, `shared/usage/ipc.ts`, `shared/usage/provider-accounts.ts`, `shared/usage/provider-usage.ts`, `shared/usage/sign-in.ts`, `shared/usage/usage-routing.ts`
