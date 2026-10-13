import { useCallback, useEffect, useState } from 'react'
import { InputGroup } from '../ui'

/** What the round-limit draft means: a whole number from 1, or nothing the setting can take. */
export function parseRoundLimit(draft: string): { ok: true; rounds: number } | { ok: false } {
  const rounds = Number(draft.trim())
  return Number.isInteger(rounds) && rounds >= 1 ? { ok: true, rounds } : { ok: false }
}

/**
 * The Company's review round limit, editable (T170).
 *
 * It draws a line under itself for an error and for nothing else, as `QgXdU` does and as Company
 * settings has since T42. The sentence it used to pass — what the limit costs the boss, in their
 * own terms — was hidden by the screen's own CSS from the day it was written (T200).
 */
export function RoundLimitSetting({ className }: { className?: string }) {
  const api = window.tinyCorp
  const [rounds, setRounds] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await api.reviews.roundLimit()
    if (!result.ok) return setError(result.error)
    setRounds(result.value)
    setDraft(String(result.value))
  }, [])

  useEffect(() => {
    void refresh()
    return api.reviews.onChanged(() => void refresh())
  }, [refresh])

  async function save() {
    const parsed = parseRoundLimit(draft)
    if (!parsed.ok) return setError('Enter a whole number from 1.')
    if (parsed.rounds === rounds) return setError(null)
    const result = await api.reviews.setRoundLimit(parsed.rounds)
    setError(result.ok ? null : result.error)
    if (result.ok) setRounds(result.value)
  }

  if (rounds === null) return null
  return (
    <InputGroup
      className={className}
      label="Review rounds"
      type="number"
      min={1}
      step={1}
      value={draft}
      error={Boolean(error)}
      helper={error}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void save()
      }}
    />
  )
}
