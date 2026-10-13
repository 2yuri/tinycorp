import type { DatabaseSync } from 'node:sqlite'
import { ACTIVITY_MIGRATION } from '../../features/activity'
import { APPROVAL_SUBJECT_MIGRATION, APPROVALS_MIGRATION } from '../../features/approvals'
import {
  BOARD_MIGRATION,
  COLUMN_ENTRIES_MIGRATION,
  TARGET_DUE_MIGRATION,
  TESTING_COLUMN_MIGRATION,
  TICKET_EXTRAS_MIGRATION,
  TICKET_LINKS_MIGRATION,
} from '../../features/board'
import {
  MCP_HEADERS_MIGRATION,
  MCP_SECRET_NAMES_MIGRATION,
  MCP_SERVERS_MIGRATION,
  SKILLS_MIGRATION,
} from '../../features/catalogue'
import {
  ATTACHMENTS_MIGRATION,
  CHANNEL_EXTRAS_MIGRATION,
  CHAT_DRAFTS_MIGRATION,
  CHAT_MIGRATION,
  CHAT_READ_MARKS_MIGRATION,
  MESSAGE_TARGET_MIGRATION,
  MESSAGE_TEST_RUN_MIGRATION,
} from '../../features/chat'
import { CODE_FLOW_MIGRATION, WORKTREE_BASE_FOLLOWS_TICKET_MIGRATION } from '../../features/code'
import { COMPANY_BOSS_PROFILE_MIGRATION, COMPANY_KEY_MIGRATION, COMPANY_VISITS_MIGRATION } from '../../features/company'
import { ENVIRONMENTS_MIGRATION } from '../../features/environments'
import { HIRING_MIGRATION, HIRING_PROPOSALS_MIGRATION } from '../../features/hiring'
import { ANSWERER_MIGRATION, INBOX_MIGRATION } from '../../features/inbox'
import { COMPANY_MEMORY_MIGRATION, NOTES_BUDGET_MIGRATION } from '../../features/memory'
import { NOTIFICATIONS_MIGRATION } from '../../features/notifications'
import { OFFICE_ROOM_MIGRATION } from '../../features/office'
import { ONBOARDING_MIGRATION, ONBOARDING_PROGRESS_MIGRATION } from '../../features/onboarding'
import { DAILY_DIGEST_MIGRATION, PLANNING_MIGRATION } from '../../features/planning'
import {
  REPOS_BRIEF_MIGRATION,
  REPOS_MIGRATION,
  REPOS_RUNG_MIGRATION,
  REPOS_STACK_COMMANDS_MIGRATION,
} from '../../features/repos'
import { RESTORE_POINTS_MIGRATION } from '../../features/restore-points'
import {
  REVIEW_COMMENTS_MIGRATION,
  REVIEW_FLOW_MIGRATION,
  REVIEW_THREADS_MIGRATION,
  SECURITY_PASS_MIGRATION,
} from '../../features/review'
import { RTK_MIGRATION } from '../../features/rtk'
import { SANDBOX_MIGRATION } from '../../features/sandbox'
import {
  BUILD_STYLE_MIGRATION,
  CAPACITY_MIGRATION,
  CAVEMAN_MIGRATION,
  GENERAL_WAKES_MIGRATION,
  PAUSE_MIGRATION,
  RESTORE_MIGRATION,
  SESSIONS_MIGRATION,
  TICKET_WAKES_MIGRATION,
} from '../../features/sessions'
import {
  EMPLOYEE_MODEL_MIGRATION,
  ROLE_FOLLOW_MIGRATION,
  SECURITY_ROLE_MIGRATION,
  STAFF_AREAS_MIGRATION,
  STAFF_DEFAULTS_MIGRATION,
  staffMigration,
} from '../../features/staff'
import { TEST_FLOW_MIGRATION, TESTING_SETTINGS_MIGRATION } from '../../features/testing'
import { USAGE_ROUTING_MIGRATION } from '../../features/usage'
import { COLLEAGUE_VOICE_MIGRATION } from '..'
import { type Migration, runMigrations } from '../database'

/**
 * Every step a Company's schema has ever taken, in the order it took them.
 *
 * A feature owns its own schema: the migration is declared beside the code that reads the tables
 * it makes, with its name on it. This list is the only place that says *when* each one ran, and it
 * is append-only — a name is never renamed and an entry never moves, because the runner applies by
 * name and a database that skipped a step has to be able to catch up from wherever it stopped.
 *
 * Until T184 this list and the runner were one file, so opening a database meant loading 45
 * features. `database.ts` is the runner now and knows none of them; this is the one place that
 * does, and only the composition path reaches it.
 */
export const migrations: Migration[] = [
  {
    name: 'company-table',
    sql: `CREATE TABLE company (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  },
  staffMigration,
  REPOS_MIGRATION,
  BOARD_MIGRATION,
  SESSIONS_MIGRATION,
  CHAT_MIGRATION,
  INBOX_MIGRATION,
  CAPACITY_MIGRATION,
  APPROVALS_MIGRATION,
  TICKET_WAKES_MIGRATION,
  HIRING_MIGRATION,
  CODE_FLOW_MIGRATION,
  NOTIFICATIONS_MIGRATION,
  RESTORE_MIGRATION,
  REVIEW_FLOW_MIGRATION,
  CHAT_READ_MARKS_MIGRATION,
  EMPLOYEE_MODEL_MIGRATION,
  COMPANY_VISITS_MIGRATION,
  ROLE_FOLLOW_MIGRATION,
  REPOS_STACK_COMMANDS_MIGRATION,
  COMPANY_KEY_MIGRATION,
  COMPANY_BOSS_PROFILE_MIGRATION,
  TICKET_EXTRAS_MIGRATION,
  COLUMN_ENTRIES_MIGRATION,
  HIRING_PROPOSALS_MIGRATION,
  GENERAL_WAKES_MIGRATION,
  PAUSE_MIGRATION,
  APPROVAL_SUBJECT_MIGRATION,
  ONBOARDING_MIGRATION,
  REPOS_BRIEF_MIGRATION,
  ANSWERER_MIGRATION,
  ACTIVITY_MIGRATION,
  REVIEW_COMMENTS_MIGRATION,
  OFFICE_ROOM_MIGRATION,
  RESTORE_POINTS_MIGRATION,
  CHANNEL_EXTRAS_MIGRATION,
  MCP_SERVERS_MIGRATION,
  SKILLS_MIGRATION,
  ONBOARDING_PROGRESS_MIGRATION,
  ATTACHMENTS_MIGRATION,
  REPOS_RUNG_MIGRATION,
  TARGET_DUE_MIGRATION,
  MESSAGE_TARGET_MIGRATION,
  STAFF_DEFAULTS_MIGRATION,
  PLANNING_MIGRATION,
  REVIEW_THREADS_MIGRATION,
  DAILY_DIGEST_MIGRATION,
  USAGE_ROUTING_MIGRATION,
  TESTING_COLUMN_MIGRATION,
  TEST_FLOW_MIGRATION,
  TESTING_SETTINGS_MIGRATION,
  MESSAGE_TEST_RUN_MIGRATION,
  COMPANY_MEMORY_MIGRATION,
  ENVIRONMENTS_MIGRATION,
  COLLEAGUE_VOICE_MIGRATION,
  RTK_MIGRATION,
  NOTES_BUDGET_MIGRATION,
  BUILD_STYLE_MIGRATION,
  CHAT_DRAFTS_MIGRATION,
  MCP_SECRET_NAMES_MIGRATION,
  SECURITY_ROLE_MIGRATION,
  SECURITY_PASS_MIGRATION,
  STAFF_AREAS_MIGRATION,
  MCP_HEADERS_MIGRATION,
  CAVEMAN_MIGRATION,
  TICKET_LINKS_MIGRATION,
  SANDBOX_MIGRATION,
  WORKTREE_BASE_FOLLOWS_TICKET_MIGRATION,
]

/** Brings `db` up to date: every migration whose name it has not recorded, in list order. */
export function migrate(db: DatabaseSync): void {
  runMigrations(db, migrations)
}
