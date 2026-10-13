// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryPage } from '../../../shared/memory/company-memory'
import { MemoryEditor } from './MemoryEditor'

/**
 * The boss writing a page (frames `V2v4hd` and `DHYKn`). What is checked here is what the frame
 * settled and what the store refuses: the path follows the kind the chips choose, Handoff is not
 * on offer, Save stays out of reach until there is a title and a body, an existing page keeps the
 * two things that are its file name, and the three modes draw the document, the reading pane and
 * the file.
 *
 * The body is a TipTap document now (T225). What a keystroke does to it is asked of the extension
 * set in `markdown/rich-markdown.dom.test.ts`, which can talk to ProseMirror directly; here the
 * body is written the way a browser writes one — into the contenteditable, which is where
 * ProseMirror reads every keystroke back from.
 */

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const text = () => host.textContent ?? ''
const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.memory-editor__kind')]
const mode = (label: string) => {
  const found = [...host.querySelectorAll<HTMLElement>('.memory-editor__modes button')].find(
    (one) => (one.textContent ?? '').trim() === label,
  )
  if (!found) throw new Error(`No mode called "${label}"`)
  return found
}
const button = (label: string) => {
  const found = [...host.querySelectorAll('button')].find((one) => (one.textContent ?? '').trim() === label)
  if (!found) throw new Error(`No button says "${label}"`)
  return found
}
const field = <T extends HTMLElement>(selector: string) => {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`No ${selector}`)
  return found
}

/** The document the page body is written in (T225), as it stands in the screen. */
const document_ = () => field<HTMLElement>('.memory-editor__area .ProseMirror')

/**
 * Writing in the body, the way a browser writes one: the text goes into the contenteditable and
 * ProseMirror's own observer reads it back, which is the path every keystroke really takes.
 */
async function write(text: string): Promise<void> {
  const into = document_().firstElementChild ?? document_()
  await act(async () => {
    into.textContent = text
    await Promise.resolve()
  })
}

const body = () => document_().textContent ?? ''

/** Typing, the way React hears it: the value is set on the node and the event is dispatched. */
function type(node: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(node.constructor.prototype, 'value')?.set
  act(() => {
    setter?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function page(over: Partial<MemoryPage> = {}): MemoryPage {
  return {
    slug: 'locale-handling-in-billing',
    kind: 'decision',
    title: 'Locale handling in billing',
    body: 'Money is stored in minor units.',
    repos: ['billing-api'],
    sources: [],
    links: [],
    updatedBy: 'Vega',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-21T09:00:00.000Z',
    pinned: false,
    archived: false,
    handoff: null,
    ...over,
  }
}

function editor(over: { page?: MemoryPage | null } = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  act(() =>
    root.render(
      <MemoryEditor page={over.page ?? null} repos={['web-app', 'billing-api']} onSave={onSave} onCancel={onCancel} />,
    ),
  )
  return { onSave, onCancel }
}

describe('writing a new page', () => {
  it('draws the path bar, the front matter and the editor the frame gives it', () => {
    editor()
    expect(field<HTMLElement>('.memory-page__path').textContent).toBe('memory / decisions / new page')
    expect(field<HTMLInputElement>('.memory-editor__title').placeholder).toBe('Untitled page')
    expect(text()).toContain('Saved as a markdown file and one commit by you.')
    expect(text()).toContain('Every edit is a commit')
  })

  it('offers every kind the boss may write, and not the one only an Employee writes', () => {
    editor()
    expect(chips().map((chip) => chip.textContent)).toEqual([
      'Decision',
      'Convention',
      'Gotcha',
      'Architecture',
      'Glossary',
    ])
    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ])
  })

  /** `architecture` is not `architectures`: the path bar has to name the folder the store writes. */
  it('follows the chosen kind into its own folder', () => {
    editor()
    act(() => chips()[3]!.click())
    expect(field<HTMLElement>('.memory-page__path').textContent).toBe('memory / architecture / new page')
    act(() => chips()[2]!.click())
    expect(field<HTMLElement>('.memory-page__path').textContent).toBe('memory / gotchas / new page')
  })

  it('keeps Save out of reach until there is both a title and a body', async () => {
    const { onSave } = editor()
    expect(button('Save page').disabled).toBe(true)

    type(field<HTMLInputElement>('.memory-editor__title'), 'Locale handling in billing')
    expect(button('Save page').disabled).toBe(true)

    await write('Money is stored in minor units.')
    expect(button('Save page').disabled).toBe(false)

    act(() => button('Save page').click())
    expect(onSave).toHaveBeenCalledWith({
      kind: 'decision',
      title: 'Locale handling in billing',
      body: 'Money is stored in minor units.',
      mode: 'replace',
    })
  })

  it('saves the repo the select names, and nothing when the page is the whole Company’s', async () => {
    const { onSave } = editor()
    type(field<HTMLInputElement>('.memory-editor__title'), 'A page')
    await write('A body')

    const select = field<HTMLSelectElement>('.memory-editor__repo select')
    expect([...select.options].map((one) => one.textContent)).toEqual([
      'No repo · whole Company',
      'web-app',
      'billing-api',
    ])
    act(() => {
      select.value = 'web-app'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    act(() => button('Save page').click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ repos: ['web-app'] }))
  })

  it('previews the body with the reading pane’s own renderer, not a second one', () => {
    editor({ page: page({ body: '## Decision\n\nFormatted at the edge.' }) })
    act(() => mode('Preview').click())

    const preview = field<HTMLElement>('.memory-editor__preview')
    expect(preview.classList).toContain('memory-body')
    expect(preview.querySelector('h2')?.textContent).toBe('Decision')
    expect(preview.textContent).toContain('Formatted at the edge.')
  })

  /** The undo history is the document's, so a look at the preview may not throw it away. */
  it('keeps the document mounted behind the preview and the source', () => {
    editor({ page: page({ body: '## Decision' }) })
    const before = document_()

    act(() => mode('Preview').click())
    expect(field<HTMLElement>('[data-ui="Markdown editor"]').className).toContain('hidden')
    expect(document_()).toBe(before)

    act(() => mode('Edit').click())
    expect(field<HTMLElement>('[data-ui="Markdown editor"]').className).not.toContain('hidden')
  })

  it('shows the file it will commit under Markdown, exactly as the file will hold it', () => {
    editor({ page: page({ body: '## Decision\n\n- one\n- two' }) })
    act(() => mode('Markdown').click())

    expect(field<HTMLElement>('.memory-editor__source').textContent).toBe('## Decision\n\n- one\n- two')
  })

  /**
   * `## Decision` is drawn as the heading it is and saved as the `## ` it was — the WYSIWYG half of
   * the bug this screen has now been through twice. What the keystrokes do on the way there is
   * `markdown/rich-markdown.dom.test.ts`'s question.
   */
  it('draws `## ` as a heading and saves it as `## ` again', () => {
    const written = 'Money is stored in minor units.\n\n## Decision'
    const { onSave } = editor({ page: page({ body: written }) })

    expect(document_().querySelector('h2')?.textContent).toBe('Decision')
    act(() => button('Save page').click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ body: written }))
  })

  /**
   * A page the boss opens and saves unchanged is not a diff in the wiki (T225). Every block the
   * toolbar can make is in this page, in the shape an Employee writes it — hard-wrapped prose,
   * `-` bullets, ATX headings, fenced code — and the whole of the settings that keep it that way
   * is `markdown/rich-markdown.ts`.
   */
  it('saves the markdown it was given, character for character', () => {
    const written = [
      'Money is stored in minor units and formatted once, at the edge. The locale comes from the account,',
      'never from the browser.',
      '',
      '## Decision',
      '',
      '- billing-api returns integers plus a currency code.',
      '',
      '## Checks',
      '',
      '- [x] Land the formatter behind a flag',
      '',
      '```sh',
      'pnpm test',
      '```',
      '',
      '> An invoice reads the same for everyone.',
    ].join('\n')
    const { onSave } = editor({ page: page({ body: written }) })
    act(() => button('Save page').click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ body: written }))
  })

  /**
   * What TipTap does normalise, said out loud: a document model holds a list, not a marker, so a
   * page written with `*` comes back with the `-` the rest of the wiki uses. That is the trade the
   * ticket took, and a test that names it is how the trade stays this small.
   */
  it('normalises a `*` bullet to the `-` the wiki is written in', () => {
    const { onSave } = editor({ page: page({ body: '* a star\n* and a moon' }) })
    act(() => button('Save page').click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ body: '- a star\n- and a moon' }))
  })

  /** The hint says the key the boss's own machine has: ⌘ here, Ctrl on Windows and Linux. */
  it('names the emphasis shortcuts in the platform’s own words', () => {
    editor()
    const bold = [...host.querySelectorAll('button')].find((one) =>
      (one.getAttribute('aria-label') ?? '').startsWith('Bold'),
    )
    expect(bold?.getAttribute('aria-label')).toBe('Bold (⌘B)')
    expect(text()).toContain('Markdown shortcuts as you type')
  })

  it('hands the cancel back rather than clearing the page itself', () => {
    const { onCancel } = editor()
    act(() => button('Cancel').click())
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('rewriting a page that exists', () => {
  it('fills the same layout in, and shows the file it will commit', () => {
    editor({ page: page() })
    expect(field<HTMLElement>('.memory-page__path').textContent).toBe(
      'memory / decisions / locale-handling-in-billing.md',
    )
    expect(field<HTMLInputElement>('.memory-editor__title').value).toBe('Locale handling in billing')
    expect(body()).toBe('Money is stored in minor units.')
    expect(field<HTMLSelectElement>('.memory-editor__repo select').value).toBe('billing-api')
    expect(button('Save page').disabled).toBe(false)
  })

  /** Both are the file name, and renaming a page would be a second page nobody linked to. */
  it('holds the kind and the title still', () => {
    editor({ page: page() })
    expect(chips().every((chip) => chip.disabled)).toBe(true)
    expect(field<HTMLInputElement>('.memory-editor__title').readOnly).toBe(true)
  })
})
