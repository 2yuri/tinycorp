import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { cx } from '../ui'
import '../ui/tailwind.css'
import { MarkdownToolbar } from './MarkdownToolbar'
import { markdownOf, richMarkdownExtensions } from './rich-markdown'

/**
 * A WYSIWYG markdown editor with a toolbar, the way Orca's own is built (T225): TipTap over a
 * ProseMirror document, `## ` and `- ` and `**` as you type, and what comes out of `onChange` is
 * the markdown that document serialises to.
 *
 * It replaces T219's CodeMirror live preview, which the boss did not get on with. The trade that
 * ticket was avoiding is real — a model that is parsed and written back can normalise a file
 * nobody edited — and `rich-markdown.ts` is where it is paid for: every serialiser default that
 * would move a byte is pinned there and tested on a whole page.
 *
 * **The prose is the caller's.** What a heading, a list or a fenced block looks like comes in
 * through `className`, so the Memory screen hands it the very list its reading pane uses and the
 * boss writes the page in the type they will read it in.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  label,
  className,
  hidden = false,
}: {
  /** The markdown. Set from outside only on a reset: typing does not come back through here. */
  value: string
  onChange(markdown: string): void
  placeholder: string
  /** What a screen reader calls the box, since the frame gives it no visible label. */
  label: string
  className?: string
  /** Kept mounted but out of the way, so the undo history survives a look at the preview. */
  hidden?: boolean
}) {
  // The latest handler, so the editor is built once and still calls the current one.
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  }, [onChange])

  const editor = useEditor({
    extensions: richMarkdownExtensions(placeholder),
    content: value,
    editorProps: { attributes: { 'aria-label': label, class: 'memory-editor__prose' } },
    onUpdate: ({ editor: current }) => handler.current(markdownOf(current)),
  })

  // A reset from outside — the boss cancelling, another page opening — replaces the document; the
  // value coming back from this editor's own typing is already what it holds.
  useEffect(() => {
    if (!editor || markdownOf(editor) === value) return
    editor.commands.setContent(value)
  }, [editor, value])

  return (
    <div className={cx(FRAME, hidden && 'hidden')} data-ui="Markdown editor">
      {editor && <MarkdownToolbar editor={editor} className={TOOLBAR} />}
      <EditorContent editor={editor} className={cx(AREA, className)} />
    </div>
  )
}

const FRAME = 'flex min-h-0 flex-1 flex-col'

/* The frame's second band: 34px, the row under the mode switch, with the same rule beneath it. */
const TOOLBAR = 'shrink-0 border-border border-b px-6 py-5'

/*
 * The box the document fills. The prose inside it is the caller's list; what is here is only what
 * makes a contenteditable behave — it fills the card, it scrolls, and it draws no focus ring of its
 * own because the card around it is the thing that looks focused.
 */
const AREA =
  'min-h-0 flex-1 overflow-auto px-16 py-14 [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0 [&_.ProseMirror_p.is-editor-empty:first-child]:before:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]'
