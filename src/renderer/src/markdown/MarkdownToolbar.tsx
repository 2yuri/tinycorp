import type { Editor } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Undo2,
} from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { shortcutLabel } from '../chrome'
import { Button, cx, focusOnMount, IconButton, Select, SHELL_BUTTON } from '../ui'
import '../ui/tailwind.css'

/* The frame's 24px button: the kit's borderless icon button brought to the toolbar's own size. */
const TOOL = 'size-24 rounded-sm bg-transparent text-muted-foreground'

/* Two whole lists, not a list and an override: see `CHIP` in `memory/MemoryList.tsx` for why. */
const TOOL_ON = 'size-24 rounded-sm bg-secondary text-foreground'

const DIVIDER = 'mx-4 h-16 w-1 shrink-0 bg-border'

/* The block the caret is in, as a control the width of the frame's own. */
const BLOCK =
  'shrink-0 grow-0 basis-auto [&_[data-slot=field-control]]:h-24 [&_[data-slot=field-control]]:w-112 [&_[data-slot=field-control]]:gap-6 [&_[data-slot=field-control]]:bg-transparent [&_[data-slot=field-control]]:px-8 [&_[data-slot=field-control]]:focus-within:px-7 [&_[data-slot=field-input]]:text-11-5/16 [&_[data-slot=field-icon]]:size-12'

/** The blocks the style control offers, in the order the frame lists them. */
const BLOCKS = [
  { value: 'paragraph', label: 'Body text' },
  { value: '1', label: 'Heading 1' },
  { value: '2', label: 'Heading 2' },
  { value: '3', label: 'Heading 3' },
] as const

/**
 * The toolbar over the rich editor (frame `DHYKn`), the controls Orca's own editor offers: the
 * block the caret is in, the four marks and a link, the three lists, a quote and a fenced block,
 * and undo / redo at the far end.
 *
 * Every button says its shortcut in the host's own words — `⌘B` on a Mac, `Ctrl+B` everywhere else
 * — because that is what TipTap's keymap really binds (`Mod-`).
 *
 * It re-reads the editor on every transaction: which button is lit is a question about where the
 * caret is, and nothing else in the screen knows that.
 */
export function MarkdownToolbar({ editor, className }: { editor: Editor; className?: string }) {
  const [, bump] = useState(0)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    const redraw = () => bump((count) => count + 1)
    editor.on('transaction', redraw)
    return () => {
      editor.off('transaction', redraw)
    }
  }, [editor])

  const block = editor.isActive('heading', { level: 1 })
    ? '1'
    : editor.isActive('heading', { level: 2 })
      ? '2'
      : editor.isActive('heading', { level: 3 })
        ? '3'
        : 'paragraph'

  const tool = (label: string, icon: LucideIcon, on: boolean, run: () => void) => (
    <IconButton
      key={label}
      icon={icon}
      label={label}
      size="sm"
      iconSize={13}
      className={cx(on ? TOOL_ON : TOOL)}
      aria-pressed={on}
      onClick={run}
    />
  )

  const chain = () => editor.chain().focus()

  return (
    <div className={cx('flex items-center gap-2', className)} data-ui="Markdown toolbar" role="toolbar">
      {linking ? (
        <LinkField
          href={editor.getAttributes('link')['href'] ?? ''}
          onClose={() => setLinking(false)}
          onApply={(href) => {
            if (href === '') chain().unsetLink().run()
            else chain().extendMarkRange('link').setLink({ href }).run()
            setLinking(false)
          }}
        />
      ) : (
        <>
          <Select
            label={null}
            className={BLOCK}
            value={block}
            aria-label="Block style"
            options={BLOCKS.map((one) => ({ value: one.value, label: one.label }))}
            onChange={(event) => {
              const picked = event.target.value
              if (picked === 'paragraph') chain().setParagraph().run()
              else
                chain()
                  .setHeading({ level: Number(picked) as 1 | 2 | 3 })
                  .run()
            }}
          />
          <span className={DIVIDER} aria-hidden />
          {tool(`Bold (${shortcutLabel('B')})`, Bold, editor.isActive('bold'), () => chain().toggleBold().run())}
          {tool(`Italic (${shortcutLabel('I')})`, Italic, editor.isActive('italic'), () =>
            chain().toggleItalic().run(),
          )}
          {tool('Strikethrough', Strikethrough, editor.isActive('strike'), () => chain().toggleStrike().run())}
          {tool('Code', Code, editor.isActive('code'), () => chain().toggleCode().run())}
          {tool(`Link (${shortcutLabel('K')})`, Link2, editor.isActive('link'), () => setLinking(true))}
          <span className={DIVIDER} aria-hidden />
          {tool('Bullet list', List, editor.isActive('bulletList'), () => chain().toggleBulletList().run())}
          {tool('Numbered list', ListOrdered, editor.isActive('orderedList'), () => chain().toggleOrderedList().run())}
          {tool('Task list', ListChecks, editor.isActive('taskList'), () => chain().toggleTaskList().run())}
          <span className={DIVIDER} aria-hidden />
          {tool('Quote', TextQuote, editor.isActive('blockquote'), () => chain().toggleBlockquote().run())}
          {tool('Code block', SquareCode, editor.isActive('codeBlock'), () => chain().toggleCodeBlock().run())}
          <span className="ml-auto" />
          {tool(`Undo (${shortcutLabel('Z')})`, Undo2, false, () => chain().undo().run())}
          {tool('Redo', Redo2, false, () => chain().redo().run())}
        </>
      )}
    </div>
  )
}

/* The link row, which takes the toolbar's place while it is open: Orca's own `Paste or type a link…`. */
const LINK_INPUT =
  'h-24 min-w-0 flex-1 rounded-sm border border-border bg-transparent px-8 font-sans text-11-5/16 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary'

/**
 * Where a link's target is typed. A prompt box would be a modal dialog over a document the boss is
 * writing; this is the toolbar, holding one field until the link is set or the row is dismissed.
 *
 * Empty and applied removes the link, which is how the same row unsets one.
 */
function LinkField({ href, onApply, onClose }: { href: string; onApply(href: string): void; onClose(): void }) {
  const [value, setValue] = useState(href)
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-6"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        event.stopPropagation()
        onApply(value.trim())
      }}
    >
      <input
        ref={focusOnMount}
        className={LINK_INPUT}
        value={value}
        aria-label="Link address"
        placeholder="Paste or type a link…"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      />
      <Button type="submit" variant="secondary" size="sm" className="h-24 px-10 py-0 text-11-5">
        Apply
      </Button>
      <button type="button" className={cx(SHELL_BUTTON, 'px-4 text-11-5 text-muted-foreground')} onClick={onClose}>
        Cancel
      </button>
    </form>
  )
}
