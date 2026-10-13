import { Check, FolderGit2, Pencil } from 'lucide-react'
import { useId, useState } from 'react'
import type { Repo } from '../../../shared/repos/repo'
import { repoLine } from '../../../shared/repos/repo-line'
import { cx } from '../ui'
import { repoChoices, toggleRepo } from './repo-scope'

/** The row's own label, and the New Ticket modal's and the drawer's, which all say the same thing. */
export const FIELD_LABEL =
  'm-0 text-11/[normal] font-bold tracking-[0.5px] whitespace-nowrap text-muted-foreground uppercase'

/** The line under the chips; red when it is carrying the error. */
const HINT = 'text-12/[inherit] font-normal text-muted-foreground'

const CHIP =
  'm-0 inline-flex max-w-full cursor-pointer items-center gap-6 rounded-full border px-10 py-7 font-code text-12-5/[inherit] font-normal whitespace-nowrap [&_span]:overflow-hidden [&_span]:text-ellipsis [&_svg]:shrink-0 focus-visible:shadow-focus focus-visible:outline-none'

export interface RepoChipsProps {
  /** The margin the row wears, which is its parent's to set: the modal and the drawer differ. */
  className?: string
  /** The Company's repos; every one is offered. */
  repos: Repo[]
  selected: string[]
  onChange(selected: string[]): void
  error?: string | null
  /** The line under the chips; the New Ticket modal and the ticket drawer word it differently. */
  hint?: string
}

/**
 * Past this many repos in the Company the row starts folded into one line — `banking, payment,
 * card-issuing, … +107` and an Edit button — because a hundred chips is taller than the drawer (T285).
 */
export const REPO_CHIPS_FOLD_AT = 12

/** The repos a ticket works in, as a multi-select chip row (decision 32, design `Y5daiS`). */
export function RepoChips(props: RepoChipsProps) {
  const labelId = useId()
  const choices = repoChoices(props.repos, props.selected)
  const [editing, setEditing] = useState(false)
  const folded = !editing && choices.length > REPO_CHIPS_FOLD_AT
  return (
    <fieldset
      className={cx('flex min-w-0 flex-col gap-6 font-sans leading-[normal]', props.className)}
      aria-labelledby={labelId}
    >
      <span id={labelId} className={FIELD_LABEL}>
        Repositories
      </span>
      {folded ? (
        <FoldedRepos
          names={choices.filter((repo) => props.selected.includes(repo.id)).map((repo) => repo.name)}
          error={Boolean(props.error)}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-8">
          {choices.length === 0 && <span className={HINT}>No repositories yet.</span>}
          {choices.map((repo) => {
            const on = props.selected.includes(repo.id)
            const Icon = on ? Check : FolderGit2
            return (
              <button
                key={repo.id}
                type="button"
                className={cx(
                  CHIP,
                  on
                    ? 'border-primary bg-primary-subtle text-foreground [&_svg]:text-primary'
                    : cx(
                        'bg-card text-muted-foreground hover:border-muted-foreground [&_svg]:text-muted-foreground',
                        props.error ? 'border-destructive' : 'border-border',
                      ),
                )}
                aria-pressed={on}
                onClick={() => props.onChange(toggleRepo(props.selected, repo.id))}
              >
                <Icon size={14} aria-hidden />
                <span>{repo.name}</span>
              </button>
            )
          })}
          {editing && (
            <button type="button" className={cx(EDIT, 'ml-auto')} onClick={() => setEditing(false)}>
              Done
            </button>
          )}
        </div>
      )}
      <span className={cx(HINT, props.error && 'text-status-error-foreground')}>
        {props.error ?? props.hint ?? 'One worktree and one PR per selected repo.'}
      </span>
    </fieldset>
  )
}

const EDIT =
  'm-0 inline-flex shrink-0 cursor-pointer items-center gap-4 rounded-sm border border-border bg-transparent px-8 py-3 font-sans text-12/[normal] text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

/** The picked repos as one line, and the button that opens the chips again (T285). */
function FoldedRepos(props: { names: string[]; error: boolean; onEdit(): void }) {
  const line = repoLine(props.names)
  return (
    <div
      data-slot="repo-line"
      className={cx(
        'flex min-w-0 items-center gap-8 rounded-sm border bg-card px-10 py-8 [&>svg]:shrink-0 [&>svg]:text-primary',
        props.error ? 'border-destructive' : 'border-border',
      )}
      title={line.all || undefined}
    >
      <FolderGit2 size={14} aria-hidden />
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-code text-12-5/[normal] text-foreground">
        {props.names.length === 0 ? (
          <span className="font-sans text-muted-foreground">No repositories picked</span>
        ) : (
          line.text
        )}
      </span>
      {line.more > 0 && (
        <span className="shrink-0 font-bold font-code text-12-5/[normal] text-foreground">+{line.more}</span>
      )}
      <button type="button" className={EDIT} onClick={props.onEdit}>
        <Pencil size={12} aria-hidden />
        Edit
      </button>
    </div>
  )
}
