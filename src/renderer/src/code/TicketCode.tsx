import { GitBranch, GitPullRequestArrow } from 'lucide-react'
import type { TicketCode as Code } from '../../../shared/code'
import { Badge } from '../ui'
import { prState } from './ticket-code-model'
import '../ui/tailwind.css'

/**
 * The top of the drawer's CODE & REVIEW card (design `Izdc9`): one row per worktree — the branch
 * in mono with a `worktree` badge — and one per PR, with the state badge beside it. The rows are
 * handed the ticket's code; the board reads it once for every card and the drawer alike.
 */
export function TicketCode({
  code,
  repos,
  repoName,
}: {
  code: Code | undefined
  /** The ticket's repos, so a ticket working in several says which row is which. */
  repos: string[]
  repoName(id: string): string
}) {
  const worktrees = code?.worktrees ?? []
  const many = repos.length > 1
  if (worktrees.length === 0) {
    return (
      <ul className="m-0 flex w-full list-none flex-col gap-7 p-0">
        <li className="flex min-w-0 items-center gap-8 font-sans leading-[normal]">
          <GitBranch className="shrink-0 text-muted-foreground" size={14} aria-hidden />
          <span className="text-13/[inherit] text-muted-foreground">No branch yet</span>
        </li>
      </ul>
    )
  }
  return (
    <ul className="m-0 flex w-full list-none flex-col gap-7 p-0">
      {worktrees.map((worktree) => {
        const pr = code ? prState(code, worktree.repoId) : { kind: 'none' as const }
        return (
          <li key={worktree.repoId} className="flex flex-col gap-7">
            <span className="flex min-w-0 items-center gap-8 font-sans leading-[normal]">
              <GitBranch className="shrink-0 text-muted-foreground" size={14} aria-hidden />
              {many && (
                <span className="shrink-0 font-semibold text-12/[inherit] text-muted-foreground">
                  {repoName(worktree.repoId)}
                </span>
              )}
              <code
                className="overflow-hidden text-ellipsis whitespace-nowrap font-code text-12-5/[inherit] text-foreground"
                title={worktree.path}
              >
                {worktree.branch}
              </code>
              <Badge variant="neutral">worktree</Badge>
            </span>
            <span className="flex min-w-0 items-center gap-8 font-sans leading-[normal]">
              <GitPullRequestArrow className="shrink-0 text-muted-foreground" size={14} aria-hidden />
              {pr.kind === 'open' ? (
                <>
                  <a
                    className="overflow-hidden text-ellipsis whitespace-nowrap text-13/[inherit] text-foreground no-underline hover:underline"
                    href={pr.pr.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {pr.pr.number === null ? pr.pr.url : `#${pr.pr.number}`}
                  </a>
                  <Badge variant="success">Open</Badge>
                </>
              ) : pr.kind === 'refused' ? (
                <>
                  <span className="text-13/[inherit] text-muted-foreground" role="status">
                    {pr.refusal.reason}
                  </span>
                  <Badge variant="warning">{pr.refusal.badge}</Badge>
                </>
              ) : (
                <span className="text-13/[inherit] text-muted-foreground">No PR yet</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
