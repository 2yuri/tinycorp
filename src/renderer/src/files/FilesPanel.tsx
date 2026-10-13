import { ChevronDown, FilePlus2, Files as FilesIcon, FolderOpen, SquarePen } from 'lucide-react'
import type { ReactNode } from 'react'
import { type EditorsState, editorLabel } from '../../../shared/files/editors'
import { EDIT_FOOTER } from '../../../shared/files/file-edits'
import { type FilePlace, type OpenedFile, placeLabel } from '../../../shared/files/files'
import { type Defined, type LanguageReading, NOTHING_KNOWN } from '../../../shared/files/language'
import { machineWordsHere } from '../chrome'
import { CodeEditor, type CodeServer } from '../editor'
import { OpenWith } from '../editors'
import { Button, cx, DropdownMenu, EmptyState, MenuItem } from '../ui'
import { ChangesPanel, type ChangesPanelProps, SidebarTabs } from './ChangesPanel'
import { BackToJump, LanguageNotice, Outline, Problems } from './CodeIntel'
import type { SidebarTab } from './changes-model'
import { readOnlyNotice } from './editing-model'
import { EditActions, EditedMark, ReadOnlyNotice, SessionWarning } from './FileEditor'
import { FileTabs } from './FileTabs'
import { FileTree } from './FileTree'
import { crumbsOf, type FileRow, fileChips, pickerPlaces } from './files-model'
import { symbolOn } from './language-model'
import type { FileTab, TabView } from './tabs-model'
import type { Language } from './use-language'
import {
  BODY,
  CHIP,
  CHIP_CHANGE,
  CHIP_PLAIN,
  CRUMB,
  CRUMBS,
  FileViewer,
  FOOT,
  HEAD,
  Truncated,
  VIEWER,
} from './Viewers'

/** The line under the viewer, what the design promises editing does (T122). */
export const FOOTER = EDIT_FOOTER

/** What the viewer says with no file open at all: the boss closed the last tab, or opened none. */
export const NOTHING_OPEN = 'No file open'

/**
 * The left column: the folder, or what git says changed across every place (T160). One object
 * rather than ten loose props, so a caller hands over a sidebar and not a list of parts (T214).
 */
export interface FilesSidebarProps {
  rows: readonly FileRow[]
  /** The row the tree marks: the shown file, when it is one of this place's. */
  activePath: string | null
  query: string
  /** True when the tree stopped short of the whole folder. */
  truncated?: boolean | undefined
  onQuery(query: string): void
  onPick(row: { path: string; kind: 'file' | 'folder' }): void
  /** Which half of the sidebar is showing: the tree, or what git says changed (T160). */
  tab?: SidebarTab | undefined
  /** The count on the Changes tab: changed files across every place, so it matches the rows. */
  changedCount?: number | undefined
  onTab?: ((tab: SidebarTab) => void) | undefined
  /** Everything the Changes list draws and does; left out, only the tree is ever shown. */
  changes?: ChangesPanelProps | undefined
}

/** The right column: the open files as tabs, and the one the viewer is drawing. */
export interface FilesViewerProps {
  /** Every file open, as tabs above the viewer (T121). */
  tabs: readonly FileTab[]
  /** The key of the tab the viewer shows; null when nothing is open. */
  activeKey: string | null
  /** The whole path of a file from outside the Company; null when the shown file is a place's. */
  outsidePath?: string | null | undefined
  /** Null while nothing is open, or while a file is being read. */
  file: OpenedFile | null
  /** The shown tab's own Markdown toggle, image zoom and `Pixel-true`. */
  view: TabView
  /** The line a link asked for (T114): the code viewer scrolls to it and marks it. */
  markedLine?: number | null | undefined
  error?: string | null | undefined
  /** Which editor a file is handed to (T123); the tab header of a file from outside says its name. */
  editors?: EditorsState | undefined
  /** The keys of every tab with unsaved work, which the tabs mark with a dot of their own. */
  dirtyKeys?: readonly string[] | undefined
  onView(change: Partial<TabView>): void
  onPickTab(key: string): void
  onCloseTab(key: string): void
  /** Reveals a file from outside the Company in Finder; the place's own is in the header. */
  onReveal(): void
  /** Opens a file from outside the Company in the boss's editor; the place's own is in the header. */
  onEditOutside?: (() => void) | undefined
}

/** Typing in the file (T122). Left out, the viewer only reads. */
export interface FilesEditingProps {
  /** True when the shown file can be typed into: text, code or Markdown of a place, read whole. */
  editable?: boolean | undefined
  /** What the editor shows: the boss's own text where they have one, else the file as it was read. */
  text?: string | undefined
  /** True while the shown tab has work the disk has not seen. */
  dirty?: boolean | undefined
  /** True while a save is in flight; the buttons wait for it. */
  saving?: boolean | undefined
  onEdit?: ((text: string) => void) | undefined
  onSave?: (() => void) | undefined
  onDiscard?: (() => void) | undefined
}

/** What the language server knows about the file, and where it can take the boss (T115). */
export interface FilesCodeProps {
  /** Without it the editor only colours: no marks, no card, no outline, no list and no line. */
  language?: Language | undefined
  /** The file the boss followed a symbol away from; null when they have not followed one. */
  back?: string | null | undefined
  onBack?: (() => void) | undefined
  /** A line the outline or the problems list was clicked for, which the editor scrolls to. */
  onGoToLine?: ((line: number) => void) | undefined
  /** A declaration was followed: the view is being asked to open it, in its place and on its line. */
  onOpenDefinition?: ((at: Defined) => void) | undefined
}

export interface FilesPanelProps {
  /** The repo or worktree the tree shows, or null when the Company has none and only a tab is open. */
  place: FilePlace | null
  sidebar: FilesSidebarProps
  viewer: FilesViewerProps
  editing?: FilesEditingProps | undefined
  code?: FilesCodeProps | undefined
  /** What the right-hand pane shows while the Changes tab is on: the picked change's diff. */
  diff?: ReactNode | undefined
}

/**
 * The Files view's two columns: the sidebar, and the viewer beside it.
 *
 * `files-places__button` and `files-viewer__reveal` stay in their lists because `FilesView.test.tsx`
 * and the capture harness click them. The viewer's own chrome — head, crumbs, chips, body, foot — is
 * `Viewers.tsx`'s, shared with the Changes diff.
 */
const SIDE =
  'flex w-300 min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar [&>.files-tree]:w-auto [&>.files-tree]:flex-1 [&>.files-tree]:border-r-0'

/*
 * A file from outside: its whole path where the place's crumbs go. Long paths are cut at their start,
 * where the boring part is. `rtl` alone does that but also moves the leading slash to the end —
 * `/Users/yuri/a.png` was drawn as `Users/yuri/a.png/` — so the text keeps its own direction and only
 * the clipping is reversed.
 */
const FULL =
  'files-crumbs__full overflow-hidden text-ellipsis whitespace-nowrap text-left text-foreground [direction:rtl] [unicode-bidi:plaintext]'

const REVEAL =
  'files-viewer__reveal inline-flex shrink-0 cursor-pointer items-center gap-6 rounded-sm border border-border bg-transparent px-8 py-2 font-sans text-11/[normal] text-muted-foreground hover:text-foreground'

const TOGGLE =
  'files-chip--toggle cursor-pointer border border-border bg-transparent text-11/[normal] text-muted-foreground hover:text-foreground'

const CHIP_TONE = {
  plain: CHIP_PLAIN,
  change: CHIP_CHANGE,
} satisfies Record<'plain' | 'change', string>

/* `font: inherit` and `color: inherit` are not translated: `ui/tailwind.css` already gives every button
   both, so the sheet was saying it twice. */
const PLACES_BUTTON =
  'files-places__button inline-flex cursor-pointer items-center gap-4 border-0 bg-transparent p-0 hover:text-foreground'

/* The list stops above the window's foot and scrolls, because the view around it clips (T262). */
const PLACES_MENU =
  'absolute top-[calc(100%+var(--space-2))] left-0 z-20 max-h-[calc(100vh-160px)] min-w-280 overflow-y-auto overscroll-contain'

/*
 * The body, and the row inside it holding the file beside its outline.
 *
 * A rendered document or an image is as tall as it is and the body scrolls it. **Text is not**:
 * Monaco scrolls itself, draws its own overview ruler down the right and needs a box with a real
 * height to measure against, so for text the body stops scrolling and becomes the column the
 * editor fills. `cx` settles the pair — `overflow-hidden` over `overflow-auto`, `min-h-0` over
 * `min-h-full` — rather than two utilities on one property being left to the sheet's own order.
 */
const BODY_TEXT = 'flex flex-col overflow-hidden'

const FILE_ROW = 'flex min-h-full items-start'

const FILE_ROW_TEXT = 'flex min-h-0 flex-1 items-stretch'

/**
 * Everything below the header: the tree on the left, the open files as tabs on the right with the
 * active one under them, and the read-only promise at the foot. Pure — every change goes back out
 * as a callback.
 */
export function FilesPanel({ place, sidebar, viewer, editing: work = {}, code = {}, diff }: FilesPanelProps) {
  const {
    rows,
    activePath,
    query,
    truncated,
    onQuery,
    onPick,
    tab = 'files',
    changedCount = 0,
    onTab,
    changes,
  } = sidebar
  const {
    tabs,
    activeKey,
    outsidePath = null,
    file,
    view,
    markedLine = null,
    error,
    editors,
    dirtyKeys,
    onView,
    onPickTab,
    onCloseTab,
    onReveal,
    onEditOutside,
  } = viewer
  const { editable = false, text = '', dirty = false, saving = false, onEdit, onSave, onDiscard } = work
  const { language, back = null, onBack, onGoToLine, onOpenDefinition } = code
  // Markdown reads as Markdown until the boss asks for its source — and always while it is edited,
  // so nothing they typed can hide behind a rendering of the file as it was.
  const editing = editable && (file?.kind !== 'markdown' || view.source || dirty)
  const notice = readOnlyNotice(file, outsidePath === null ? (place?.id ?? null) : null)
  // Nothing known is what the panel draws for a file nobody asked a server about: no marks, no
  // outline, no list and no line — exactly the viewer as it was before there was a server at all.
  const reading: LanguageReading = language?.reading ?? NOTHING_KNOWN
  // What the file is drawn over, whether the boss is reading it or typing in it: the same marks,
  // the same card, and the same way to the declaration of a symbol (T115).
  const server: CodeServer | undefined =
    language && onOpenDefinition
      ? { hover: language.hover, definition: language.find, open: onOpenDefinition }
      : undefined
  // Text of every kind is the editor's, read-only or not (T222); the rest is drawn by its own
  // viewer. Markdown reads as Markdown until the boss asks for its source, which is also the ask
  // to edit it — nothing they typed may hide behind a rendering of the file as it was.
  const asText =
    file !== null &&
    (file.kind === 'code' || file.kind === 'text' || (file.kind === 'markdown' && (view.source || editing)))
  const showing: SidebarTab = changes === undefined ? 'files' : tab
  return (
    <div className="flex min-h-0 flex-1">
      <div className={SIDE}>
        {/* Two tabs over the sidebar: the folder, and what git says changed in every place. */}
        {changes !== undefined && onTab && <SidebarTabs tab={showing} count={changedCount} onTab={onTab} />}
        {showing === 'changes' && changes !== undefined ? (
          <ChangesPanel {...changes} />
        ) : (
          <FileTree
            rows={rows}
            activePath={activePath}
            query={query}
            onQuery={onQuery}
            onPick={onPick}
            truncated={truncated}
          />
        )}
      </div>
      {showing === 'changes' ? (
        diff
      ) : (
        <section className={VIEWER}>
          <FileTabs tabs={tabs} activeKey={activeKey} dirtyKeys={dirtyKeys} onPick={onPickTab} onClose={onCloseTab} />
          <header className={HEAD}>
            <nav className={CRUMBS} aria-label="Path">
              {/* The way back from a symbol the boss followed (T115), ahead of where it took them. */}
              {back !== null && onBack && <BackToJump path={back} onBack={onBack} />}
              {outsidePath !== null ? (
                // A file nowhere the Company owns has no place to break into crumbs: it shows whole.
                <span className={cx(CRUMB, FULL)} title={outsidePath}>
                  {outsidePath}
                </span>
              ) : activePath === null ? (
                <span className={CRUMB}>{NOTHING_OPEN}</span>
              ) : (
                // Every crumb reads the same: the frame lifts none of them, the last one included.
                crumbsOf(activePath).map((crumb, index) => (
                  <span key={index} className={CRUMB}>
                    {crumb}
                  </span>
                ))
              )}
              {dirty && <EditedMark />}
            </nav>
            <span className="flex shrink-0 items-center gap-8">
              {dirty ? (
                // While there is something to save, the chips step aside for Discard and Save ⌘S.
                <EditActions busy={saving} onDiscard={() => onDiscard?.()} onSave={() => onSave?.()} />
              ) : (
                <>
                  {outsidePath !== null && (
                    <>
                      {editors && onEditOutside && (
                        <button type="button" className={REVEAL} onClick={onEditOutside}>
                          <SquarePen size={12} aria-hidden />
                          {editorLabel(editors)}
                        </button>
                      )}
                      <button type="button" className={REVEAL} onClick={onReveal}>
                        <FolderOpen size={12} aria-hidden />
                        {machineWordsHere().reveal}
                      </button>
                    </>
                  )}
                  {file?.kind === 'markdown' && (
                    <button type="button" className={cx(CHIP, TOGGLE)} onClick={() => onView({ source: !view.source })}>
                      {/* Markdown reads as Markdown; the one click to its source is the click to edit it. */}
                      {view.source ? 'Rendered' : editable ? 'Edit' : 'Source'}
                    </button>
                  )}
                  {file &&
                    fileChips(file, outsidePath === null ? (place?.holderName ?? null) : null).map((chip) => (
                      <span key={chip.text} className={cx(CHIP, CHIP_TONE[chip.tone])}>
                        {chip.text}
                      </span>
                    ))}
                </>
              )}
            </span>
          </header>
          {file !== null && outsidePath === null && place?.sessionRunning && (
            <SessionWarning holderName={place.holderName} />
          )}
          <div className={cx(BODY, asText && BODY_TEXT)}>
            {error && <p className="m-0 p-16 text-13/[normal] text-destructive">{error}</p>}
            {file === null ? (
              <div className="flex flex-1 items-center justify-center p-32">
                <EmptyState
                  icon={FilesIcon}
                  title={NOTHING_OPEN}
                  body="Pick a file on the left, or click a path an Employee wrote: each one opens as a tab of its own."
                />
              </div>
            ) : (
              <>
                <Truncated file={file} />
                {notice && <ReadOnlyNotice notice={notice} />}
                {/* Why the viewer is only highlighting, when the place has no server to read with. */}
                <LanguageNotice reading={reading} />
                <div className={cx(FILE_ROW, asText && FILE_ROW_TEXT)}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    {asText ? (
                      <CodeEditor
                        text={editing ? text : (file.text ?? '')}
                        path={file.path}
                        placeId={outsidePath === null ? (place?.id ?? null) : null}
                        language={file.language}
                        readOnly={!editing}
                        changedLines={file.changedLines}
                        markedLine={markedLine}
                        diagnostics={reading.diagnostics}
                        server={server}
                        onChange={(next) => onEdit?.(next)}
                        onSave={() => onSave?.()}
                      />
                    ) : (
                      <FileViewer file={file} view={view} onView={onView} />
                    )}
                  </div>
                  {reading.outline.length > 0 && (
                    <Outline
                      outline={reading.outline}
                      on={symbolOn(reading.outline, markedLine)}
                      onPick={(line) => onGoToLine?.(line)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
          {/* Under the file and never scrolling away with it: the build break, without a build. */}
          {file !== null && reading.status === 'ready' && (
            <Problems diagnostics={reading.diagnostics} onPick={(line) => onGoToLine?.(line)} />
          )}
          <footer className={FOOT}>{FOOTER}</footer>
        </section>
      )}
    </div>
  )
}

export interface FilesActionsProps {
  disabled?: boolean | undefined
  /** What this Mac has and which editor is in force; the button says that one by name (T123). */
  editors: EditorsState
  /** The file the buttons would hand over, which the system default row of the list describes. */
  path?: string | null | undefined
  /** Whether the `Open with` list is showing. */
  picking: boolean
  /** New file makes one inside the place (T122). */
  onNew?(): void
  onPicking(open: boolean): void
  onEdit(): void
  onChoose(id: string): void
  onReveal(): void
}

/**
 * The header's buttons: New file makes one inside the place (T122), and the other two hand the
 * place, or the file open in it, to the boss's own tools.
 */
export function FilesActions({
  disabled,
  editors,
  path,
  picking,
  onNew,
  onPicking,
  onEdit,
  onChoose,
  onReveal,
}: FilesActionsProps) {
  return (
    <span className="flex items-center gap-8">
      <Button variant="secondary" icon={FilePlus2} disabled={disabled} onClick={() => onNew?.()}>
        New file
      </Button>
      <OpenWith
        editors={editors}
        path={path}
        disabled={disabled}
        open={picking}
        onToggle={onPicking}
        onOpen={onEdit}
        onChoose={onChoose}
      />
      <Button variant="secondary" icon={FolderOpen} disabled={disabled} onClick={onReveal}>
        {machineWordsHere().reveal}
      </Button>
    </span>
  )
}

/** The subtitle names the place, and with more than one it is how you pick another. */
export function Places({
  places,
  place,
  open,
  onToggle,
  onPick,
}: {
  places: readonly FilePlace[]
  place: FilePlace
  open: boolean
  onToggle(open: boolean): void
  onPick(id: string): void
}) {
  const label = placeLabel(place)
  if (places.length < 2) return <>{label}</>
  return (
    <span className="relative inline-flex">
      <button type="button" className={PLACES_BUTTON} aria-expanded={open} onClick={() => onToggle(!open)}>
        {label}
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <DropdownMenu className={PLACES_MENU}>
          {pickerPlaces(places).map((one) => (
            <MenuItem key={one.id} label={placeLabel(one)} onClick={() => onPick(one.id)} />
          ))}
        </DropdownMenu>
      )}
    </span>
  )
}
