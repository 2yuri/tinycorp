import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FileEntry, FileKind, FilePlace, OpenedFile } from '../../../shared/files/files'
import type { FilesEditingProps, FilesSidebarProps, FilesViewerProps } from './FilesPanel'
import { fileRows } from './files-model'
import { activateTab, NO_TABS, openTab, tabKey } from './tabs-model'

let FileTabs: typeof import('./FileTabs').FileTabs
let FileTree: typeof import('./FileTree').FileTree
let FileViewer: typeof import('./Viewers').FileViewer
let FilesActions: typeof import('./FilesPanel').FilesActions
let FilesPanel: typeof import('./FilesPanel').FilesPanel
let Places: typeof import('./FilesPanel').Places
let ConflictDialog: typeof import('./FileDialogs').ConflictDialog
let NewFileDialog: typeof import('./FileDialogs').NewFileDialog
let UnsavedDialog: typeof import('./FileDialogs').UnsavedDialog

const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

beforeAll(async () => {
  // The view reads the preload API when it loads; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = {
    tinyCorp: { files: { places: () => ok([]), tree: () => ok(null), open: () => ok(null), onChanged: never } },
  }
  ;({ FileTabs } = await import('./FileTabs'))
  ;({ FileTree } = await import('./FileTree'))
  ;({ FileViewer } = await import('./Viewers'))
  ;({ FilesActions, FilesPanel, Places } = await import('./FilesPanel'))
  ;({ ConflictDialog, NewFileDialog, UnsavedDialog } = await import('./FileDialogs'))
})

/** The words a piece of markup says, with the tags taken out. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const entries: FileEntry[] = [
  { path: 'src', kind: 'folder', change: null },
  { path: 'src/counter.ts', kind: 'file', change: null },
  { path: 'src/counter.test.ts', kind: 'file', change: 'modified' },
  { path: 'README.md', kind: 'file', change: null },
]

function file(kind: FileKind, extra: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: 'src/counter.ts',
    kind,
    size: 1240,
    text: null,
    truncated: false,
    lines: null,
    dataUrl: null,
    language: null,
    changedLines: [],
    change: null,
    digest: 'sha',
    ...extra,
  }
}

const tree = (query: string) =>
  renderToStaticMarkup(
    <FileTree
      rows={fileRows({ entries, open: new Set(['src']), query })}
      activePath="src/counter.test.ts"
      query={query}
      onQuery={() => {}}
      onPick={() => {}}
    />,
  )

describe('The tree over the place', () => {
  it('marks the files the Employee changed, and only those', () => {
    const html = tree('')

    expect(html).toContain('files-row__mark--modified')
    expect(html.match(/files-row__mark/g)).toHaveLength(2)
    expect(html).toContain('>M<')
  })

  it('shows the file the viewer is on as the chosen one', () => {
    expect(tree('')).toContain('files-row files-row--on')
  })

  it('filters to what the find box asks for, whole paths and no folders', () => {
    const html = tree('counter.test')

    expect(html).toContain('src/counter.test.ts')
    expect(html).not.toContain('>README.md<')
    expect(html).not.toContain('aria-expanded')
  })

  it('says so when nothing matches', () => {
    expect(tree('nothing here')).toContain('No file has that in its name.')
  })

  it('finds a file in the flat, filled field the frame draws, not the kit’s outlined pill', () => {
    const html = tree('')

    expect(html).toContain('data-tone="filled"')
    expect(html).toContain('placeholder="Find a file"')
  })
})

describe('A file opens in the viewer its kind asks for', () => {
  it('hands source to the editor, in the language its extension really names (T222)', () => {
    const html = panel({
      file: file('code', { path: 'src/Counter.tsx', text: 'const one = 1\n', language: 'ts', changedLines: [2] }),
      activePath: 'src/Counter.tsx',
    })

    expect(html).toContain('data-ui="Code editor"')
    // `.tsx` and `.ts` are one language to the reader and two grammars to Monaco.
    expect(html).toContain('data-language="typescript"')
    expect(html).toContain('data-readonly="true"')
  })

  it('renders Markdown as Markdown, and hands its source to the editor when asked', () => {
    const markdown = file('markdown', { path: 'README.md', text: '# Title\n\nA line.\n' })

    const rendered = panel({ file: markdown, activePath: 'README.md' })
    expect(rendered).toContain('data-ui="Markdown viewer"')
    expect(rendered).toContain('<h1>')
    expect(rendered).toContain('A line.')

    const source = panel({ file: markdown, activePath: 'README.md', view: { source: true, zoom: 1, pixels: false } })
    expect(source).toContain('data-ui="Code editor"')
    expect(source).toContain('data-language="markdown"')
    expect(source).not.toContain('<h1>')
  })

  it('draws a Markdown table as a table, not a paragraph of pipes', () => {
    const table = file('markdown', {
      path: 'docs/decisions.md',
      text: ['| # | Decision |', '|---|---|', '| 1 | Real orchestrator |'].join('\n'),
    })

    const html = renderToStaticMarkup(<FileViewer file={table} />)

    expect(html).toContain('<table>')
    expect(html).toContain('<th')
    expect(html).toContain('>Decision<')
    expect(html).toContain('>Real orchestrator<')
    // The pipes are the table's own edges now; none of them is left in the text.
    expect(text(html)).not.toContain('|')
  })

  it('draws an image, with its size and the pixel-true choice a sprite sheet needs', () => {
    const html = renderToStaticMarkup(
      <FileViewer
        file={file('image', { path: 'design/office/character-sheet.png', dataUrl: 'data:image/png;base64,AA' })}
      />,
    )

    expect(html).toContain('data-ui="Image viewer"')
    expect(html).toContain('src="data:image/png;base64,AA"')
    expect(html).toContain('image-rendering:pixelated')
    expect(html).toContain('1.2 KB')
  })

  it('opens an image fitted to the panel, and never enlarges one to fill it (T236)', () => {
    const html = renderToStaticMarkup(
      <FileViewer file={file('image', { path: 'docs/wide.png', dataUrl: 'data:image/png;base64,AA' })} />,
    )

    // `Fit` is the key that is on, and the picture is bounded by the box rather than sized by a zoom.
    expect(html).toContain('files-image__zoom--on">Fit')
    expect(html).toContain('max-h-full max-w-full object-contain')
    expect(html).not.toContain('width:')
  })

  it('sizes an image by its zoom once the boss picks one, and stops fitting it', () => {
    const shot = 'docs/wide.png'
    const state = openTab(NO_TABS, { placeId: worktree.id, path: shot })
    const html = panel({
      tabs: state.tabs,
      activeKey: state.activeKey,
      activePath: shot,
      file: file('image', { path: shot, dataUrl: 'data:image/png;base64,AA' }),
      view: { source: false, zoom: 2, pixels: false },
    })

    expect(html).toContain('files-image__zoom--on">2×')
    expect(html).not.toContain('max-h-full max-w-full object-contain')
  })

  it('leaves a photograph smooth until the boss asks otherwise', () => {
    const html = renderToStaticMarkup(
      <FileViewer file={file('image', { path: 'docs/photo.jpg', dataUrl: 'data:image/jpeg;base64,AA' })} />,
    )

    expect(html).toContain('image-rendering:auto')
  })

  it('shows anything else as plain text, which the editor draws with nothing coloured', () => {
    const html = panel({ file: file('text', { path: 'LICENCE', text: 'All rights reserved' }), activePath: 'LICENCE' })

    expect(html).toContain('data-ui="Code editor"')
    expect(html).toContain('data-language="plaintext"')
  })

  it('says a binary file is binary, and a huge one too big, rather than trying', () => {
    expect(renderToStaticMarkup(<FileViewer file={file('binary', { size: 2048 })} />)).toContain('binary file (2.0 KB)')
    expect(renderToStaticMarkup(<FileViewer file={file('too-big', { size: 9 * 1024 * 1024 })} />)).toContain(
      'Too big to read here',
    )
  })
})

const worktree = {
  id: 'worktree:142:r-web',
  repoId: 'r-web',
  repoName: 'tinycorp',
  path: '/work/acme/worktrees/ticket-142',
  ticketId: 142,
  ticketKey: 'TC-142',
  ticketTitle: 'the counter speaks',
  holderName: 'Ada',
  branch: 'ticket-142-the-counter-speaks',
  base: 'main',
  sessionRunning: false,
}

const NO_VIEW = { source: false, zoom: 1, pixels: false }

/**
 * The panel takes four objects now (T214) — the sidebar, the viewer, the editing and the code — so
 * the overrides are said flat here and spread into the one each belongs to. A spread is not an
 * object literal, so TypeScript lets each of the three take the whole of it and keep its own keys.
 */
type PanelOver = Partial<FilesSidebarProps & FilesViewerProps & FilesEditingProps & { place: FilePlace | null }>

const panel = (over: PanelOver = {}) =>
  renderToStaticMarkup(
    <FilesPanel
      place={over.place === undefined ? worktree : over.place}
      sidebar={{
        rows: fileRows({ entries, open: new Set(['src']) }),
        activePath: 'src/counter.test.ts',
        query: '',
        onQuery: () => {},
        onPick: () => {},
        ...over,
      }}
      viewer={{
        tabs: [],
        activeKey: null,
        file: file('code', {
          text: 'const one = 1\n',
          language: 'ts',
          changedLines: [1],
          change: 'modified',
          lines: 48,
        }),
        view: NO_VIEW,
        onView: () => {},
        onPickTab: () => {},
        onCloseTab: () => {},
        onReveal: () => {},
        ...over,
      }}
      editing={over}
    />,
  )

describe('The view itself', () => {
  it('says what editing writes, and that an image is not part of it', () => {
    expect(panel()).toContain(
      'Editing writes to the worktree on disk. Markdown, text and code only — an image is read-only.',
    )
  })

  it('names the path, whoever is in the file, and how much of it there is', () => {
    const html = panel()

    expect(html).toContain('>src<')
    expect(html).toContain('>counter.test.ts<')
    expect(html).toContain('Ada is in this file')
    expect(html).toContain('48 lines')
  })

  it('draws every crumb the same: the frame lifts none of them, the last one included', () => {
    const html = panel({ activePath: 'src/shared/office/counter.ts' })
    const crumbs = html.match(/class="files-crumbs__crumb[^"]*"/g)

    expect(crumbs).toHaveLength(4)
    expect(new Set(crumbs)).toEqual(new Set(['class="files-crumbs__crumb"']))
  })

  it('says what was left out of a file it read only the head of', () => {
    const html = panel({
      file: file('text', { text: 'x'.repeat(2048), truncated: true, size: 4096, lines: 1 }),
    })

    expect(html).toContain('Only the first 2.0 KB of 4.0 KB is shown.')
  })

  it('offers the boss a new file', () => {
    const html = renderToStaticMarkup(
      <FilesActions
        editors={{ found: [], choice: null, using: 'system' }}
        picking={false}
        onNew={() => {}}
        onPicking={() => {}}
        onEdit={() => {}}
        onChoose={() => {}}
        onReveal={() => {}}
      />,
    )

    expect(html).toContain('New file')
  })

  it('offers the boss their own tools, and says which editor by name', () => {
    const html = renderToStaticMarkup(
      <FilesActions
        editors={{ found: [{ id: 'zed', name: 'Zed' }], choice: 'zed', using: 'zed' }}
        picking={false}
        onPicking={() => {}}
        onEdit={() => {}}
        onChoose={() => {}}
        onReveal={() => {}}
      />,
    )

    expect(html).toContain('Open in Zed')
    expect(html).toContain('Reveal in Finder')
  })

  it('falls back to the system default on a Mac with no editor found', () => {
    const html = renderToStaticMarkup(
      <FilesActions
        editors={{ found: [], choice: null, using: 'system' }}
        picking={false}
        onPicking={() => {}}
        onEdit={() => {}}
        onChoose={() => {}}
        onReveal={() => {}}
      />,
    )

    expect(html).toContain('Open with the system default')
  })

  it('lists what was found and the system default behind the chevron, ticking the one in use', () => {
    const html = renderToStaticMarkup(
      <FilesActions
        editors={{
          found: [
            { id: 'vscode', name: 'VS Code' },
            { id: 'cursor', name: 'Cursor' },
          ],
          choice: null,
          using: 'vscode',
        }}
        path="docs/decisions.md"
        picking
        onPicking={() => {}}
        onEdit={() => {}}
        onChoose={() => {}}
        onReveal={() => {}}
      />,
    )

    expect(html).toContain('VS Code')
    expect(html).toContain('Cursor')
    expect(html).toContain('found on this Mac')
    expect(html).toContain('The system default')
    expect(html).toContain('whatever opens a .md today')
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })

  it('hands a file from outside the Company to the same editor, from its own tab header', () => {
    const html = panel({
      outsidePath: '/Users/boss/Desktop/notes.md',
      editors: { found: [{ id: 'cursor', name: 'Cursor' }], choice: 'cursor', using: 'cursor' },
      onEditOutside: () => {},
    })

    expect(html).toContain('Open in Cursor')
    expect(html).toContain('Reveal in Finder')
  })

  it('names the place under the title, and opens it as a picker only when there is another', () => {
    const alone = renderToStaticMarkup(
      <Places places={[worktree]} place={worktree} open={false} onToggle={() => {}} onPick={() => {}} />,
    )
    expect(alone).toBe('tinycorp · Ada&#x27;s worktree · TC-142 the counter speaks')

    const repo = {
      ...worktree,
      id: 'repo:r-web',
      ticketId: null,
      ticketKey: null,
      ticketTitle: null,
      holderName: null,
      branch: null,
      base: null,
    }
    const both = renderToStaticMarkup(
      <Places places={[worktree, repo]} place={worktree} open onToggle={() => {}} onPick={() => {}} />,
    )
    expect(both).toContain('files-places__button')
    expect(both).toContain('tinycorp · the repository')
  })
})

describe('The files the boss has open, as tabs', () => {
  const opened = (...paths: string[]) =>
    paths.reduce((state, path) => openTab(state, { placeId: worktree.id, path }), NO_TABS)

  it('draws one tab per open file, with its name and a close, and marks the shown one', () => {
    const state = activateTab(opened('src/counter.ts', 'README.md'), tabKey(worktree.id, 'src/counter.ts'))
    const html = renderToStaticMarkup(
      <FileTabs tabs={state.tabs} activeKey={state.activeKey} onPick={() => {}} onClose={() => {}} />,
    )

    expect(html.match(/class="files-tab[ "]/g)).toHaveLength(2)
    expect(html).toContain('>counter.ts<')
    expect(html).toContain('>README.md<')
    expect(html).toContain('aria-label="Close counter.ts"')
    expect(html).toContain('files-tab files-tab--on')
    expect(html).toContain('aria-selected="true"')
  })

  it('draws nothing at all with no file open', () => {
    expect(renderToStaticMarkup(<FileTabs tabs={[]} activeKey={null} onPick={() => {}} onClose={() => {}} />)).toBe('')
  })

  it('shows the tabs above the viewer, and the empty state once the last one closes', () => {
    const state = opened('src/counter.ts')
    const withTabs = panel({ tabs: state.tabs, activeKey: state.activeKey })
    expect(withTabs).toContain('data-ui="File tabs"')

    const empty = panel({ tabs: [], activeKey: null, file: null, activePath: null })
    expect(empty).not.toContain('data-ui="File tabs"')
    expect(empty).toContain('No file open')
    expect(empty).toContain('each one opens as a tab of its own')
  })

  it('gives a file from outside the Company its whole path and its own Reveal in Finder', () => {
    const shot = '/Users/yuri/shots/menu-portrait.png'
    const state = openTab(NO_TABS, { placeId: null, path: shot })
    const html = panel({
      tabs: state.tabs,
      activeKey: state.activeKey,
      activePath: null,
      outsidePath: shot,
      file: file('image', { path: shot, dataUrl: 'data:image/png;base64,AA' }),
      view: { source: false, zoom: 2, pixels: true },
    })

    expect(html).toContain('>menu-portrait.png<')
    expect(html).toContain(`title="${shot}"`)
    expect(html).toContain('files-crumbs__full')
    expect(html).toContain('files-viewer__reveal')
    expect(html).toContain('Reveal in Finder')
    // Nothing of the place's is claimed for a file the Company does not own.
    expect(html).not.toContain('Ada is in this file')
  })

  it('draws an image tab at the zoom and pixel-true the tab is holding', () => {
    const sheet = 'design/office/characters.png'
    const state = openTab(NO_TABS, { placeId: worktree.id, path: sheet })
    const html = panel({
      tabs: state.tabs,
      activeKey: state.activeKey,
      activePath: sheet,
      file: file('image', { path: sheet, dataUrl: 'data:image/png;base64,AA' }),
      view: { source: false, zoom: 4, pixels: false },
    })

    expect(html).toContain('files-image__zoom--on">4×')
    // The tab was holding pixel-true off, so the sheet's own default never comes back.
    expect(html).toContain('image-rendering:auto')
  })
})

describe('Editing a file in place (T122)', () => {
  const editing = (extra: PanelOver = {}) =>
    panel({
      file: file('code', { path: 'src/counter.ts', text: 'const one = 1\n', language: 'ts', lines: 1 }),
      activePath: 'src/counter.ts',
      editable: true,
      text: 'const one = 1\n',
      ...extra,
    })

  it('opens a text, code or Markdown file in Monaco, writable rather than read-only (T222)', () => {
    const html = editing()

    expect(html).toContain('data-ui="Code editor"')
    expect(html).toContain('aria-label="Edit src/counter.ts"')
    expect(html).toContain('data-readonly="false"')
  })

  it('says Edited, not saved with a dot beside the path, and offers Discard and Save ⌘S', () => {
    const html = editing({ text: 'const one = 2\n', dirty: true })

    expect(html).toContain('files-edited__dot')
    expect(html).toContain('Edited, not saved')
    expect(html).toContain('>Discard<')
    expect(html).toContain('Save')
    expect(html).toContain('⌘S')
    // The chips step aside for them while there is something to save.
    expect(html).not.toContain('files-chip--plain')
  })

  it('leaves a clean file its chips and no Save at all', () => {
    const html = editing()

    expect(html).not.toContain('Edited, not saved')
    expect(html).not.toContain('>Discard<')
    expect(html).toContain('files-chip--plain')
  })

  it('marks every tab that holds unsaved work, so the boss sees it before closing one', () => {
    const state = openTab(openTab(NO_TABS, { placeId: worktree.id, path: 'src/counter.ts' }), {
      placeId: worktree.id,
      path: 'README.md',
    })
    const html = renderToStaticMarkup(
      <FileTabs
        tabs={state.tabs}
        activeKey={state.activeKey}
        dirtyKeys={[tabKey(worktree.id, 'src/counter.ts')]}
        onPick={() => {}}
        onClose={() => {}}
      />,
    )

    expect(html.match(/files-tab__dot/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Edited, not saved"')
  })

  it('warns, above the file, while whoever holds the worktree has a Session running in it', () => {
    const running = { ...worktree, sessionRunning: true }

    expect(editing({ place: running })).toContain(
      'Ada has a Session running in this worktree. If they write this file while you are editing it, your save will stop and show you both versions.',
    )
    expect(editing()).not.toContain('has a Session running')
    // A warning, not a lock: the boss still has their editor.
    expect(editing({ place: running })).toContain('data-ui="Code editor"')
  })

  it('keeps an image read-only: no text area, whatever the place is doing', () => {
    const shot = 'design/screens/CwBoJ.png'
    const html = panel({
      activePath: shot,
      file: file('image', { path: shot, dataUrl: 'data:image/png;base64,AA' }),
      editable: false,
    })

    expect(html).not.toContain('data-ui="File editor"')
    expect(html).toContain('data-ui="Image viewer"')
    expect(html).toContain('an image is read-only')
  })

  it('says why a file it only read the head of cannot be typed into', () => {
    const html = panel({
      file: file('text', { text: 'x'.repeat(2048), truncated: true, size: 4096, lines: 1 }),
      editable: false,
    })

    expect(html).toContain('saving it back would drop the rest')
  })
})

describe('The dialogs a write puts in front of the boss (T122)', () => {
  it('asks for a path inside the place, starting at the folder the tree has chosen', () => {
    const html = renderToStaticMarkup(
      <NewFileDialog place={worktree} folder="docs/adr" onCancel={() => {}} onCreate={() => {}} />,
    )

    expect(html).toContain('New file')
    expect(html).toContain('value="docs/adr/"')
    expect(html).toContain('Inside tinycorp · Ada&#x27;s worktree · TC-142 the counter speaks')
    expect(html).toContain('Create file')
  })

  it('shows what the main process refused a name for', () => {
    const html = renderToStaticMarkup(
      <NewFileDialog
        place={worktree}
        folder={null}
        error="docs/decisions.md already exists — pick another name"
        onCancel={() => {}}
        onCreate={() => {}}
      />,
    )

    expect(html).toContain('already exists')
  })

  it('asks before unsaved work goes, naming the file and offering all three answers', () => {
    const html = renderToStaticMarkup(
      <UnsavedDialog path="docs/decisions.md" others={2} onCancel={() => {}} onDiscard={() => {}} onSave={() => {}} />,
    )

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('Save decisions.md first?')
    expect(html).toContain('2 other files are edited too')
    expect(text(html)).toMatch(/Cancel Discard changes Save$/)
  })

  it('shows both versions when a save stopped, and never picks for the boss', () => {
    const html = renderToStaticMarkup(
      <ConflictDialog
        conflict={{
          path: 'docs/decisions.md',
          theirs: 'what the Employee wrote',
          theirDigest: 'sha-theirs',
          yours: 'what the boss typed',
        }}
        holderName="Ada"
        onCancel={() => {}}
        onTakeTheirs={() => {}}
        onKeepMine={() => {}}
      />,
    )

    expect(html).toContain('decisions.md changed while you were typing')
    expect(html).toContain('Ada wrote this file after you opened it, so nothing has been overwritten')
    expect(html).toContain('what the Employee wrote')
    expect(html).toContain('what the boss typed')
    expect(text(html)).toMatch(/Keep editing Take theirs Keep mine$/)
  })
})

describe('a Company with no repo of its own', () => {
  it('still shows the file a message asked it to open (T125)', () => {
    // The empty state belongs to a Company with nothing open: a path clicked in a message lands
    // here with a tab of its own, and used to be answered with `No repo to read yet` instead.
    const html = panel({
      place: null,
      rows: [],
      activePath: null,
      outsidePath: '/Users/yuri/shot.png',
      file: file('image', { dataUrl: 'data:image/png;base64,iVBOR', lines: null }),
    })

    expect(html).not.toContain('No repo to read yet')
    expect(html).toContain('/Users/yuri/shot.png')
  })
})

/**
 * What the frames say about this screen, read off the components: the audit of `ZNpqJ` and `CwBoJ`
 * found each of these painted the other way, and no test was watching.
 *
 * These read the stylesheets until T210e moved the folder onto utilities. The facts are the same and
 * so are the frames; what changed is where they are written down — a named class list on the
 * component instead of a rule in a sheet.
 */
describe('The screen against its frame', () => {
  /** One class list, by the name the component gives it. */
  const list = (source: string, name: string) => {
    const found = new RegExp(`^(?:export )?const ${name} =\\s*(?:'|String\\.raw\`)([^'\`]*)`, 'm').exec(source)
    expect(found, name).not.toBeNull()
    return found?.[1] ?? ''
  }

  it('paints the Session warning white and lets only its triangle be amber (CwBoJ)', async () => {
    // `files.css` is gone (T210e); the band is one class list on `FileEditor.tsx` now.
    const source = (await import('./FileEditor.tsx?raw')).default
    const band = list(source, 'SESSION_WARNING')

    expect(band).toContain('text-foreground')
    // The band is closed by an amber rule, not the neutral border every other band uses.
    expect(band).toContain('border-b-brand-warning')
    // Only the triangle is amber; the sentence is read, not alarmed at.
    expect(band).toContain('[&_svg]:text-brand-warning')
  })

  it('keeps every crumb the same grey, joins included (ZNpqJ)', async () => {
    // The separator was `.files-crumbs__crumb + .files-crumbs__crumb::before`; it is `not-first:before:`
    // on the crumb itself now, which is the same rule said at the element it applies to (T210e).
    const source = (await import('./Viewers.tsx?raw')).default
    const crumbs = list(source, 'CRUMBS')

    expect(source).not.toContain('files-crumbs__crumb--last')
    // The separator is on the container, so every crumb keeps the same class and the same grey.
    expect(crumbs).toContain('[&>*+*]:before:text-inherit')
    expect(crumbs).toContain('[&>*+*]:before:content-["/"]')
  })

  it('draws the Open with list at the frame’s width, with no rule above its note (CwBoJ)', async () => {
    // `open-with.css` is gone (T210e); both facts are pinned on the component's own class lists now.
    const source = (await import('../editors/OpenWith.tsx?raw')).default

    expect(list(source, 'MENU')).toContain('min-w-320')
    expect(list(source, 'NOTE')).not.toContain('border-t')
  })
})
