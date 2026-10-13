import type { LucideIcon } from 'lucide-react'
import { Folder, FolderOpen } from 'lucide-react'
import { type Ref, useEffect, useRef } from 'react'
import type { FileChange } from '../../../shared/files/files'
import { cx, Search } from '../ui'
import { fileIconFor } from './file-icons'
import { changeMark, type FileRow } from './files-model'

export interface FileTreeProps {
  rows: readonly FileRow[]
  /** The file the viewer is showing. */
  activePath: string | null
  query: string
  onQuery(query: string): void
  onPick(row: FileRow): void
  /** True when the walk stopped short of the whole folder. */
  truncated?: boolean | undefined
}

/**
 * The tree on the left of the Files view.
 *
 * `files-tree` stays in its list because the Changes sidebar reaches it from outside — inside
 * `.files-side` the tree drops its own width and divider and fills what is left, which is the
 * parent's decision and cannot be a utility on this element.
 */
const TREE = 'files-tree flex w-300 min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar'

const EMPTY = 'm-0 px-16 py-12 text-12/[normal]'

/* `files-row` and its modifier lead the list, adjacent: `FilesView.test.tsx` asserts the pair
   `files-row files-row--on` as one string. */
const ROW =
  'flex h-28 w-full cursor-pointer items-center gap-8 border-0 bg-transparent pr-12 text-left text-13/[normal] text-sidebar-foreground hover:bg-[color-mix(in_srgb,var(--sidebar-accent)_60%,transparent)]'

const MARK = 'files-row__mark shrink-0 font-code font-semibold text-11/[normal]'

const MARK_TONE = {
  added: 'text-brand-success',
  modified: 'text-brand-warning',
  removed: 'text-brand-danger',
} satisfies Record<FileChange, string>

/** The panel on the left: a find box over the folder, and the tree under it. */
export function FileTree({ rows, activePath, query, onQuery, onPick, truncated }: FileTreeProps) {
  const chosen = useRef<HTMLButtonElement>(null)
  // A tree this deep buries the open file; the panel scrolls to it rather than making the boss hunt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the open file or the rows changing is what scrolls; the effect reads the ref.
  useEffect(() => {
    // Not an expression body: Chromium's `scrollIntoView` answers with a promise, and React takes
    // whatever an effect returns for its clean-up — a promise there throws `destroy is not a
    // function` when the view unmounts, and the screen goes blank with it.
    chosen.current?.scrollIntoView({ block: 'center' })
  }, [activePath, rows])
  return (
    <aside className={TREE} data-ui="File tree">
      <div className="shrink-0 p-12">
        <Search
          tone="filled"
          placeholder="Find a file"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label="Find a file"
        />
      </div>
      <div className="flex-1 overflow-auto pt-0 pr-0 pb-16 pl-0" role="tree" aria-label="Files">
        {rows.map((row) => (
          <Row
            key={row.path}
            row={row}
            active={row.path === activePath}
            onPick={onPick}
            ref={row.path === activePath ? chosen : undefined}
          />
        ))}
      </div>
      {rows.length === 0 && (
        <p className={cx(EMPTY, 'text-muted-foreground')}>
          {query ? 'No file has that in its name.' : 'This folder is empty.'}
        </p>
      )}
      {truncated && (
        <p className={cx(EMPTY, 'text-muted-foreground')}>
          This folder is too big to list whole; some of it is left out.
        </p>
      )}
    </aside>
  )
}

function Row({
  row,
  active,
  onPick,
  ref,
}: {
  row: FileRow
  active: boolean
  onPick(row: FileRow): void
  ref?: Ref<HTMLButtonElement> | undefined
}) {
  const Icon = iconFor(row)
  const mark = changeMark(row.change)
  return (
    <div>
      <button
        ref={ref}
        type="button"
        role="treeitem"
        aria-selected={active}
        aria-expanded={row.kind === 'folder' ? row.open : undefined}
        className={cx('files-row', active && 'files-row--on', ROW)}
        style={{ paddingLeft: 12 + row.depth * 14 }}
        onClick={() => onPick(row)}
      >
        <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{row.label}</span>
        {mark && row.change !== null && (
          <span
            className={cx(MARK, MARK_TONE[row.change], `files-row__mark--${row.change}`)}
            title={`${row.change} in this worktree`}
          >
            {mark}
          </span>
        )}
      </button>
    </div>
  )
}

/** What a row is drawn with: an open or shut folder, and for a file the kind it will open as. */
function iconFor(row: FileRow): LucideIcon {
  if (row.kind === 'folder') return row.open ? FolderOpen : Folder
  return fileIconFor(row.path)
}
