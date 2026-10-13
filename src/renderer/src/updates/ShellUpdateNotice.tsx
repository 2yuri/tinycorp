import { UpdateNotice } from './UpdateNotice'
import { useUpdates } from './use-updates'

/** The title bar's line, wired to the main process's check. Draws nothing most days (T130). */
export function ShellUpdateNotice() {
  const updates = useUpdates()
  return <UpdateNotice state={updates.state} onOpen={updates.openDownloadPage} />
}
