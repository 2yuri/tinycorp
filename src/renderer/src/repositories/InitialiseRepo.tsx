import { GitBranchPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RepoInspection, RepoStartPlan } from '../../../shared/repos/repo'
import { Alert, Button, cx } from '../ui'
import { INIT_ALERT, INIT_ERROR, INIT_TEXT } from './repo-classes'
import '../ui/tailwind.css'

export const NOT_A_REPO_TITLE = 'Not a git repository yet'

export const CANNOT_START_TITLE = 'A repository cannot start here'

/** What the alert says starting the repo does, once the folder has been read (T144). */
export function initialiseText(plan: RepoStartPlan | null): string {
  const tail =
    'on main, with one first commit on your git identity. No remote is added, so pull requests wait until one exists.'
  if (plan?.kind === 'in-place') {
    const files = `${plan.files} ${plan.files === 1 ? 'file' : 'files'}`
    return `Starts the repo in place: the ${files} here are kept as they are and committed ${tail}`
  }
  if (plan?.kind === 'empty' || plan?.kind === 'new-folder') return `Starts an empty repository ${tail}`
  return `Creates a repository ${tail}`
}

/**
 * Shown wherever a repo is attached and the chosen folder has no `.git`: offers to start one there
 * — in place, keeping what the folder holds — and hands the new repo back to the attach flow. A
 * folder inside another repo's worktree is refused, with the reason, and offers nothing.
 */
export function InitialiseRepoAlert(props: {
  path: string
  onInitialised(inspection: RepoInspection): void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<RepoStartPlan | null>(null)

  useEffect(() => {
    let live = true
    setPlan(null)
    void window.tinyCorp.repos.planStart(props.path).then((found) => live && setPlan(found))
    return () => {
      live = false
    }
  }, [props.path])

  async function initialise() {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.tinyCorp.repos.initialise(props.path)
      if (!result.ok) return setError(result.error)
      setError(null)
      props.onInitialised(result.value)
    } finally {
      setBusy(false)
    }
  }

  const className = cx(INIT_ALERT, props.className)
  if (plan?.kind === 'refused') {
    return (
      <Alert variant="error" title={CANNOT_START_TITLE} className={className}>
        <span className={INIT_TEXT}>{plan.reason}</span>
      </Alert>
    )
  }

  return (
    <Alert variant="warning" title={NOT_A_REPO_TITLE} className={className}>
      <span className={INIT_TEXT}>{initialiseText(plan)}</span>
      {error && (
        <span className={INIT_ERROR} role="alert">
          {error}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        icon={GitBranchPlus}
        disabled={busy}
        onClick={() => void initialise()}
      >
        {busy ? 'Initialising…' : 'Initialise repository'}
      </Button>
    </Alert>
  )
}
