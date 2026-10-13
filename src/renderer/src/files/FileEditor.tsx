import { TriangleAlert } from 'lucide-react'
import { EDITED_LABEL, sessionWarning } from '../../../shared/files/file-edits'
import { Button, Kbd } from '../ui'
import '../ui/tailwind.css'
import { shortcutLabel } from '../chrome'

/**
 * Editing (frame `CwBoJ`, T122): the dot beside the path, Discard and Save, the warning while
 * somebody else is in the worktree, and the line for a file that may only be read.
 *
 * The box the boss types in is not here any more. It was a `<textarea>` laid over painted lines
 * with a hand-written highlighter under it; since T222 it is Monaco — VS Code's own editor —
 * behind `CodeEditor.tsx`, and what is left in this file is the chrome the header draws around it.
 */

/* The dot beside the path: there is work the disk has not seen. */
const EDITED =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap font-sans font-medium text-12/[normal] text-brand-warning'

/* The frame writes `Save ⌘S` in one colour: the hint is part of the label, not a chip beside it. */
const EDIT_ACTIONS =
  'inline-flex shrink-0 items-center gap-8 [&_[data-slot=kbd]]:ml-6 [&_[data-slot=kbd]]:text-12 [&_[data-slot=kbd]]:text-inherit'

/* Whoever else is in there, above the file. The band is closed by an amber rule, not a neutral one,
   and only the triangle is amber: the sentence is read, not alarmed at (CwBoJ). */
const SESSION_WARNING =
  'files-session-warning m-0 flex shrink-0 items-center gap-8 border-b border-b-brand-warning bg-[color-mix(in_srgb,var(--brand-warning)_12%,transparent)] px-16 py-8 text-12/18 text-foreground [&_svg]:shrink-0 [&_svg]:text-brand-warning'

/** The dot beside the path while there is work the disk has not seen. */
export function EditedMark() {
  return (
    <span className={EDITED} data-ui="Edited mark">
      <span className="files-edited__dot size-7 rounded-full bg-brand-warning" aria-hidden />
      {EDITED_LABEL}
    </span>
  )
}

/** Discard and Save ⌘S, at the right of the head, for as long as there is something to save. */
export function EditActions({ busy, onDiscard, onSave }: { busy?: boolean; onDiscard(): void; onSave(): void }) {
  return (
    <span className={EDIT_ACTIONS}>
      <Button variant="outline" size="toolbar" disabled={busy} onClick={onDiscard}>
        Discard
      </Button>
      <Button size="toolbar" disabled={busy} onClick={onSave}>
        Save <Kbd>{shortcutLabel('S')}</Kbd>
      </Button>
    </span>
  )
}

/**
 * Whoever else is in there: while the Employee who holds the ticket has a Session running in this
 * worktree, the view says so above the file. A warning and not a lock — the boss may still write,
 * and a save that would clobber their work stops on its own.
 */
export function SessionWarning({ holderName, text }: { holderName: string | null; text?: string }) {
  return (
    <p className={SESSION_WARNING} role="status" data-ui="Session warning">
      <TriangleAlert size={14} aria-hidden />
      {/* One warning per hazard: the Changes tab gives it committing's own second sentence (T160). */}
      {text ?? sessionWarning(holderName)}
    </p>
  )
}

/** Why a file the boss might have expected to type into cannot be, under the head. */
export function ReadOnlyNotice({ notice }: { notice: string }) {
  return (
    <p className="m-0 px-16 py-6 text-12/[normal] text-muted-foreground" role="status">
      {notice}
    </p>
  )
}
