import { RefreshCw, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { APPLIES_NEXT_SESSION, type SpawnSetting, staleLine } from '../../../shared/spawn-settings'
import { refreshIpcResource, resources, useIpcResource } from '../ipc'
import { Button } from '../ui'
import '../ui/tailwind.css'
import { CARD_ERROR } from './settings-classes'

const api = window.tinyCorp

/**
 * The strip, as the frames draw it inside the card: `$--secondary`, a hairline, 10 by 12.
 *
 * An inset ring rather than a border, the way the add-on card draws its own: nothing here sets
 * `box-sizing`, so a border would land outside the padding and push the strip 2px wider than the
 * card it sits in.
 */
const STRIP = 'flex flex-col gap-8 rounded-sm inset-ring-1 inset-ring-border bg-secondary px-12 py-10'
const ROW = 'flex items-center gap-10'
const NOTE = 'm-0 min-w-0 flex-1 text-12/[normal] font-medium text-foreground'
const MARK = 'shrink-0 text-muted-foreground'
const STILL = 'm-0 text-11-5 text-muted-foreground'

/** The frame draws a smaller outline button than the kit's `sm`: 12px label, 6 by 10. */
const APPLY = 'px-10 py-6 text-12/[normal]'

/**
 * What a setting that is written into an Employee's instructions at spawn says for itself (T237,
 * frames `Cg3a8` and `ttODp`).
 *
 * Three settings are read once, when a Session starts — how Employees talk, what they remember and
 * Lean builder — so a change reaches a running Session at its next start and not before. The card
 * says so, names who is still on the old one, and offers `Apply now`, which restarts every idle
 * Session where it stands with its conversation resumed. A busy Employee is never interrupted: it
 * is restarted the moment its turn ends.
 *
 * It draws nothing while nobody is behind, which is what makes it a note *after a change*: before
 * one, every running Session already carries what the boss is looking at.
 */
export function AppliesNextSession({ setting }: { setting: SpawnSetting }) {
  const [error, setError] = useState<string | null>(null)
  // Every card reads the one list and keeps the Employees its own setting left behind, so the
  // voice card never names somebody who is only behind on the notes budget.
  const stale = useIpcResource(resources.staleSessions).filter((session) => session.settings.includes(setting))

  if (stale.length === 0) return null

  async function applyNow() {
    const result = await api.spawnSettings.applyNow()
    setError(result.ok ? null : result.error)
    refreshIpcResource(resources.staleSessions)
  }

  return (
    <div className={STRIP} data-slot="applies-next-session">
      <div className={ROW}>
        <RotateCcw className={MARK} size={14} aria-hidden />
        <p className={NOTE}>{APPLIES_NEXT_SESSION}</p>
        <Button variant="outline" size="sm" icon={RefreshCw} className={APPLY} onClick={() => void applyNow()}>
          Apply now
        </Button>
      </div>
      <p className={STILL}>{staleLine(stale)}</p>
      {error && <p className={CARD_ERROR}>{error}</p>}
    </div>
  )
}
