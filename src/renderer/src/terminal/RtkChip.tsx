import { Scissors } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RtkView } from '../../../shared/ipc'
import { type RtkSavings, rtkChip, rtkUsable } from '../../../shared/rtk'
import '../ui/tailwind.css'

const api = window.tinyCorp

/**
 * The chip in an Employee's terminal header (frame `p4np9V`): how much of what this Employee read
 * RTK cut, and what that number is.
 *
 * **It does not say *this session*.** RTK keeps its history by day, not by conversation, and
 * `rtk gain` has no window narrower than a day — so the number here is this Company's, and the chip
 * says what it is rather than labelling a Company figure as one Session's. The ticket names that
 * fallback and this is it; a per-Session number needs something RTK does not offer yet.
 *
 * Nothing is drawn at all when the Company is not compressing, or when RTK has no numbers yet.
 */
export function RtkChip() {
  const savings = useRtkSavings()
  const chip = rtkChip(savings, false)
  if (!chip) return null
  return (
    <div
      className="rtk-chip inline-flex h-24 cursor-default items-center gap-7 self-start whitespace-nowrap rounded-full bg-secondary px-11 font-medium text-12/[normal] text-foreground"
      title={chip.title}
      data-ui="RTK chip"
    >
      <Scissors size={12} className="text-brand-success" aria-hidden />
      <span>{chip.label}</span>
    </div>
  )
}

/** What RTK says it saved, or null when this Company is not compressing or RTK cannot be read. */
function useRtkSavings(): RtkSavings | null {
  const [savings, setSavings] = useState<RtkSavings | null>(null)
  useEffect(() => {
    let live = true
    const read = async () => {
      const view = await api.rtk.read()
      if (!live) return
      if (!view.ok || !compressing(view.value)) return setSavings(null)
      const saved = await api.rtk.savings()
      if (live) setSavings(saved.ok ? saved.value : null)
    }
    void read()
    const stop = api.rtk.onChanged(() => void read())
    return () => {
      live = false
      stop()
    }
  }, [])
  return savings
}

function compressing(view: RtkView): boolean {
  return view.settings.enabled && rtkUsable(view.status)
}
