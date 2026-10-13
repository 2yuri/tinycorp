import { describe, expect, it } from 'vitest'
import { newFilePath, newFileRefusal, newFileStart, sessionWarning } from '../../../shared/files/file-edits'
import type { FileKind, OpenedFile } from '../../../shared/files/files'
import {
  anyDirty,
  dirtyKeys,
  draftOf,
  dropDraft,
  isDirty,
  isEditable,
  isSaveKey,
  NO_DRAFTS,
  readOnlyNotice,
  textOf,
  typedInto,
  unsavedBody,
  unsavedTitle,
} from './editing-model'

function file(kind: FileKind, extra: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: 'docs/decisions.md',
    kind,
    size: 40,
    text: 'one\n',
    truncated: false,
    lines: 1,
    dataUrl: null,
    language: null,
    changedLines: [],
    change: null,
    digest: 'abc',
    ...extra,
  }
}

const KEY = 'place:worktree:142:r-web:docs/decisions.md'

describe('What the boss may type into', () => {
  it('opens text, code and Markdown of a place editable', () => {
    expect(isEditable(file('text'), 'worktree:142:r-web')).toBe(true)
    expect(isEditable(file('code'), 'worktree:142:r-web')).toBe(true)
    expect(isEditable(file('markdown'), 'worktree:142:r-web')).toBe(true)
  })

  it('keeps an image, a binary file and a file from outside the Company read-only', () => {
    expect(isEditable(file('image', { text: null, dataUrl: 'data:image/png;base64,x' }), 'repo:r-web')).toBe(false)
    expect(isEditable(file('binary', { text: null }), 'repo:r-web')).toBe(false)
    expect(isEditable(file('markdown'), null)).toBe(false)
    // An image says what it is on its own; the line under the viewer says it is read-only.
    expect(readOnlyNotice(file('image', { text: null }), 'repo:r-web')).toBeNull()
    expect(readOnlyNotice(file('markdown'), null)).toContain('outside the Company')
  })

  it('keeps a file it only read the head of read-only, so a save cannot drop the rest', () => {
    const half = file('code', { truncated: true, size: 900_000 })

    expect(isEditable(half, 'repo:r-web')).toBe(false)
    expect(readOnlyNotice(half, 'repo:r-web')).toContain('drop the rest')
  })
})

describe('The unsaved work a tab holds', () => {
  it('has nothing until the boss types, and then says the tab is edited', () => {
    expect(isDirty(NO_DRAFTS, KEY)).toBe(false)
    expect(textOf(NO_DRAFTS, KEY, file('markdown'))).toBe('one\n')

    const drafts = typedInto(NO_DRAFTS, KEY, file('markdown'), 'one\ntwo\n')

    expect(isDirty(drafts, KEY)).toBe(true)
    expect(anyDirty(drafts)).toBe(true)
    expect(dirtyKeys(drafts)).toEqual([KEY])
    expect(textOf(drafts, KEY, file('markdown'))).toBe('one\ntwo\n')
    expect(draftOf(drafts, KEY)).toMatchObject({ opened: 'one\n', digest: 'abc' })
  })

  it('remembers the file it was opened from, however often the boss types', () => {
    const once = typedInto(NO_DRAFTS, KEY, file('markdown'), 'one\ntwo\n')
    const twice = typedInto(once, KEY, file('markdown', { text: 'something else', digest: 'zzz' }), 'one\ntwo\nthree\n')

    expect(draftOf(twice, KEY)).toMatchObject({ opened: 'one\n', digest: 'abc' })
  })

  it('typing the file back as it was leaves nothing unsaved', () => {
    const drafts = typedInto(typedInto(NO_DRAFTS, KEY, file('markdown'), 'changed'), KEY, file('markdown'), 'one\n')

    expect(isDirty(drafts, KEY)).toBe(false)
    expect(anyDirty(drafts)).toBe(false)
  })

  it('discarding — and a save that landed — puts the file back with nothing unsaved', () => {
    const drafts = typedInto(NO_DRAFTS, KEY, file('markdown'), 'one\ntwo\n')

    const after = dropDraft(drafts, KEY)

    expect(isDirty(after, KEY)).toBe(false)
    expect(textOf(after, KEY, file('markdown'))).toBe('one\n')
    expect(dropDraft(after, KEY)).toBe(after)
  })

  it('keeps every tab’s work apart', () => {
    const other = 'place:repo:r-web:README.md'
    const drafts = typedInto(typedInto(NO_DRAFTS, KEY, file('markdown'), 'mine'), other, file('markdown'), 'one\n')

    expect(dirtyKeys(drafts)).toEqual([KEY])
  })
})

describe('The keys and the words editing uses', () => {
  it('takes ⌘S, and Ctrl+S off a Mac', () => {
    expect(isSaveKey({ key: 's', metaKey: true, ctrlKey: false })).toBe(true)
    expect(isSaveKey({ key: 'S', metaKey: false, ctrlKey: true })).toBe(true)
    expect(isSaveKey({ key: 's', metaKey: false, ctrlKey: false })).toBe(false)
    expect(isSaveKey({ key: 'a', metaKey: true, ctrlKey: false })).toBe(false)
  })

  it('names the file in the ask before unsaved work goes, and counts the others', () => {
    expect(unsavedTitle('docs/decisions.md')).toBe('Save decisions.md first?')
    expect(unsavedBody('docs/decisions.md')).toContain('edited and not saved')
    expect(unsavedBody('docs/decisions.md', 1)).toContain('1 other file is edited too')
    expect(unsavedBody('docs/decisions.md', 2)).toContain('2 other files are edited too')
  })

  it('warns in the design’s words while whoever holds the ticket is at work in it', () => {
    expect(sessionWarning('Ada')).toBe(
      'Ada has a Session running in this worktree. If they write this file while you are editing it, your save will stop and show you both versions.',
    )
    expect(sessionWarning(null)).toContain('An Employee has a Session running')
  })
})

describe('The path a new file asks for', () => {
  it('starts at the folder the tree has chosen', () => {
    expect(newFileStart('docs/adr')).toBe('docs/adr/')
    expect(newFileStart(null)).toBe('')
    expect(newFilePath('docs', 'notes.md')).toBe('docs/notes.md')
    expect(newFilePath('', 'notes.md')).toBe('notes.md')
  })

  it('refuses a path with a reason: nothing, a folder, a climb out, and git’s own', () => {
    expect(newFileRefusal('docs/notes.md')).toBeNull()
    expect(newFileRefusal('  ')).toContain('Name the file')
    expect(newFileRefusal('docs/')).toContain('names a folder')
    expect(newFileRefusal('../outside.md')).toContain('climb out')
    expect(newFileRefusal('/etc/passwd')).toContain('starts at the place')
    expect(newFileRefusal('.git/hooks/pre-commit')).toContain('.git')
  })
})
