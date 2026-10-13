import { ArrowDownToLine, LogOut, RefreshCw } from 'lucide-react'
import type { UpdateState } from '../../../shared/app/updates'
import { Button } from '../ui'
import { availableLine, buildStamp, updateStatus } from './update-model'
import { useUpdates } from './use-updates'
import '../ui/tailwind.css'

/** The foot of the row: `Check now` sits by the stamp, and `Sign out` keeps the frame's far end. */
const FOOT = 'flex items-center gap-10 px-4 [&_[data-slot=button]:last-child]:ml-auto'

/** The one card this row ever grows, and only when there is a newer build. */
const UPDATE = 'flex items-center gap-16 rounded-md border border-border bg-card px-14 py-12'

/*
 * `/[inherit]` on the stamp and the title because the stylesheet set `font-size` alone and both sit
 * on the line Your profile gives them; the sub's 17px is the scale's own, so it needs no divisor.
 */
const STAMP = 'font-code text-11/[inherit] text-muted-foreground'

/**
 * The version row at the foot of Your profile (frame `Oykzs`): which build this is, a `Check now`
 * so a tester can answer "what build are you on?" without a terminal, `Sign out` at the far end,
 * and — only when there is one — the newer release with the page to download it from.
 *
 * It sits in Your profile and not in Company settings (T181): the build is the app's, and every
 * Company on this Mac is running the same one. `docs/beta.md` sends testers here.
 */
export function VersionRowView({
  state,
  onCheckNow,
  onOpenDownloadPage,
  onSignOut,
}: {
  state: UpdateState
  onCheckNow(): void
  onOpenDownloadPage(): void
  onSignOut(): void
}) {
  const available = availableLine(state)
  return (
    <div className="flex flex-col gap-10" data-ui="Version">
      {available && (
        <div className={UPDATE}>
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="font-semibold text-13/[inherit] text-foreground">{available}</span>
            {/* An unsigned app cannot swap itself out, so this row is honest about the work. */}
            <span className="text-11-5 text-muted-foreground">Download the DMG and drag it over the old app.</span>
          </span>
          <Button size="sm" icon={ArrowDownToLine} onClick={onOpenDownloadPage}>
            Open the download page
          </Button>
        </div>
      )}
      <div className={FOOT}>
        {/* The status is the row's title rather than a second line: the frame draws one line. */}
        <span className={STAMP} title={updateStatus(state)}>
          {buildStamp(state)}
        </span>
        <Button variant="ghost" size="sm" icon={RefreshCw} disabled={state.checking} onClick={onCheckNow}>
          {state.checking ? 'Checking…' : 'Check now'}
        </Button>
        <Button variant="ghost" size="sm" icon={LogOut} onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

/** The row, wired to the main process, which is the only thing that ever talks to GitHub. */
export function VersionRow({ onSignOut }: { onSignOut(): void }) {
  const updates = useUpdates()
  return (
    <VersionRowView
      state={updates.state}
      onCheckNow={updates.checkNow}
      onOpenDownloadPage={updates.openDownloadPage}
      onSignOut={onSignOut}
    />
  )
}
