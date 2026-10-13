import { ChevronRight, CircleStop, Folder, GitBranch, GitBranchPlus, Loader, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { WALK_DEPTH } from '../../../shared/repos/found-repos'
import { tildePath } from '../paths'
import { Button, Checkbox, RepoMarkIcon } from '../ui'
import { type FoundGroup, type FoundRow, moreLine, scanningLine, selectionLine } from './found-repos-model'
import type { FoundRepos } from './use-found-repos'
import '../ui/tailwind.css'

/*
 * The found-repositories picker's classes (T210c), off frames `UohF8`, `XHkqC` and `DxNcO` (T168).
 * `inModal` is what `.repo-modal__form--found .found*` said: inside the modal the picker and its
 * tree take the height that is left, and outside it the tree stops at 380px.
 */
const PICKER = 'flex min-h-0 flex-col gap-12 font-sans leading-[normal]'
const PICKER_IN_MODAL = 'flex min-h-0 flex-1 flex-col gap-12 font-sans leading-[normal]'
const TOOLBAR = 'flex shrink-0 items-center gap-16'
const FILTER =
  'flex h-38 min-w-0 flex-1 items-center gap-8 rounded-sm border border-input bg-card px-12 text-muted-foreground focus-within:border-ring'
const FILTER_INPUT =
  'min-w-0 flex-1 border-none bg-transparent font-sans text-foreground text-13/[normal] outline-none placeholder:text-muted-foreground'
const SLASH = 'rounded-[4px] border border-border px-6 py-1 font-code text-muted-foreground text-10-5/[normal]'
const PICK =
  'm-0 flex shrink-0 cursor-pointer items-center gap-6 border-none bg-transparent p-0 font-sans text-soft-ink text-12-5/[normal] font-medium [&:hover:not(:disabled)]:text-foreground disabled:cursor-default disabled:opacity-45'
const STOP =
  'm-0 flex shrink-0 cursor-pointer items-center gap-6 border-none bg-transparent p-0 font-sans text-soft-ink text-12-5/[normal] font-medium hover:text-foreground'
const COUNT = 'shrink-0 text-muted-foreground text-12/[normal]'
const TREE = 'flex max-h-380 min-h-0 flex-col gap-2 overflow-y-auto rounded-sm border border-border bg-muted p-12'
const TREE_IN_MODAL = 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-sm border border-border bg-muted p-12'
const LABEL = 'px-4 pt-8 pb-4 text-muted-foreground text-10-5/[normal] font-semibold tracking-[0.06em] first:pt-0'
const ROW = 'flex min-w-0 items-center gap-10 rounded-sm px-6 py-5 text-foreground hover:bg-secondary'
/* A row that cannot be picked: its name and its folder go quiet, the rest of it does not. */
const ROW_MUTED =
  'flex min-w-0 items-center gap-10 rounded-sm px-6 py-5 text-foreground hover:bg-secondary [&_[data-name]]:text-muted-foreground [&_[data-where]]:text-muted-foreground'
const ROW_SELF =
  'mb-4 flex min-w-0 items-center gap-12 rounded-sm border border-border bg-card px-12 py-11 text-foreground'
const ROW_GROUP = 'flex min-w-0 items-center gap-8 rounded-sm px-6 py-5 text-foreground hover:bg-secondary'
const SELF_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const NO_CHECK = 'block w-18 shrink-0'
const ICON = 'flex shrink-0 items-center text-muted-foreground'
const NAME =
  'overflow-hidden text-ellipsis whitespace-nowrap font-code text-heading-ink text-12-5/[normal] font-semibold'
const WHERE = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-muted-foreground text-11/[normal]'
/* In the row that is the picked folder itself, the line under the name is prose, not a path. */
const WHERE_SELF = 'overflow-hidden text-ellipsis whitespace-nowrap font-sans text-muted-foreground text-11/[normal]'
const SPACER = 'min-w-8 flex-1'
const REMOTE = 'shrink-0 font-code text-muted-foreground text-11/[normal]'
const BRANCH =
  'flex shrink-0 items-center gap-4 rounded-full border border-border px-7 py-2 font-code text-soft-ink text-10-5/[normal]'
const ADDED =
  'flex shrink-0 items-center gap-5 rounded-full bg-secondary px-9 py-2 text-soft-ink text-10-5/[normal] font-medium before:h-5 before:w-5 before:rounded-full before:bg-muted-foreground before:content-[""]'
const NOT_OFFERED = 'shrink-0 text-muted-foreground text-11/[normal]'
const GROUP = 'flex flex-col'
const CHEVRON =
  'flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-muted-foreground transition-transform duration-120 ease-[ease]'
const CHEVRON_OPEN =
  'flex h-16 w-16 shrink-0 rotate-90 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-muted-foreground transition-transform duration-120 ease-[ease]'
/* The kit's Choice, with its label off: in a row the box is the whole control. */
const CHECK = 'gap-0 [&_[data-slot=choice-label]]:hidden'
const GROUP_NAME = 'font-code text-heading-ink text-12-5/[normal] font-semibold'
const BADGE = 'rounded-full bg-secondary px-8 py-1 text-soft-ink text-10-5/[normal] font-semibold'
const GROUP_LINE = 'shrink-0 text-muted-foreground text-11-5/[normal]'
const CHILDREN = 'flex flex-col gap-2 pl-22'
const MORE =
  'm-0 cursor-pointer self-start border-none bg-transparent px-6 py-4 font-sans text-muted-foreground text-11-5/[normal] hover:text-soft-ink'
const NOTE = 'mt-6 mr-0 mb-0 ml-0 flex items-center gap-8 px-6 text-muted-foreground text-11-5/[normal]'
const SPINNER = 'animate-spin'
const ERROR = 'm-0 text-destructive text-12/[normal]'
const EMPTY =
  'flex flex-1 flex-col items-center justify-center gap-8 rounded-sm border border-border bg-muted px-24 py-40 text-center'
const EMPTY_TILE =
  'mb-6 flex h-44 w-44 items-center justify-center rounded-sm border border-border bg-card text-soft-ink'
const EMPTY_TITLE = 'm-0 text-foreground text-14/[normal] font-semibold'
const EMPTY_SUB = 'm-0 font-code text-muted-foreground text-11-5/[normal]'
const EMPTY_ACTIONS = 'mt-10 flex items-center gap-16'

/**
 * How many rows a group folder draws before it sums up the rest. The frame's `payments/` shows five
 * — three repos and two worktrees — then `+ 4 more worktrees · 62 more repositories`, which is also
 * what keeps a folder of 110 repos to a few dozen nodes with no list virtualisation anywhere.
 */
export const GROUP_PREVIEW = 5

/**
 * The repositories found inside a folder, as a tree the boss ticks (frame `UohF8`, T168): the repos
 * at the top of the folder first, then one node per group folder with its own tri-state box. A repo
 * this Company already has is shown and cannot be ticked, and neither can a worktree or a submodule
 * — both are somebody else's checkout of a history that is already on offer.
 */
export function FoundReposPicker(props: {
  state: FoundRepos
  /** Which group folder starts open; the first one by default. */
  openGroup?: string
  /** Where the boss picks another folder, when there is one to pick. */
  onChangeFolder?: (() => void) | undefined
  /** Where an empty folder goes: New repository (T144), with this folder filled in. */
  onStartHere?: ((folder: string) => void) | undefined
  /**
   * Whether the picker is inside the Add repository modal. In it the picker, its tree and its
   * empty state take the height that is left; outside it the tree stops at its own 380px, because
   * it sits under the step's own cards.
   */
  inModal?: boolean
}) {
  const { state } = props
  const { tree, counts } = state
  const [open, setOpen] = useState<Set<string>>(new Set(props.openGroup ? [props.openGroup] : []))
  const [whole, setWhole] = useState<Set<string>>(new Set())
  const [touched, setTouched] = useState(false)

  // Until the boss opens one, the first group folder is the open one.
  const opened = touched || props.openGroup ? open : new Set(tree.groups.slice(0, 1).map((group) => group.key))
  // A filter is a search: everything that survives it is open, because that is what was asked for.
  const filtering = state.filter.trim() !== ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: the contents of the two sets are what matter, not the identity they get every render.
  const visible = useMemo(() => {
    const rows = [tree.self, ...tree.top].filter((row): row is FoundRow => row !== null)
    for (const group of tree.groups) {
      if (!filtering && !opened.has(group.key)) continue
      rows.push(...(whole.has(group.key) ? group.rows : group.rows.slice(0, GROUP_PREVIEW)))
    }
    return rows.map((row) => row.path)
    // `opened` and `whole` are rebuilt on every render; their contents are what matters.
  }, [tree, filtering, [...opened].join(), [...whole].join()])

  const { seen } = state
  // biome-ignore lint/correctness/useExhaustiveDependencies: the paths are what the engine is told about, not the identity of the array holding them.
  useEffect(() => {
    seen(visible)
  }, [seen, visible.join()])

  const empty = !state.scanning && counts.repos === 0 && counts.worktrees === 0

  return (
    <div className={props.inModal ? PICKER_IN_MODAL : PICKER}>
      {!empty && (
        <div className={TOOLBAR}>
          <span className={FILTER}>
            <Search size={14} aria-hidden />
            <input
              className={FILTER_INPUT}
              data-filter-input
              value={state.filter}
              placeholder="Filter by name or path"
              aria-label="Filter by name or path"
              spellCheck={false}
              onChange={(event) => state.setFilter(event.target.value)}
            />
            <span className={SLASH} aria-hidden>
              /
            </span>
          </span>
          {state.scanning ? (
            <button type="button" className={STOP} data-stop onClick={state.stop}>
              <CircleStop size={13} aria-hidden />
              Stop
            </button>
          ) : (
            <>
              <button type="button" className={PICK} onClick={state.selectAll} disabled={counts.offered === 0}>
                Select all
              </button>
              <button type="button" className={PICK} onClick={state.clear} disabled={counts.selected === 0}>
                None
              </button>
            </>
          )}
          <span className={COUNT}>{state.scanning ? scanningLine(state.total) : selectionLine(counts)}</span>
        </div>
      )}

      {state.error && (
        <p className={ERROR} role="alert">
          {state.error}
        </p>
      )}

      {empty ? (
        <EmptyFolder folder={state.folder} onChangeFolder={props.onChangeFolder} onStartHere={props.onStartHere} />
      ) : (
        // Not a tree: the rows under it are plain rows with a tick, so it is a named region.
        <section className={props.inModal ? TREE_IN_MODAL : TREE} aria-label="Found repositories">
          {tree.self && <SelfRow row={tree.self} folder={state.folder ?? tree.self.path} state={state} />}
          {tree.top.length > 0 && (
            <>
              <span className={LABEL}>TOP LEVEL · {tree.top.length}</span>
              {tree.top.map((row) => (
                <Row key={row.path} row={row} state={state} />
              ))}
            </>
          )}
          {tree.groups.length > 0 && (
            <>
              <span className={LABEL}>
                IN GROUP FOLDERS · {tree.groups.reduce((sum, group) => sum + group.count, 0)}
              </span>
              {tree.groups.map((group) => (
                <Group
                  key={group.key}
                  group={group}
                  state={state}
                  open={filtering || opened.has(group.key)}
                  whole={whole.has(group.key)}
                  onOpen={() => {
                    setTouched(true)
                    setOpen(toggled(opened, group.key))
                  }}
                  onWhole={() => setWhole(toggled(whole, group.key))}
                />
              ))}
            </>
          )}
          {state.scanning && (
            <p className={NOTE} role="status">
              <Loader size={13} aria-hidden className={SPINNER} />
              {state.at ? `${scanningLine(state.total)} · ${state.at}` : scanningLine(state.total)}
            </p>
          )}
          {state.walk?.stopped === 'timed-out' && (
            <p className={NOTE} role="status">
              The scan stopped after 15 seconds. These are the repositories it had found by then.
            </p>
          )}
          {state.walk?.stopped === 'cancelled' && (
            <p className={NOTE} role="status">
              You stopped the scan. These are the repositories it had found.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

/** The picked folder, when it is a checkout too: its own row, above what is inside it. */
function SelfRow(props: { row: FoundRow; folder: string; state: FoundRepos }) {
  const { row, state } = props
  return (
    <div className={ROW_SELF} data-found-row>
      <Tick row={row} state={state} />
      <span className={ICON}>
        <Folder size={16} aria-hidden />
      </span>
      <span className={SELF_TEXT}>
        <span className={NAME} data-name>
          {tildePath(props.folder)}
        </span>
        <span className={WHERE_SELF} data-where>
          This folder is a repository too
        </span>
        {row.remote && <span className={REMOTE}>{row.remote}</span>}
      </span>
      <Marks row={row} />
    </div>
  )
}

function Group(props: {
  group: FoundGroup
  state: FoundRepos
  open: boolean
  whole: boolean
  onOpen(): void
  onWhole(): void
}) {
  const { group, state } = props
  const shown = props.whole ? group.rows : group.rows.slice(0, GROUP_PREVIEW)
  const hidden = group.rows.slice(shown.length)
  return (
    <div className={GROUP}>
      <div className={ROW_GROUP}>
        <button
          type="button"
          className={props.open ? CHEVRON_OPEN : CHEVRON}
          aria-label={`${props.open ? 'Collapse' : 'Expand'} ${group.label}`}
          aria-expanded={props.open}
          onClick={props.onOpen}
        >
          <ChevronRight size={14} aria-hidden />
        </button>
        <Checkbox
          label=""
          className={CHECK}
          aria-label={`Select every repository in ${group.label}`}
          checked={group.checked === 'all'}
          mixed={group.checked === 'some'}
          disabled={group.offered === 0}
          onChange={(event) => state.toggle(group.rows, event.target.checked)}
        />
        <span className={ICON}>
          <Folder size={16} aria-hidden />
        </span>
        <span className={GROUP_NAME}>{group.label}</span>
        <span className={BADGE}>{group.count}</span>
        <span className={SPACER} />
        <span className={GROUP_LINE}>{group.line}</span>
      </div>
      {props.open && (
        <div className={CHILDREN}>
          {shown.map((row) => (
            <Row key={row.path} row={row} state={state} />
          ))}
          {hidden.length > 0 && (
            <button type="button" className={MORE} onClick={props.onWhole}>
              <span aria-hidden>···</span> + {moreLine(hidden)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Row(props: { row: FoundRow; state: FoundRepos }) {
  const { row } = props
  return (
    <div className={row.offered ? ROW : ROW_MUTED} data-found-row title={row.path}>
      <Tick row={row} state={props.state} />
      <span className={ICON}>
        <RepoMarkIcon size={15} aria-hidden />
      </span>
      <span className={NAME} data-name>
        {row.name}
      </span>
      <span className={WHERE} data-where>
        {row.where}
      </span>
      <span className={SPACER} />
      <Marks row={row} />
    </div>
  )
}

/** The checkbox, or the space where one would be for a row that is not on offer. */
function Tick(props: { row: FoundRow; state: FoundRepos }) {
  const { row } = props
  if (row.kind !== 'repo') return <span className={NO_CHECK} aria-hidden />
  return (
    <Checkbox
      label=""
      className={CHECK}
      aria-label={`Add ${row.name}`}
      checked={props.state.selected.has(row.path)}
      disabled={!row.offered}
      onChange={(event) => props.state.toggle([row], event.target.checked)}
    />
  )
}

/** What is known about the row: why it is not offered, or its origin and default branch. */
function Marks(props: { row: FoundRow }) {
  const { row } = props
  if (row.note) return <span className={NOT_OFFERED}>{row.note}</span>
  return (
    <>
      {row.added && <span className={ADDED}>Already added</span>}
      {row.remote && <span className={REMOTE}>{row.remote}</span>}
      {row.branch && (
        <span className={BRANCH}>
          <GitBranch size={11} aria-hidden />
          {row.branch}
        </span>
      )}
    </>
  )
}

/** Nothing inside the folder. The way out is the one the boss already knows: start a repo here. */
function EmptyFolder(props: {
  folder: string | null
  onChangeFolder?: (() => void) | undefined
  onStartHere?: ((folder: string) => void) | undefined
}) {
  return (
    <div className={EMPTY}>
      <span className={EMPTY_TILE}>
        <RepoMarkIcon size={20} aria-hidden />
      </span>
      <p className={EMPTY_TITLE}>No repositories inside this folder — start one here?</p>
      <p className={EMPTY_SUB}>
        {props.folder ? `${tildePath(props.folder)} · ` : ''}looked {WALK_DEPTH} levels deep
      </p>
      <div className={EMPTY_ACTIONS}>
        {props.onChangeFolder && (
          <button type="button" className={PICK} onClick={props.onChangeFolder}>
            Pick another folder
          </button>
        )}
        {props.folder && props.onStartHere && (
          <Button type="button" icon={GitBranchPlus} onClick={() => props.onStartHere?.(props.folder!)}>
            Start a repository here
          </Button>
        )}
      </div>
    </div>
  )
}

function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(key)) next.add(key)
  return next
}
