import { FilePlus, FolderGit2 } from 'lucide-react'
import { Button } from '../ui'

/**
 * The two buttons the Memory header carries (frames `E40vSb`, `SlxSy`).
 *
 * They live in a module of their own rather than inside `MemoryView` because the capture harness
 * draws this header too: its copy of them fell behind the frame's marks and the audit went on
 * comparing the harness's buttons with Pen's (T196).
 *
 * The other half of that comment is no longer true, and the reason it went away is worth keeping:
 * the marks used to be at risk from import order, because `.shell-btn` and the screen's own rule
 * were the same specificity and the bundler decided which won. They are utilities now, and
 * `@layer utilities` is last, so load order cannot reach them (T208, T210e).
 */
export function MemoryActions(props: { openDisabled?: boolean; onOpenInFiles?(): void; onNewPage?(): void }) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="px-12 py-8 [&_svg]:size-15"
        icon={FolderGit2}
        disabled={props.openDisabled}
        onClick={props.onOpenInFiles}
      >
        Open in Files
      </Button>
      <Button
        variant="primary"
        size="sm"
        className="px-14 py-9 [&_svg]:size-15"
        icon={FilePlus}
        onClick={props.onNewPage}
      >
        New page
      </Button>
    </>
  )
}
