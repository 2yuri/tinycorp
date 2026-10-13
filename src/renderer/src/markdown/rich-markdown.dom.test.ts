// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { markdownOf, richMarkdownExtensions } from './rich-markdown'

/**
 * The one thing a WYSIWYG editor over a git wiki has to prove: a page opened and saved unchanged
 * writes the same bytes back (T225). Every block the toolbar can make is in the page below, in the
 * shape an Employee writes it — hard-wrapped prose, `-` bullets, ATX headings, fenced code — so a
 * serialiser default that disagrees with any of them fails here and not in someone's commit.
 */
const PAGE = [
  'Money is stored in minor units and formatted once, at the edge. The locale comes from the account,',
  'never from the browser, so an invoice reads the same for everyone who opens it.',
  '',
  '## Decision',
  '',
  '- billing-api returns amounts as integers plus a currency code — no formatted strings.',
  '- web-app formats with formatPrice(amount, account.locale) and nothing else.',
  '- A missing locale falls back to en-US, logged once per account.',
  '',
  '```ts',
  'const label = formatPrice(invoice.total, account.locale)',
  '// never: invoice.total.toLocaleString()',
  '```',
  '',
  '## Why',
  '',
  'TC-142’s review found three places formatting with the browser locale; the 90d chart and the',
  'invoice list disagreed for a German account. Iris’s test run caught the same mismatch.',
  '',
  '## Checks',
  '',
  '- [x] Land the formatter behind a flag',
  '- [ ] Delete the old currency helper',
  '',
  '> An invoice reads the same for everyone who opens it.',
  '',
  '1. Read the account',
  '2. Format at the edge',
  '',
  'See [the ADR](https://example.com/adr) for **why**, *when* and `how`.',
].join('\n')

const open = (markdown: string) => new Editor({ extensions: richMarkdownExtensions('Write here'), content: markdown })

describe('a Memory page through the rich editor', () => {
  it('writes back exactly what it opened, byte for byte', () => {
    expect(markdownOf(open(PAGE))).toBe(PAGE)
  })

  it('keeps the hard wrapping an Employee wrote, so one edited line is one changed line', () => {
    const editor = open(PAGE)
    expect(markdownOf(editor).split('\n')).toEqual(PAGE.split('\n'))
  })

  it('keeps `-` bullets rather than prosemirror-markdown’s `*`', () => {
    expect(markdownOf(open('- one\n- two'))).toBe('- one\n- two')
  })

  it('keeps ATX headings and a fenced block with its language', () => {
    expect(markdownOf(open('### Deep\n\n```sh\npnpm test\n```'))).toBe('### Deep\n\n```sh\npnpm test\n```')
  })

  it('keeps a task list tight, which is where prosemirror-markdown would add a blank line', () => {
    expect(markdownOf(open('- [ ] one\n- [x] two'))).toBe('- [ ] one\n- [x] two')
  })
})

/**
 * Typing, as the editor hears it: one character at a time through ProseMirror's own
 * `handleTextInput`, which is what makes an input rule fire. A rule that never ran is the whole
 * difference between markdown shortcuts and a box that swallows `##`.
 */
function type(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection
    const insert = () => editor.state.tr.insertText(character, from, to)
    const handled = editor.view.someProp('handleTextInput', (run) => run(editor.view, from, to, character, insert))
    if (!handled) editor.view.dispatch(insert())
  }
}

describe('markdown shortcuts as the boss types', () => {
  /**
   * The bug T219 came from, on the keystroke it happened on: `##` and a space made a heading, and
   * the text typed after it stayed. Here the markers become the heading itself, which is what a
   * WYSIWYG editor is — and the file still says `## Decision`.
   */
  it('turns `## ` and the text after it into a heading, and writes the heading back as `## `', () => {
    const editor = open('')
    type(editor, '## Decision')

    expect(editor.getHTML()).toContain('<h2>Decision</h2>')
    expect(markdownOf(editor)).toBe('## Decision')
  })

  it('makes a bullet out of `- `, a quote out of `> ` and a fenced block out of a fence', () => {
    const bullet = open('')
    type(bullet, '- one')
    expect(markdownOf(bullet)).toBe('- one')

    const quote = open('')
    type(quote, '> said')
    expect(markdownOf(quote)).toBe('> said')

    const fence = open('')
    type(fence, '```ts ')
    type(fence, 'pnpm test')
    expect(markdownOf(fence)).toBe('```ts\npnpm test\n```')
  })

  it('makes `**` bold and `*` italic without leaving the markers in the text', () => {
    const editor = open('')
    type(editor, '**loud** and *soft*')

    expect(editor.getHTML()).toContain('<strong>loud</strong>')
    expect(editor.getHTML()).toContain('<em>soft</em>')
    expect(markdownOf(editor)).toBe('**loud** and *soft*')
  })
})

describe('what a document model cannot keep', () => {
  /**
   * Said out loud, because it is the trade this ticket took: a model holds a list, not a marker.
   * Everything else on a Memory page survives, which is what the round trip above proves.
   */
  it('writes a `*` bullet back as the `-` the rest of the wiki uses', () => {
    expect(markdownOf(open('* a star\n* and a moon'))).toBe('- a star\n- and a moon')
  })

  /**
   * A checklist and a bullet list written as one markdown list come back as two, one after the
   * other. Without the split in `rich-markdown.ts` they came back as two *and* an empty `- [ ]`
   * nobody wrote, which on a git wiki is a line in a commit that has no author.
   */
  it('splits a list that is part checklist and part bullets, and adds no item of its own', () => {
    expect(markdownOf(open('- plain one\n- [x] a task\n- plain two'))).toBe(
      '- plain one\n\n- [x] a task\n\n- plain two',
    )
  })
})
