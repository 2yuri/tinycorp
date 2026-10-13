import type { LucideIcon } from 'lucide-react'
import {
  BookMarked,
  FlaskConical,
  FolderGit2,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  Repeat,
  ShieldCheck,
  SquareKanban,
  Terminal,
  Trash2,
  UserPlus,
  Wallet,
} from 'lucide-react'
import type { ActivityEvent, ActivityKind } from '../../../shared/activity'
import { BOSS } from '../../../shared/domain/chat'

/** The tint of a row's 26×26 kind chip, as the design paints them. */
export type ActivityTone = 'neutral' | 'primary' | 'success' | 'warning' | 'info' | 'quiet'

interface KindLook {
  icon: LucideIcon
  tone: ActivityTone
}

const LOOKS: Record<ActivityKind, KindLook> = {
  ticket_created: { icon: SquareKanban, tone: 'neutral' },
  ticket_moved: { icon: SquareKanban, tone: 'neutral' },
  ticket_assigned: { icon: SquareKanban, tone: 'neutral' },
  ticket_unblocked: { icon: SquareKanban, tone: 'success' },
  ticket_deleted: { icon: Trash2, tone: 'quiet' },
  epic_created: { icon: SquareKanban, tone: 'neutral' },
  memory_captured: { icon: BookMarked, tone: 'info' },
  worktree_opened: { icon: GitCommitHorizontal, tone: 'neutral' },
  pull_request_opened: { icon: GitPullRequest, tone: 'primary' },
  review_requested: { icon: FlaskConical, tone: 'primary' },
  review_submitted: { icon: FlaskConical, tone: 'success' },
  merged: { icon: GitMerge, tone: 'success' },
  message_posted: { icon: MessageSquare, tone: 'quiet' },
  hire_proposed: { icon: UserPlus, tone: 'info' },
  employee_hired: { icon: UserPlus, tone: 'info' },
  employee_fired: { icon: UserPlus, tone: 'info' },
  budget_exhausted: { icon: Wallet, tone: 'warning' },
  concurrency_cap_changed: { icon: Wallet, tone: 'warning' },
  provider_switched: { icon: Repeat, tone: 'warning' },
  provider_reset: { icon: Repeat, tone: 'success' },
  approval_requested: { icon: ShieldCheck, tone: 'warning' },
  approval_decided: { icon: ShieldCheck, tone: 'success' },
  session_started: { icon: Terminal, tone: 'quiet' },
  session_stopped: { icon: Terminal, tone: 'quiet' },
  repo_connected: { icon: FolderGit2, tone: 'quiet' },
}

export function activityLook(kind: ActivityKind): KindLook {
  return LOOKS[kind]
}

/** The boss reads as `You` in their own feed; everyone else by name. */
export function actorLabel(event: ActivityEvent): string {
  return event.actorId === BOSS ? 'You' : event.actorName
}

/** One tile of the right rail's TODAY panel. */
export interface ActivityStat {
  key: string
  label: string
  value: number
}

/**
 * The four tiles, and where they depart from the frame. The frame counts `commits` and
 * `tickets closed`; the log has no commit event and no closed-ticket event (`ACTIVITY_GROUP_OF`
 * has `ticket_moved`, which says nothing about which column it moved to), so a tile for either
 * would have to count something it cannot see. They count `tickets opened` and `merges` instead
 * — both real kinds — and the frame's fourth tile, `$84 spent`, is gone with the rest of the
 * per-dollar accounting (decisions 3, 18 and 31). Every number here comes from the log.
 */
const TODAY_STATS: { key: string; label: string; kinds: ActivityKind[] }[] = [
  { key: 'tickets-opened', label: 'tickets opened', kinds: ['ticket_created'] },
  { key: 'prs-opened', label: 'PRs opened', kinds: ['pull_request_opened'] },
  { key: 'merges', label: 'merges', kinds: ['merged'] },
  { key: 'approvals', label: 'approvals decided', kinds: ['approval_decided'] },
]

/** Counts today's events per tile. Every number comes from the log, never from a sample. */
export function todayStats(events: ActivityEvent[], now: Date): ActivityStat[] {
  const today = events.filter((event) => sameDay(new Date(event.createdAt), now))
  return TODAY_STATS.map(({ key, label, kinds }) => ({
    key,
    label,
    value: today.filter((event) => kinds.includes(event.kind)).length,
  }))
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** How long a Session has been up, as the design's `42m`: minutes, then hours, then days. */
export function elapsedLabel(startedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/** The log as a file the boss can keep: one line per event, oldest first. */
export function activityCsv(events: ActivityEvent[]): string {
  const header = ['when', 'kind', 'actor', 'summary', 'detail', 'subject']
  const rows = [...events]
    .reverse()
    .map((event) => [
      event.createdAt,
      event.kind,
      event.actorName,
      event.summary,
      event.detail ?? '',
      event.subject?.label ?? '',
    ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
