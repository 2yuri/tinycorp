import { useEffect, useState } from 'react'
import { type LegendTone, OFFICE_LEGEND } from '../../../shared/office/legend'
import { cx } from '../ui'
import '../ui/tailwind.css'
import { onToggleLegend } from './toggle-legend'

/**
 * The floating key to the floor: what every sprite state is called and why it stands where it does.
 * Closed by default, so it never covers the room (T74). The View menu's `Legend` opens it too (#223),
 * which is why the panel's own state is held here rather than left to the browser.
 */
export function OfficeLegend() {
  const [open, setOpen] = useState(false)
  useEffect(() => onToggleLegend(() => setOpen((shown) => !shown)), [])

  return (
    <details className={LEGEND} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={SUMMARY}>Legend</summary>
      <dl className={LIST}>
        {OFFICE_LEGEND.map((entry) => (
          <div className="flex flex-col gap-1" key={entry.state} data-state={entry.state}>
            <dt className="flex items-center gap-7 font-semibold text-12/normal">
              <span className={cx(DOT, DOT_TONE[entry.tone])} aria-hidden />
              {entry.label}
            </dt>
            <dd className="m-0 pl-14 text-11/15 text-[#94a3b8]">{entry.means}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

/*
 * The floating key, bottom left of the canvas (T210f). The office's own float colours — `#0f172ae6`
 * the fill, `#ffffff24` the stroke, `#cbd5e1` and `#94a3b8` the two inks — have no token.
 *
 * `flex-col-reverse` is the whole of why it is a flex column: the summary keeps its place and the
 * list grows above it, so the second click lands on the summary again rather than on a row that has
 * just moved under the pointer.
 */
const LEGEND =
  'absolute bottom-26 left-34 z-2 flex max-w-340 flex-col-reverse rounded-md border border-[#ffffff24] bg-[#0f172ae6] text-[#cbd5e1]'

/** `list-none` and the WebKit marker both: Safari draws its own triangle from a pseudo-element. */
const SUMMARY = 'cursor-pointer list-none px-14 py-8 font-semibold text-12/normal [&::-webkit-details-marker]:hidden'

const LIST = 'm-0 flex flex-col gap-8 border-b border-b-[#ffffff24] px-14 pt-12 pb-2'

const DOT = 'h-7 w-7 shrink-0 rounded-full'

/**
 * What a state's dot says. Every tone, so the dot never carries two fills in one layer — and
 * exported, so the legend's test names the same fill the legend draws rather than a class of its own.
 */
export const DOT_TONE: Record<LegendTone, string> = {
  live: 'bg-brand-success',
  wait: 'bg-brand-warning',
  stop: 'bg-brand-danger',
  quiet: 'bg-brand-text-muted',
}
