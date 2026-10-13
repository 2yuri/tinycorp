import { Check, Code2, Eye, FolderGit2, GitCommitHorizontal, Pencil, Plug, X } from 'lucide-react'
import { useId, useState } from 'react'
import {
  MEMORY_KIND_LABEL,
  MEMORY_KINDS,
  type MemoryKind,
  type MemoryPage,
  type MemoryWrite,
  memoryKindFolder,
  pagePath,
} from '../../../shared/memory/company-memory'
import { MarkdownBody } from '../files'
import { MarkdownEditor } from '../markdown'
import { Button, cx, SegmentedControl, Select, SHELL_BUTTON } from '../ui'
import { KIND_ICON } from './MemoryList'
import { BAR, BODY, FOOTER, PAGE, PATH } from './MemoryPageView'

/**
 * The placeholder the empty document offers. One line, not the markdown skeleton T219 drew: this
 * is a WYSIWYG document now, so a `## Decision` in the placeholder would be asking the boss to
 * type markers the toolbar is there to put in.
 */
const BODY_PLACEHOLDER = 'Say the thing first, then why.'

/** A Handoff is written by an Employee moving work, never by the boss, so no chip offers it. */
const OFFERED: readonly MemoryKind[] = MEMORY_KINDS.filter((kind) => kind !== 'handoff')

/**
 * The boss writing a page (frame `V2v4hd`): the reading pane, turned into the document itself.
 * It reuses the open page's own bar and footer, so only what is between them is here.
 *
 * Every box below was read off the frame: the doc's own bands are 20 from the bar, a 29px title, a
 * 25px chip row, a 32px select, 14 of padding under the rule and 16 between blocks — and they only
 * add up because each list says how tall its line is. `ui/line-boxes.test.ts` pins the six that an
 * audited pair stacks, which is why they are named rather than inlined.
 *
 * `memory-editor__area` stays in its list: `MemoryEditor.dom.test.tsx` reads the textarea through it.
 */
const DOC = 'flex min-h-0 flex-1 flex-col gap-16 bg-code px-40 py-20'

/* The title, in the type it will be read in: a boxed input here would make the page a form. The
   frame's 29px box is what puts the kind row 16 under it. */
const EDITOR_TITLE =
  'memory-editor__title m-0 w-full border-0 bg-transparent p-0 font-sans font-bold text-24/29 tracking-[-0.4px] text-foreground outline-none placeholder:text-muted-foreground placeholder:opacity-100'

/* The same two rows the open page draws, as controls: the key column, then the value. The frame
   draws the rule inside its own 14px, so the padding gives back the rule's width. */
const FRONT =
  'm-0 grid grid-cols-[64px_1fr] gap-x-14 gap-y-10 border-b border-border pb-13 [&_dt]:self-center [&_dt]:font-code [&_dt]:text-12/16 [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:flex [&_dd]:min-w-0 [&_dd]:items-center'

/* The frame's 25px chip: 13px of line inside 5 of padding and the stroke. */
/* Two whole lists, not a list and an override: see `CHIP` in `MemoryList.tsx` for why. */
const KIND =
  'memory-editor__kind inline-flex items-center gap-6 whitespace-nowrap rounded-full border border-border bg-transparent px-10 py-5 font-sans font-normal text-12/13 text-muted-foreground disabled:cursor-default disabled:opacity-50 [&_svg]:flex-none'

const KIND_ON =
  'memory-editor__kind inline-flex items-center gap-6 whitespace-nowrap rounded-full border border-primary bg-primary-subtle px-10 py-5 font-sans font-semibold text-12/13 text-foreground disabled:cursor-default disabled:opacity-50 [&_svg]:flex-none [&_svg]:text-primary'

/* The kit's select at the frame's own size: one 32px row, not the 40px a labelled field is. Focus
   thickens the stroke, and the padding gives back the pixel so the row keeps its height. */
const REPO =
  'memory-editor__repo shrink-0 grow-0 basis-auto [&_[data-slot=field-control]]:h-32 [&_[data-slot=field-control]]:w-240 [&_[data-slot=field-control]]:gap-8 [&_[data-slot=field-control]]:bg-muted [&_[data-slot=field-control]]:px-9 [&_[data-slot=field-control]]:focus-within:px-8 [&_[data-slot=field-input]]:text-12/16 [&_[data-slot=field-icon]]:size-13'

const CARD = 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card'

/* The frame's 30px track: the kit's segmented control at the size this card's first band is. */
const MODES = 'memory-editor__modes h-30 gap-3 rounded-sm border border-border bg-transparent p-2'

/* Two whole lists, not a list and an override: see `CHIP` in `MemoryList.tsx` for why. */
const MODE =
  'inline-flex h-26 cursor-pointer items-center gap-6 rounded-sm border-0 bg-transparent px-12 font-sans font-medium text-12/13 text-muted-foreground'

const MODE_ON =
  'inline-flex h-26 cursor-pointer items-center gap-6 rounded-sm border-0 bg-primary px-12 font-sans font-semibold text-12/13 text-primary-foreground'

const HINT = 'ml-auto text-11/13 text-muted-foreground'

/** Edit is the document, Preview is the reading pane, Markdown is the file that will be written. */
type Mode = 'edit' | 'preview' | 'markdown'

const MODE_OPTIONS = [
  { value: 'edit' as const, label: 'Edit', icon: Pencil },
  { value: 'preview' as const, label: 'Preview', icon: Eye },
  { value: 'markdown' as const, label: 'Markdown', icon: Code2 },
]

/*
 * A task list, which the reading pane draws as text and an editable document draws as boxes.
 * TipTap writes `<ul data-type="taskList"><li><label><input></label><div>…</div></li></ul>`, so the
 * bullet goes and the label carries the box.
 */
const TASKS =
  '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-2 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-8 [&_ul[data-type=taskList]_li_label]:mt-3 [&_ul[data-type=taskList]_li_label]:flex [&_ul[data-type=taskList]_li_label]:shrink-0 [&_ul[data-type=taskList]_li_div]:min-w-0 [&_ul[data-type=taskList]_li_div_p]:mb-0'

/*
 * The document, in the type it will be read in: the reading pane's own list, so the boss writing a
 * page and the Employee reading it see the same page (T225). What is added to it is the one block
 * only an editable document draws.
 *
 * `memory-editor__area` stays in the list: `MemoryEditor.dom.test.tsx` finds the editor through it.
 */
const EDITOR_AREA = cx('memory-editor__area', BODY, TASKS)

/* 14px, the row the frame leaves between the card and the doc's bottom padding. */
const HELP = 'm-0 flex items-center gap-8 text-11-5/14 text-muted-foreground [&_svg]:flex-none'

/* The markdown that will be written, exactly as the file will hold it. */
const SOURCE =
  'memory-editor__source min-h-0 flex-1 overflow-auto bg-transparent px-16 py-14 font-code text-12-5/20 text-code-foreground'

/**
 * The boss writing a page, or rewriting one (frame `V2v4hd`): the reading pane turned into the
 * document itself. The path bar says where the file will land and carries Cancel and Save; the
 * title is edited in the type it will be read in; the front matter is the same two rows the open
 * page draws, as controls; and the body is a markdown editor that previews with the reading
 * pane's own renderer.
 *
 * An existing page keeps its kind and its title, because the title is the file name and renaming
 * a page would be a second page nobody linked to.
 */
export function MemoryEditor({
  page,
  repos,
  onSave,
  onCancel,
}: {
  /** The page being edited, or null for a new one. */
  page: MemoryPage | null
  /** The Company's repo names, so a page can be tied to one without typing it. */
  repos: string[]
  onSave(input: MemoryWrite): void
  onCancel(): void
}) {
  const [kind, setKind] = useState<MemoryKind>(page?.kind ?? 'decision')
  const [title, setTitle] = useState(page?.title ?? '')
  const [body, setBody] = useState(page?.body ?? '')
  const [repo, setRepo] = useState(page?.repos[0] ?? '')
  const [mode, setMode] = useState<Mode>('edit')
  const repoId = useId()
  const ready = title.trim() !== '' && body.trim() !== ''

  return (
    <form
      className={PAGE}
      data-ui="Memory editor"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        onSave({
          kind,
          title: title.trim(),
          body,
          mode: 'replace',
          ...(repo && { repos: [repo] }),
        })
      }}
    >
      <div className={BAR}>
        <span className={PATH}>{page ? pagePath(page) : `memory / ${memoryKindFolder(kind)} / new page`}</span>
        <div className="ml-auto flex items-center gap-6">
          <Button variant="ghost" size="sm" icon={X} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" icon={Check} disabled={!ready}>
            Save page
          </Button>
        </div>
      </div>

      <div className={DOC}>
        {/* The title is the document's own H1, typed in place: a box around it would be a form. */}
        <input
          className={EDITOR_TITLE}
          value={title}
          readOnly={page !== null}
          placeholder="Untitled page"
          aria-label="Title"
          onChange={(event) => setTitle(event.target.value)}
        />

        <dl className={FRONT}>
          <dt>kind</dt>
          <dd>
            <fieldset className="flex flex-wrap gap-6" aria-label="kind">
              {OFFERED.map((one) => {
                const Icon = KIND_ICON[one]
                const on = one === kind
                return (
                  <button
                    key={one}
                    type="button"
                    className={cx(SHELL_BUTTON, on ? KIND_ON : KIND)}
                    aria-pressed={on}
                    disabled={page !== null}
                    onClick={() => setKind(one)}
                  >
                    <Icon size={12} aria-hidden />
                    {MEMORY_KIND_LABEL[one]}
                  </button>
                )
              })}
            </fieldset>
          </dd>
          <dt>
            <label htmlFor={repoId}>repo</label>
          </dt>
          <dd>
            <Select
              id={repoId}
              label={null}
              className={REPO}
              icon={FolderGit2}
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              options={[
                { value: '', label: 'No repo · whole Company' },
                ...repos.map((name) => ({ value: name, label: name })),
              ]}
            />
          </dd>
        </dl>

        <div className={CARD}>
          <div className="flex items-center gap-8 border-border border-b px-8 py-6">
            <SegmentedControl<Mode>
              label="Edit, preview or markdown"
              classes={{ track: MODES, option: MODE, on: MODE_ON, off: MODE }}
              value={mode}
              options={MODE_OPTIONS}
              onChange={setMode}
            />
            <span className={HINT}>Markdown shortcuts as you type</span>
          </div>
          {/* Kept mounted behind the other two, so a look at the preview costs no undo history. */}
          <MarkdownEditor
            className={EDITOR_AREA}
            hidden={mode !== 'edit'}
            value={body}
            placeholder={BODY_PLACEHOLDER}
            label="Page"
            onChange={setBody}
          />
          {mode === 'preview' && (
            /* The reading pane's own renderer, so a preview cannot say a page reads differently. */
            <MarkdownBody
              source={body}
              className={cx(BODY, 'memory-editor__preview min-h-0 flex-1 overflow-auto px-16 py-14')}
            />
          )}
          {mode === 'markdown' && (
            /* The file itself, as it will be committed — read only: the document is where it is written. */
            <section className={SOURCE} aria-label="Markdown source">
              <pre className="m-0 whitespace-pre-wrap">{body}</pre>
            </section>
          )}
        </div>

        <p className={HELP}>
          <GitCommitHorizontal size={13} aria-hidden />
          Saved as a markdown file and one commit by you. Every Employee can read it at once.
        </p>
      </div>

      <footer className={FOOTER}>
        <Plug size={13} aria-hidden />
        <span>
          Employees read and write this through the memory MCP tools. Every edit is a commit — History shows who changed
          what.
        </span>
      </footer>
    </form>
  )
}
