import { ArrowUp, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { shortcutLabel } from '../chrome'
import { Kbd } from '../ui'
import '../ui/tailwind.css'

/** True for ⌘K (Ctrl+K off macOS). */
export function isFocusShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) {
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
}

/** Who the task bar hands a task to, or why it cannot. */
export function dockHint(answererName: string | null): string {
  return answererName
    ? `Goes to ${answererName}, who answers you`
    : 'Nobody is hired yet: hire an Employee to take tasks'
}

/** The floating `Assign a task to the team…` bar (design/html/office.html layer `Control Dock`). */
export function ControlDock(props: {
  /** The Employee who answers the boss, or null when the Company has nobody. */
  answererName: string | null
  onSubmit(text: string): Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isFocusShortcut(event)) return
      event.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function submit() {
    if (!text.trim() || sending || !props.answererName) return
    setSending(true)
    const sent = await props.onSubmit(text)
    setSending(false)
    if (sent) setText('')
  }

  const hint = dockHint(props.answererName)
  return (
    <form
      className={DOCK}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Sparkles className="shrink-0 text-foreground" size={18} aria-hidden />
      <input
        ref={input}
        className={PROMPT}
        aria-label="Assign a task to the team"
        title={hint}
        placeholder="Assign a task to the team…"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <span className={SHORTCUT}>
        <Kbd>{shortcutLabel('K')}</Kbd>
      </span>
      <button
        type="submit"
        className={SEND}
        aria-label={props.answererName ? `Send to ${props.answererName}` : 'Send'}
        title={hint}
        disabled={!text.trim() || sending || !props.answererName}
      >
        <ArrowUp size={18} aria-hidden />
      </button>
    </form>
  )
}

/*
 * The floating bar (layer `Control Dock`), as utilities (T210f). `#0f172ae6` is the float's fill and
 * `#ffffff24` its stroke — the office's own, and no token names either. Out of budget it dims to
 * 45% with the rest of the floating furniture, from the canvas's own attribute.
 */
const DOCK =
  'absolute bottom-26 left-1/2 z-1 m-0 flex w-560 max-w-[calc(100%-48px)] -translate-x-1/2 items-center gap-12 rounded-full border border-[#ffffff24] bg-[#0f172ae6] py-8 pr-8 pl-18 shadow-[0px_8px_24px_0px_#00000059] [[data-out-of-budget]_&]:opacity-45'

const PROMPT =
  'min-w-0 flex-1 basis-0 border-0 bg-transparent p-0 font-normal text-14/normal text-foreground outline-none placeholder:text-muted-foreground placeholder:opacity-100'

/** The ⌘K hint: the frame sets it in the body face, not the kit's mono. */
const SHORTCUT =
  'flex shrink-0 rounded-sm border border-[#ffffff24] px-8 py-4 [&_[data-slot=kbd]]:font-sans [&_[data-slot=kbd]]:font-semibold'

const SEND =
  'flex h-40 w-40 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-primary p-0 text-primary-foreground not-disabled:hover:bg-primary-hover disabled:cursor-default focus-visible:shadow-focus focus-visible:outline-none'
