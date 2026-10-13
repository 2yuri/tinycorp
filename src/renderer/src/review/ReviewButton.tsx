import { FileDiff } from 'lucide-react'
import { openReview } from './open-review'
import '../ui/tailwind.css'

/** The pill every entry point draws it as: a board card's row and an approval's actions alike. */
export const REVIEW_OPEN =
  'inline-flex cursor-pointer items-center gap-4 rounded-full border border-border bg-transparent px-8 py-2 text-11/[inherit] font-semibold text-muted-foreground hover:bg-secondary hover:text-secondary-foreground'

/** The `Review` action every entry point shares: it opens the screen over whichever view is open. */
export function ReviewButton({ ticketId }: { ticketId: number }) {
  return (
    <button
      type="button"
      className={REVIEW_OPEN}
      // The hook four other screens' tests find it by, now that it wears no shared class name.
      data-ui="Review"
      title="Read this ticket’s diff"
      onClick={(event) => {
        // Cards and rows open their own thing on a plain click; the diff is this button's alone.
        event.stopPropagation()
        openReview({ ticketId })
      }}
    >
      <FileDiff size={13} aria-hidden />
      Review
    </button>
  )
}
