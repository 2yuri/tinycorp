import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate, migrations } from './migrations'

/**
 * The schema a Company really has, as a list of names in the order they were applied.
 *
 * It is copied from the list as it stood before T184 moved each step into the feature that owns
 * it, and it is the check that the move changed nothing: a database written by an older build
 * records these names, and the runner applies by name, so a name that changed here is a step that
 * runs twice — or never — on a Company that already exists.
 *
 * Adding a migration adds one line at the end of this list. Editing any other line is a bug.
 */
const APPLIED = [
  'company-table',
  'staff-tables',
  'repos-table',
  'board-tables',
  'sessions-table',
  'chat-tables',
  'inbox-table',
  'capacity-settings',
  'approvals-tables',
  'ticket-wakes-inbox-and-epic-channels',
  'hiring-fired-employees-and-staffing-requests',
  'code-flow-worktrees-and-pull-requests',
  'notifications-setting',
  'restore-session-restore',
  'review-flow-reviews-and-merges',
  'chat-boss-read-marks',
  'staff-employee-model',
  'company-visits-last-opened',
  'staff-employee-overrides',
  'repos-stack-commands',
  'company-key',
  'company-boss-profile',
  'board-ticket-priority-labels-base-branch-epic-color',
  'board-ticket-column-entries',
  'hiring-proposals-and-max-headcount',
  'inbox-general-folded-messages',
  'sessions-pause',
  'approvals-ticket-and-pull-request',
  'company-onboarding-completed',
  'repo-brief',
  'company-answerer-and-thread-answerers',
  'activity-event-log',
  'review-line-comments',
  'company-office-room',
  'restore-points-per-worktree',
  'chat-channel-topic-and-message-pins',
  'mcp-server-catalogue-and-grants',
  'skill-catalogue-and-grants',
  'company-onboarding-progress',
  'chat-message-attachments',
  'repo-rung',
  'board-target-due',
  'chat-message-target',
  'staff-company-defaults',
  'planning-plans-and-questions',
  'review-threads-and-round-limit',
  'chat-daily-digest',
  'usage-routing-rules-and-employee-overrides',
  'board-testing-column',
  'testing-runs-steps-and-screenshots',
  'testing-who-tests-and-per-repo-overrides',
  'chat-message-test-run',
  'company-memory-pages-index',
  'environments-variables-and-env-run-requests',
  'company-colleague-voice',
  'rtk-command-output-compression',
  'notes-wake-budget',
  'company-build-style',
  'chat-composer-drafts',
  'mcp-server-secret-names',
  'staff-security-role',
  'review-security-pass',
  'staff-areas',
  'mcp-server-header-auth',
  'company-caveman',
  'board-ticket-dependency',
  'sandbox-add-on',
  'worktree-base-follows-ticket',
]

describe('The Company schema', () => {
  it('is these steps, in this order: every name a database on an older build already recorded', () => {
    expect(migrations.map((migration) => migration.name)).toEqual(APPLIED)
  })

  it('applies every one of them to a fresh database, and records each by name', () => {
    const db = new DatabaseSync(':memory:')

    migrate(db)

    const applied = (db.prepare('SELECT name FROM schema_migration').all() as { name: string }[]).map((r) => r.name)
    expect(new Set(applied)).toEqual(new Set(APPLIED))
    // Running it again is a no-op: the runner applies what a database has not recorded, nothing else.
    expect(() => migrate(db)).not.toThrow()
    db.close()
  })

  it('names each step once, so the runner can never skip one it has already seen under another name', () => {
    expect(new Set(APPLIED).size).toBe(APPLIED.length)
  })
})
