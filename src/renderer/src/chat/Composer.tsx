import { ArrowUp, AtSign, FolderGit2, Paperclip, SendHorizontal, SquareSlash } from 'lucide-react'
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react'
import type { AttachmentSource } from '../../../shared/attachments'
import type { Mentionable } from '../../../shared/domain/chat'
import type { DraftKey } from '../../../shared/drafts'
import {
  invokesSkill,
  type SkillGroup,
  type SlashOptions,
  slashAttempt,
} from '../../../shared/providers/slash-commands'
import { cx } from '../ui'
import { type PendingAttachment, PendingAttachments } from './Attachments'
import { heldFrom, pathOf, useComposerDraft } from './composer-draft'
import { optionId, type Suggestion, SuggestionList, suggestionsFor } from './composer-suggestions'
import type { Refs } from './Messages'
import type { SlashOutcome } from './slash-run'

/** One of the composer's flat icon buttons: the paperclip, the @, the slash, the reply's Send. */
const TOOL =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted-foreground hover:not-disabled:text-foreground disabled:cursor-default focus-visible:shadow-focus focus-visible:outline-none'

/**
 * The box around the input. The ring is `focus-within` on the box rather than on the form, as the
 * stylesheet had it: the textarea is the only thing in here that takes focus — the palette moves a
 * highlight with `aria-activedescendant` and never the caret — so the two select the same moment.
 */
const BOX =
  'flex min-w-0 grow shrink basis-0 flex-col border border-border bg-card focus-within:border-ring focus-within:shadow-focus'

/** The box while a file is over it: the same ring, before the drop. */
const BOX_LIT = 'border-ring shadow-focus'

/** What the composer needs to offer and run slash commands (decision 37). */
export interface SlashComposer extends SlashOptions {
  /** Carries the command out; `runSlash` in `slash-run.ts`. */
  run(text: string): Promise<SlashOutcome>
  /**
   * The skills this draft can invoke (T264): the DM's Employee's, or the one Employee it
   * @mentions. Null when there is nobody, or they hold none, and the palette is the commands alone.
   */
  skills(text: string): SkillGroup | null
}

/** What a command left under the box: a hint means nothing was posted. */
type Note = { tone: 'hint' | 'note'; text: string } | null

/**
 * What the boss has typed and what the list is doing about it. The four move together — every
 * keystroke moves the caret, puts the highlight back on the first row and undoes an Escape — so
 * they are one state and not four (T214).
 */
interface Draft {
  text: string
  caret: number
  /** Which row the arrows have walked to. */
  highlighted: number
  /** True once Escape has closed the list, until the next keystroke. */
  dismissed: boolean
}

const EMPTY: Draft = { text: '', caret: 0, highlighted: 0, dismissed: false }

/**
 * The message box with `@`, `#` and `/` autocomplete. `main` is the channel composer with its
 * toolbar and hint; `reply` is the one-line thread box.
 */
export function Composer(props: {
  variant: 'main' | 'reply'
  placeholder: string
  hint?: string | undefined
  people: Mentionable[]
  refs: Refs
  /** Left out, `/` is ordinary text and the palette button is inert. */
  slash?: SlashComposer | undefined
  /**
   * Where what the boss types and attaches is kept until it is sent, so it comes back after they
   * leave and after a restart (TI-1). Left out, the composer keeps nothing.
   */
  draftKey?: DraftKey | undefined
  onSend(text: string, attachments: AttachmentSource[]): Promise<boolean>
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [note, setNote] = useState<Note>(null)
  const [attached, setAttached] = useState<PendingAttachment[]>([])
  const [dropping, setDropping] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const slash = props.slash
  const { text, caret, highlighted, dismissed } = draft
  const kept = useComposerDraft(props.draftKey, text, attached, (restored) => {
    setDraft({ ...EMPTY, text: restored.text, caret: restored.text.length })
    setAttached(heldFrom(restored))
  })

  const suggestions = useMemo(
    () => suggestionsFor({ text, caret, dismissed, slash, people: props.people, refs: props.refs }),
    [text, caret, dismissed, slash, props.people, props.refs],
  )
  const items = suggestions.items

  function update(value: string, position: number) {
    setDraft({ text: value, caret: position, highlighted: 0, dismissed: false })
    setNote(null)
  }

  function focusAt(position: number) {
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(position, position)
    })
  }

  function choose(suggestion: Suggestion) {
    const next = suggestion.complete()
    update(next.text, next.caret)
    focusAt(next.caret)
  }

  /** Types `trigger` at the caret, starting a new word, so its autocomplete opens. */
  function insert(trigger: '@') {
    const at = input.current?.selectionStart ?? text.length
    const before = text.slice(0, at)
    const glue = before === '' || /\s$/.test(before) ? '' : ' '
    const next = `${before}${glue}${trigger}${text.slice(at)}`
    const position = at + glue.length + 1
    update(next, position)
    focusAt(position)
  }

  /** The picked files, kept until they are sent: a drop and the file picker both land here. */
  function hold(files: FileList | readonly File[] | null) {
    if (!files || files.length === 0) return
    setAttached((held) => [
      ...held,
      ...[...files].map((file, i) => ({
        key: `${Date.now()}-${held.length + i}-${file.name}`,
        name: file.name,
        size: file.size,
        file,
        path: pathOf(file),
      })),
    ])
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDropping(false)
    hold(event.dataTransfer.files)
  }

  /**
   * A screenshot, or a file copied in Finder or File Explorer, arrives on a paste as a file rather
   * than as text, and is held the way a drop is. Plain text is left to the box, so Ctrl+V and Cmd+V
   * still type it.
   */
  function paste(event: ClipboardEvent<HTMLElement>) {
    const files = [...(event.clipboardData?.files ?? [])]
    if (files.length === 0) return
    event.preventDefault()
    hold(files.map((file) => pastedFile(file, new Date())))
  }

  /** The palette button: the box starts with a `/` and the caret sits after it, so the list opens. */
  function openPalette() {
    const next = text.startsWith('/') ? text : `/${text}`
    update(next, 1)
    focusAt(1)
  }

  async function submit() {
    if (!text.trim() && attached.length === 0) return
    // A command is a command, not a message: it carries no files.
    // A message that opens with a skill the Employee holds is a message, and invokes it (T264).
    if (slash && attached.length === 0 && slashAttempt(text) !== null && !invokesSkill(text, slash.skills(text))) {
      const outcome = await slash.run(text)
      // A command that could not run posts nothing and leaves what was typed in the box.
      if (!outcome.ok) return setNote({ tone: 'hint', text: outcome.hint })
      update('', 0)
      kept.clear()
      if (outcome.note) setNote({ tone: 'note', text: outcome.note })
      return
    }
    // The bytes cross to the main process, not the path. A file restored from a draft has no `File`,
    // so the main process reads that one from where it is, and only because the draft holds it.
    let sources: AttachmentSource[]
    try {
      sources = await Promise.all(attached.map((a) => kept.source(a)))
    } catch (error) {
      return setNote({ tone: 'hint', text: error instanceof Error ? error.message : String(error) })
    }
    if (await props.onSend(text, sources)) {
      update('', 0)
      setAttached([])
      kept.clear()
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (items.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        return setDraft((was) => ({ ...was, highlighted: (was.highlighted + step + items.length) % items.length }))
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const item = items[highlighted]!
        // `/pause` typed in full is not completed again: Enter runs it.
        if (event.key === 'Enter' && item.submits) void submit()
        else choose(item)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        return setDraft((was) => ({ ...was, dismissed: true }))
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const empty = !text.trim() && attached.length === 0
  const held = (
    <PendingAttachments
      attachments={attached}
      onRemove={(key) => setAttached((was) => was.filter((a) => a.key !== key))}
    />
  )
  const attach = (size: number) => (
    <button
      type="button"
      className={TOOL}
      aria-label="Attach a file"
      title="Attach a file"
      onClick={() => picker.current?.click()}
    >
      <Paperclip size={size} aria-hidden />
    </button>
  )
  const textarea = (
    <textarea
      ref={input}
      rows={1}
      className={cx(
        'm-0 max-h-160 min-h-17 w-full resize-none border-0 bg-transparent p-0 font-normal text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground placeholder:opacity-100',
        props.variant === 'reply' ? 'shrink grow basis-0 text-13/[normal]' : 'text-14/[normal]',
      )}
      value={text}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
      onChange={(event) => update(event.target.value, event.target.selectionStart)}
      onSelect={(event) => {
        // Read now: React clears `currentTarget` once the handler returns, and the updater runs later.
        const caret = event.currentTarget.selectionStart
        setDraft((was) => ({ ...was, caret }))
      }}
      onKeyDown={keyDown}
      // The arrows move the highlight without moving focus, so the row the box is on is named here.
      aria-activedescendant={items.length > 0 ? optionId(highlighted) : undefined}
    />
  )

  return (
    <form
      className="relative flex min-w-0 shrink grow basis-0"
      // Which composer this is, for the capture harness: the class that used to say so — and the
      // one it selected the box by — went with the stylesheet.
      data-composer={props.variant}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={drop}
      onPaste={paste}
    >
      <input
        ref={picker}
        type="file"
        multiple
        className="hidden"
        aria-label="Attach a file"
        onChange={(event) => {
          hold(event.target.files)
          event.target.value = ''
        }}
      />
      <SuggestionList suggestions={suggestions} highlighted={highlighted} onChoose={choose} />
      {note && (
        <p
          className={cx(
            'absolute right-0 bottom-full left-0 mx-0 mt-0 mb-6 rounded-sm border px-12 py-8 text-12/[normal]',
            note.tone === 'hint'
              ? 'border-transparent bg-status-error text-status-error-foreground'
              : 'border-border bg-secondary text-muted-foreground',
          )}
          role="alert"
        >
          {note.text}
        </p>
      )}
      {props.variant === 'main' ? (
        <div className={cx(BOX, 'gap-12 rounded-md p-14', dropping && BOX_LIT)}>
          {textarea}
          {held}
          <div className="flex items-center gap-10">
            {attach(16)}
            <button
              type="button"
              className={TOOL}
              aria-label="Mention someone"
              title="Mention someone"
              onClick={() => insert('@')}
            >
              <AtSign size={16} aria-hidden />
            </button>
            <button
              type="button"
              className={TOOL}
              aria-label="Run a command"
              title="Run a command"
              disabled={!slash}
              onClick={openPalette}
            >
              <SquareSlash size={16} aria-hidden />
            </button>
            {/* Repo references have no engine behind them yet. */}
            <button type="button" className={TOOL} aria-label="Reference a repo" title="Reference a repo" disabled>
              <FolderGit2 size={16} aria-hidden />
            </button>
            <span className="shrink grow basis-0" />
            {props.hint && (
              <span className="whitespace-nowrap font-normal text-11/[normal] text-muted-foreground">{props.hint}</span>
            )}
            <button
              type="submit"
              className="flex size-32 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-primary p-0 text-primary-foreground hover:not-disabled:bg-primary-hover focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default"
              aria-label="Send"
              title="Send"
              disabled={empty}
            >
              <ArrowUp size={16} aria-hidden />
            </button>
          </div>
        </div>
      ) : (
        <div className={cx(BOX, 'gap-8 rounded-sm px-12 py-10', dropping && BOX_LIT)}>
          <div className="flex items-center gap-8">
            {textarea}
            {attach(15)}
            <button type="submit" className={TOOL} aria-label="Send reply" title="Send reply" disabled={empty}>
              <SendHorizontal size={15} aria-hidden />
            </button>
          </div>
          {held}
        </div>
      )}
    </form>
  )
}

/**
 * Chromium names every image it takes off the clipboard `image.png`. Two screenshots pasted into
 * one message would be two chips of the same name, so a pasted image is named for when it came in.
 * A file copied in the OS keeps its own name.
 */
export function pastedFile(file: File, at: Date): File {
  if (file.name !== 'image.png') return file
  const stamp = [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, '0')).join('.')
  return new File([file], `Pasted image ${stamp}.png`, { type: file.type, lastModified: file.lastModified })
}
