import { useCallback, useEffect, useState } from 'react'
import type { Headcount } from '../../../shared/hiring'
import { InputGroup } from '../ui'
import '../ui/tailwind.css'

/** What the maximum-headcount draft means: a whole number from 1, blank for unlimited, or neither. */
export function parseMaxHeadcount(draft: string): { ok: true; max: number | null } | { ok: false } {
  const text = draft.trim()
  if (text === '') return { ok: true, max: null }
  const max = Number(text)
  return Number.isInteger(max) && max >= 1 ? { ok: true, max } : { ok: false }
}

/**
 * The current Company's maximum headcount, editable; blank means unlimited.
 *
 * The field says what it is and what it holds, and nothing else: `QgXdU` draws no line under it,
 * and Company settings has drawn a helper only for an error since T42. The sentence this used to
 * pass — how many work here, and what Autonomous does above the maximum — was hidden by the
 * screen's own CSS from the day it was written, and is gone rather than pretended at (T200).
 */
export function HeadcountSetting({ className }: { className?: string }) {
  const api = window.tinyCorp
  const [headcount, setHeadcount] = useState<Headcount | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await api.hiring.headcount()
    if (!result.ok) return setError(result.error)
    setHeadcount(result.value)
    setDraft(result.value.max === null ? '' : String(result.value.max))
  }, [])

  useEffect(() => {
    void refresh()
    return api.staff.onChanged(() => void refresh())
  }, [refresh])

  async function save() {
    const parsed = parseMaxHeadcount(draft)
    if (!parsed.ok) return setError('Enter a whole number from 1, or leave it blank for unlimited.')
    if (parsed.max === headcount?.max) return setError(null)
    const result = await api.hiring.setMaxHeadcount(parsed.max)
    setError(result.ok ? null : result.error)
    if (result.ok) setHeadcount(result.value)
  }

  if (!headcount) return null
  return (
    <InputGroup
      className={className ?? 'max-w-320'}
      label="Maximum headcount"
      type="number"
      min={1}
      step={1}
      placeholder="Unlimited"
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
