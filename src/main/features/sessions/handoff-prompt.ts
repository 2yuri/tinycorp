/**
 * The prompt an Employee is handed when its Session moves to another Provider and when it moves
 * back (T173). The app writes it, never the agent: the new Session starts in the same worktree on
 * the same branch, and everything the old one knew that is not on disk goes in here.
 *
 * It is text, and nothing in it is a credential, a token or a path outside the Company.
 */

/** What the new Session is told, gathered by the engine at the moment of the switch. */
export interface RoutingHandoff {
  employee: { name: string; title: string }
  /** The Provider it was on, and the one it is on now, in the names the boss reads. */
  from: { provider: string; model: string | null }
  to: { provider: string; model: string | null }
  /** Why it moved: its own Provider ran out, or that Provider came back. */
  reason: 'out-of-budget' | 'moved-back'
  /** When the Provider it left comes back, in the words the chip uses; null when nothing said. */
  backAt: string | null
  /** The ticket it is on, or null when it is on none. */
  ticket: { code: string; title: string; body: string } | null
  /** The plan it wrote on the ticket, or null. */
  plan: string | null
  /** Where it works. The switch keeps both: a new Session, the same worktree and the same branch. */
  worktree: { path: string; branch: string } | null
  /** What `git status` says it has changed there so far. */
  diff: { paths: string[]; truncated: boolean } | null
  /** Review threads nobody has answered yet. */
  reviewThreads: { file: string | null; line: number | null; author: string; text: string }[]
  /** The last few messages of its channels, oldest first. */
  messages: { author: string; text: string }[]
  /** The wake of its own notes, as it stands (T193). Empty before its first `note`. */
  notes: string
  /**
   * The Company memory's Handoff page this switch wrote (T175), by slug, or null when none was
   * written. The page is the record the boss reads; the prompt is the copy the new Session gets.
   */
  memoryPage?: string | null
}

/** How many changed paths the summary names before it counts the rest. */
export const HANDOFF_PATHS_SHOWN = 10

/** How much of one quoted message or review comment the prompt carries. */
export const HANDOFF_QUOTE_MAX = 400

export function handoffPrompt(handoff: RoutingHandoff): string {
  const { employee, from, to, reason } = handoff
  const lines: string[] = []
  const why =
    reason === 'out-of-budget'
      ? `${from.provider} hit its usage limit, so this Session continues on ${to.provider}.`
      : `${from.provider} has reset, so this Session moves back to it from ${to.provider}.`
  lines.push(
    `[company] You are ${employee.name}, ${employee.title}. ${why} You are the same Employee, ` +
      'on the same ticket, in the same worktree and on the same branch — nothing was reset and ' +
      'nothing was merged. Pick up where the last Session stopped.',
  )
  if (handoff.backAt) lines.push(`${from.provider} is expected back at ${handoff.backAt}.`)
  if (to.model) lines.push(`You are running on ${to.provider} · ${to.model}.`)

  if (handoff.ticket) {
    lines.push('', `## Ticket ${handoff.ticket.code} — ${handoff.ticket.title}`, handoff.ticket.body.trim())
  } else {
    lines.push('', '## Ticket', 'You are on no ticket right now.')
  }

  if (handoff.plan) lines.push('', '## The plan you wrote', handoff.plan.trim())

  if (handoff.worktree) {
    lines.push('', '## Where you work', `${handoff.worktree.path} on branch ${handoff.worktree.branch}`)
  }

  lines.push('', '## What you have changed so far', changeSummary(handoff.diff))

  lines.push('', '## Open review threads')
  if (handoff.reviewThreads.length === 0) lines.push('None.')
  else {
    for (const thread of handoff.reviewThreads) {
      const where = thread.file ? `${thread.file}${thread.line === null ? '' : `:${thread.line}`}` : 'the pull request'
      lines.push(`- ${where} — ${thread.author}: ${clip(thread.text)}`)
    }
  }

  lines.push('', '## The last things said')
  if (handoff.messages.length === 0) lines.push('Nothing recent.')
  else for (const message of handoff.messages) lines.push(`- ${message.author}: ${clip(message.text)}`)

  lines.push('', '## Your notes')
  lines.push(handoff.notes.trim() === '' ? 'You have written no notes yet.' : handoff.notes.trim())

  if (handoff.memoryPage) {
    lines.push(
      '',
      `This handoff is also a page in the Company memory, \`${handoff.memoryPage}\`, claimed for you. ` +
        'When the ticket lands, the page closes with it.',
    )
  }
  lines.push(
    '',
    'Do not start the ticket again and do not re-plan it unless the plan above is wrong. ' +
      'Continue the next unfinished step.',
  )
  return lines.join('\n')
}

/**
 * The change as one line, naming the first paths and counting the rest. It is what `git status`
 * says, not a patch: the patch is on disk in the worktree the new Session opens in.
 */
function changeSummary(diff: RoutingHandoff['diff']): string {
  if (!diff || diff.paths.length === 0) return 'Nothing is changed in the worktree yet.'
  const shown = diff.paths.slice(0, HANDOFF_PATHS_SHOWN)
  const rest = diff.paths.length - shown.length
  const files = `${diff.paths.length} file${diff.paths.length === 1 ? '' : 's'}`
  const more = rest > 0 || diff.truncated ? ` and ${rest > 0 ? `${rest} ` : ''}more` : ''
  return `${files} changed: ${shown.join(', ')}${more}`
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= HANDOFF_QUOTE_MAX ? line : `${line.slice(0, HANDOFF_QUOTE_MAX - 1).trimEnd()}…`
}
