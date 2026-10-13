import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { cx, IconButton } from '../ui'
import '../ui/tailwind.css'

/*
 * The mono box both preflight screens draw: the card of `uSaf3` and the open row of `KB9AX`.
 *
 * It is one file because the two screens differ only in what fills it — `muted` on a card, whose
 * own fill is `card`, and `background` inside a row whose fill is already `muted` — and a copy of
 * the row in each would be two places for a prompt or a copy button to drift.
 */

/** One command per row behind its prompt, each with its own copy (frames `KB9AX`, `uSaf3`). */
export const COMMANDS = 'flex flex-col gap-6 rounded-sm border border-border py-7 pr-7 pl-11'
const COMMAND = 'flex h-24 items-center gap-8'
/* In a labelled step each row is its own box, as frame `c8knu` draws it, and may wrap to two lines. */
const STEP_COMMAND = 'flex min-h-24 items-center gap-8 rounded-sm border border-border py-7 pr-7 pl-11'
const PROMPT = 'shrink-0 whitespace-nowrap font-code text-muted-foreground text-12-5/[normal] font-normal'
const LINE =
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-code text-foreground text-12-5/[normal] font-normal'
const COPY = 'h-24 w-24 shrink-0'

export interface CommandRowProps {
  command: string
  /** What the shell this line is typed in draws: `$` everywhere, `>` in PowerShell. */
  prompt?: string
  /** A row of its own box, which is what a labelled step is; otherwise a row of the shared box. */
  boxed?: boolean
}

/** One command, as a terminal shows it: the prompt, the line, and the button that copies it. */
export function CommandRow({ command, prompt = '$', boxed = false }: CommandRowProps) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={boxed ? STEP_COMMAND : COMMAND}>
      <span className={PROMPT} aria-hidden>
        {prompt}
      </span>
      <code className={LINE}>{command}</code>
      <IconButton
        size="sm"
        iconSize={14}
        icon={copied ? Check : Copy}
        label={copied ? `${command} copied` : `Copy ${command}`}
        className={COPY}
        onClick={() => {
          void copyText(command).then((done) => {
            if (!done) return
            setCopied(true)
            setTimeout(() => setCopied(false), COPIED_MS)
          })
        }}
      />
    </div>
  )
}

/** The box around a set of rows, in the fill the screen that draws it asks for. */
export function CommandBox({
  commands,
  prompt,
  className,
}: {
  commands: readonly string[]
  prompt?: string
  className?: string
}) {
  return (
    <div className={cx(COMMANDS, className)}>
      {commands.map((command) => (
        <CommandRow key={command} command={command} {...(prompt === undefined ? {} : { prompt })} />
      ))}
    </div>
  )
}

/** How long the copy button stays ticked. */
const COPIED_MS = 1500

/** The clipboard, which a window without one simply does not have; the line is still readable. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
