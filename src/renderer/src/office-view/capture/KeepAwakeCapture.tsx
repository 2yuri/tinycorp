// A dev-only capture of the map dock with the cup lit and its menu open, so it can be compared
// with `design/screens/sMIWE.png`, and of the out-of-budget card over the office floor
// (`design/screens/d9m0M.png`), which nothing else draws (T209). Nothing here ships.
import { useState } from 'react'
import type { KeepAwakeMode, KeepAwakeState } from '../../../../shared/app/keep-awake'
import { BudgetOverlay } from '../../budget'
import { MapControls } from '../MapControls'
import '../../ui/tailwind.css'

/** The frame's own state: the middle mode on, and holding, so the cup is lit. */
const HOLDING: KeepAwakeState = { mode: 'working', holding: true, supported: true }

/**
 * The dock where the office puts it: bottom right of the canvas, on a corner of the canvas's own
 * floor rather than the whole room — the stage is the page's furniture and not the app's.
 */
const STAGE = 'relative flex h-420 w-460 flex-none items-center justify-center overflow-hidden bg-[#0b1220] p-24'

export function KeepAwakeCapture() {
  const [mode, setMode] = useState<KeepAwakeMode>(HOLDING.mode)
  return (
    <div className={STAGE}>
      <MapControls fullscreen={false} onFullscreen={() => {}} keepAwake={{ ...HOLDING, mode }} onKeepAwake={setMode} />
    </div>
  )
}

/** The office floor the budget card sits over: the room's own 1040x660, and nothing in it. */
const FLOOR = 'relative h-660 w-1040 flex-none overflow-hidden bg-[#0b1220]'

/** The limit the frame draws: hit at nine, back at one. */
const EXHAUSTED = { exhaustedAt: '2026-01-15T09:02:00.000Z', resetsAt: '2026-01-15T13:00:00.000Z' }
const NOW = new Date('2026-01-15T09:30:00.000Z')

/** The dim overlay and its card over the office floor (decision 31, frame `d9m0M`). */
export function OutOfBudgetCapture() {
  return (
    <div className={FLOOR}>
      <BudgetOverlay budget={EXHAUSTED} now={NOW} onWait={() => {}} />
    </div>
  )
}
