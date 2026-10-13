import { ArrowDownToLine } from 'lucide-react'
import type { UpdateState } from '../../../shared/app/updates'
import { updateNotice } from './update-model'
import '../ui/tailwind.css'

/*
 * Muted by default so it reads as news, not as an alarm. `[-webkit-app-region:no-drag]` keeps the
 * click from being swallowed by the title bar's drag region, and `hover:` carries Tailwind's
 * `@media (hover: hover)` guard — true on every desktop this app ships to.
 */
const NOTICE =
  'inline-flex shrink-0 cursor-pointer items-center gap-5 rounded-sm border border-status-info bg-status-info px-8 py-2 text-11-5/16 font-medium text-status-info-foreground hover:border-status-info-foreground [-webkit-app-region:no-drag] [&_svg]:shrink-0'

/**
 * The quiet line in the title bar area when a newer build exists (T130). Most days it draws
 * nothing: an app that has no news says nothing rather than reserving space for it. A click goes
 * to the release page in the system browser, because an unsigned build has nothing to install.
 */
export function UpdateNotice({ state, onOpen }: { state: UpdateState; onOpen(): void }) {
  const line = updateNotice(state)
  if (!line) return null
  return (
    <button type="button" className={NOTICE} data-ui="Update Notice" title="Open the download page" onClick={onOpen}>
      <ArrowDownToLine size={12} aria-hidden />
      <span>{line}</span>
    </button>
  )
}
