import { CircleSlash, GitPullRequest, type LucideIcon, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import {
  RISK_CLASSES,
  SECURITY_SCOPE_HELP,
  SECURITY_SCOPE_LABEL,
  SECURITY_SCOPES,
  type SecurityScope,
} from '../../../shared/review/security'
import { SegmentedControl, SettingsCard } from '../ui'
import '../ui/tailwind.css'

/** The three chips, the same track the Testing card's WHO TESTS draws (frame `YatUW`, card c). */
const FIELD = 'flex flex-col gap-6'
const TRACK = 'flex gap-3 rounded-sm border border-border bg-muted p-2'
const OPTION =
  'flex h-26 flex-[1_1_0] cursor-pointer items-center justify-center gap-6 rounded-sm border-0 p-0 px-10 text-12/[inherit] font-semibold has-[>[data-slot=choice-input]:focus-visible]:shadow-focus has-[>[data-slot=choice-input]:focus-visible]:outline-none'
const OPTION_OFF = 'bg-transparent text-muted-foreground'
const OPTION_ON = 'bg-primary text-primary-foreground'
const HELP = 'm-0 text-11-5/17 text-muted-foreground'

const SCOPE_ICON: Record<SecurityScope, LucideIcon> = {
  risky: ShieldAlert,
  every: GitPullRequest,
  off: CircleSlash,
}

const api = window.tinyCorp.reviews

/**
 * Which PRs get a security pass, in Company settings (T241).
 *
 * The default is the narrow one, so a Company that hires a Security Employee does not quietly
 * spend a Session on every pull request; the card says which paths that is, because a rule nobody
 * can see is one the boss cannot disagree with.
 */
export function SecurityScopeSetting() {
  const [scope, setScope] = useState<SecurityScope | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = useId()

  const refresh = useCallback(async () => {
    const result = await api.securityScope()
    if (!result.ok) return setError(result.error)
    setScope(result.value)
  }, [])

  useEffect(() => {
    void refresh()
    return api.onChanged(() => void refresh())
  }, [refresh])

  if (scope === null) return null
  return (
    <SettingsCard
      title="Security pass"
      sub="A Security Employee reads the change beside the reviewer. A high finding holds the merge until it is fixed or you override it."
    >
      <div className={FIELD}>
        <SegmentedControl
          label="Which PRs"
          name={name}
          value={scope}
          classes={{ track: TRACK, option: OPTION, on: OPTION_ON, off: OPTION_OFF }}
          options={SECURITY_SCOPES.map((value) => ({
            value,
            label: SECURITY_SCOPE_LABEL[value],
            icon: SCOPE_ICON[value],
          }))}
          onChange={(next) =>
            void api.setSecurityScope(next).then((result) => {
              setError(result.ok ? null : result.error)
              if (result.ok) setScope(result.value)
            })
          }
        />
        <p className={HELP}>{SECURITY_SCOPE_HELP[scope]}</p>
        {scope === 'risky' && (
          <p className={HELP}>
            Risky is {RISK_CLASSES.map((risk) => risk.label).join(', ')} — and any ticket you label{' '}
            <code>security</code>.
          </p>
        )}
        {error && <p className="m-0 text-11-5/[inherit] text-brand-danger">{error}</p>}
      </div>
    </SettingsCard>
  )
}
