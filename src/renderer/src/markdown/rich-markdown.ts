import type { Editor, Extensions } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import HardBreak from '@tiptap/extension-hard-break'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'

declare module '@tiptap/core' {
  interface Storage {
    /** `tiptap-markdown`'s own storage, which is where the file the document came from goes back. */
    markdown: MarkdownStorage
  }
}

/**
 * The document a Memory page is written in (T225): TipTap, the way Orca's own editor does it —
 * ProseMirror holds a model, `tiptap-markdown` parses the file into it and serialises it back.
 *
 * T219 wrote the same screen on CodeMirror precisely to avoid that serialisation: a git-backed wiki
 * cannot afford a commit that is the edit *plus* a rewrite. The boss asked for the WYSIWYG anyway,
 * so the rewrite is what this file has to make not happen, and the three settings below are the
 * whole of it. `rich-markdown.test.ts` opens a page that uses every block we draw and asserts the
 * markdown comes back byte for byte.
 *
 * - **`bulletListMarker: '-'`.** prosemirror-markdown writes `*` otherwise, so every bullet in the
 *   wiki would move on the first save.
 * - **Tight lists.** `renderList` puts a blank line between items unless the list node says
 *   `tight`. `tiptap-markdown` sets that attribute on `bulletList` and `orderedList` and knows
 *   nothing about `taskList`, so `TightTaskList` below adds it there too.
 * - **`breaks: true`, and a hard break that writes one newline.** Employees hard-wrap their prose;
 *   a soft newline inside a paragraph would otherwise come back as a space and reflow the whole
 *   file. Parsed as a break and written as a bare `\n`, the wrapping survives — and so does the
 *   small diff when the boss edits one line of a wrapped paragraph.
 *
 * **`html: false` is deliberate.** Raw HTML in a page is read as text, never as markup: the Memory
 * body is written by Employees, and nothing they write may inject an element into the app — the
 * same promise `MarkdownBody` keeps for the reading pane. A page that holds HTML keeps it as the
 * literal text it already was.
 */
export function richMarkdownExtensions(placeholder: string): Extensions {
  return [
    SplitMixedLists,
    StarterKit.configure({
      // Our own, below: the markdown storage on it is what keeps a wrapped paragraph wrapped.
      hardBreak: false,
      // A typed URL stays the text that was typed; `linkify` is off for the same reason.
      link: { openOnClick: false, autolink: false },
    }),
    SoftBreak,
    TightTaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({ bulletListMarker: '-', linkify: false, html: false, breaks: true }),
  ]
}

/**
 * A list that is part checklist and part bullets, split into one list per run.
 *
 * `markdown-it-task-lists` marks the whole `<ul>` as a task list when *any* item is one, and
 * `tiptap-markdown` turns that `<ul>` into a `taskList` node — whose schema takes task items only,
 * so ProseMirror lifts every plain item out and leaves an empty `- [ ]` behind at the top of the
 * page. Nothing is lost, but a line nobody wrote is added, which on a git wiki is the same problem.
 *
 * Splitting the runs before that happens says what the markdown already said: a checklist and a
 * bullet list, one after the other. It runs before the task list's own `updateDOM` because it is
 * registered before it.
 */
const SplitMixedLists = Extension.create({
  name: 'markdownMixedLists',
  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element: HTMLElement) {
            for (const list of [...element.querySelectorAll('ul.contains-task-list')]) {
              const items = [...list.children]
              if (items.length === 0 || items.every(isTask) || !items.some(isTask)) continue
              let run: HTMLUListElement | null = null
              let runIsTask: boolean | null = null
              for (const item of items) {
                const task = isTask(item)
                if (run === null || task !== runIsTask) {
                  run = element.ownerDocument.createElement('ul')
                  if (task) run.className = 'contains-task-list'
                  list.parentNode?.insertBefore(run, list)
                  runIsTask = task
                }
                run.append(item)
              }
              list.remove()
            }
          },
        },
      },
    }
  },
})

const isTask = (item: Element) => item.classList.contains('task-list-item')

/**
 * A task list is as tight as any other list.
 *
 * `renderList` reads `node.attrs.tight`; `tiptap-markdown`'s own `MarkdownTightLists` declares that
 * attribute for `bulletList` and `orderedList` only, so without this one `- [x] a` and `- [ ] b`
 * come back with a blank line between them.
 */
const TightTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), tight: { default: true, parseHTML: () => true, renderHTML: () => ({}) } }
  },
})

/**
 * A break inside a paragraph is one newline, not `\` and a newline.
 *
 * With `breaks: true` every soft newline in the file arrives here, so prosemirror-markdown's own
 * `\\\n` would add a backslash to every hard-wrapped line in the wiki on the first save.
 */
const SoftBreak = HardBreak.extend({
  addStorage() {
    return { markdown: { serialize: (state: { write(text: string): void }) => state.write('\n'), parse: {} } }
  },
})

/** The markdown this document is, which is what the file will hold. */
export function markdownOf(editor: Editor): string {
  return editor.storage.markdown.getMarkdown()
}
