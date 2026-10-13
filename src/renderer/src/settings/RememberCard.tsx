import { useCallback, useEffect, useState } from 'react'
import { NOTES_BUDGETS } from '../../../shared/memory/notes'
import { refreshIpcResource, resources } from '../ipc'
import { SegmentedControl, SettingsCard } from '../ui'
import '../ui/tailwind.css'
import { AppliesNextSession } from './AppliesNextSession'
import { CARD_ERROR, CARD_SUB, LABEL, LABELLED } from './settings-classes'

const api = window.tinyCorp.notes

/**
 * What Employees remember (T193, frame `Cg3a8`, left column): the one number the boss sets about
 * an Employee's own notes — how many tokens of them a Session reads when it starts.
 *
 * It saves as it changes, like the voice beside it: picking a segment is not a draft, and it only
 * takes at the next Session start anyway, so there is nothing to undo before then — which is what
 * the note under it says, with the Employees it has not reached yet (T237).
 */
export function RememberCard() {
  const [budget, setBudget] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const saved = await api.budget()
    if (!saved.ok) return setError(saved.error)
    setError(null)
    setBudget(saved.value)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (budget === null) return null

  async function pick(tokens: number) {
    const result = await api.setBudget(tokens)
    if (!result.ok) return setError(result.error)
    setError(null)
    setBudget(result.value)
    // A setting written is not a Session event, so what the note reads is read again from here.
    refreshIpcResource(resources.staleSessions)
  }

  return (
    <SettingsCard
      title="What Employees remember"
      sub="Each Employee keeps its own notes, and reads a fixed budget of them when a session starts."
      sub12
    >
      {error && <p className={CARD_ERROR}>{error}</p>}

      <div className={LABELLED}>
        <span className={LABEL}>Read at session start</span>
        <SegmentedControl
          label="Read at session start"
          value={budget}
          options={NOTES_BUDGETS.map((option) => ({ value: option, label: `${option / 1000}k tokens` }))}
          onChange={(option) => void pick(option)}
        />
      </div>

      <p className={CARD_SUB}>
        Recent notes word for word, older ones as summaries the Employee writes itself. Nothing is ever deleted, and
        search reads all of it.
      </p>

      <AppliesNextSession setting="notesBudget" />
    </SettingsCard>
  )
}
