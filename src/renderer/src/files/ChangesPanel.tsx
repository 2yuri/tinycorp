import { ArrowUp, Check, ChevronDown, ChevronRight, Minus, Plus, Undo2 } from 'lucide-react'
import { useState } from 'react'
import {
  CHANGE_MARKS,
  type ChangeGroup,
  type ChangeMark,
  CONFLICTED_NOTE,
  commitLabel,
  commitPlaceholder,
  hasCommitBox,
  NOTHING_CHANGED,
  pushLabel,
} from '../../../shared/files/file-changes'
import { commitWarning } from '../../../shared/files/file-edits'
import { hostPlatform } from '../chrome'
import { cx } from '../ui'
import {
  type ChangePick,
  type ChangeRow,
  changeRows,
  groupStaged,
  isCommitKey,
  isOpen,
  type SidebarTab,
} from './changes-model'
import { SessionWarning } from './FileEditor'
import { CHANGES_EMPTY } from './Viewers'

/**
 * The Changes tab (frame `LFdty`): two tabs over the sidebar, and under Changes one group per place
 * — the Employee and the ticket on the first line, the repo and the branch under it in mono, the
 * changed files below. The commit box belongs to a group, because there is no "the" working tree.
 *
 * `files-side-tab`, `files-change__open` and the `files-change__mark--` modifiers stay in their
 * lists: `ChangesPanel.test.tsx`, `FilesView.test.tsx` and the capture harness read all three.
 */
const SIDE_TABS = 'flex h-44 shrink-0 items-stretch border-b border-border px-12'

const SIDE_TAB =
  'files-side-tab inline-flex cursor-pointer items-center gap-8 border-0 border-b-2 border-b-transparent bg-transparent px-12 py-0 font-sans text-13/[normal] text-muted-foreground hover:text-foreground'

const SIDE_TAB_ON =
  'files-side-tab inline-flex cursor-pointer items-center gap-8 border-0 border-b-2 border-b-primary bg-transparent px-12 py-0 font-sans font-semibold text-13/[normal] text-foreground'

const TAB_COUNT =
  'inline-flex h-20 min-w-20 items-center justify-center rounded-full bg-primary px-6 font-semibold text-11/[normal] text-primary-foreground'

/* One group per place: the grouping is not invented, it is the place. */
const GROUP_HEAD =
  'flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent py-0 pr-12 pl-8 text-left text-sidebar-foreground [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

const GROUP_WHERE =
  'mt-2 mr-0 mb-8 ml-0 overflow-hidden pr-12 pl-16 font-code text-11-5/[normal] text-ellipsis whitespace-nowrap text-muted-foreground'

const TRUNCATED = 'm-0 py-4 pr-16 pl-34 text-11-5/[normal] text-brand-warning'

const CHANGE = 'flex h-28 items-center gap-8 pr-12 hover:bg-[color-mix(in_srgb,var(--sidebar-accent)_60%,transparent)]'

const OPEN =
  'files-change__open flex h-full min-w-0 flex-1 cursor-pointer items-baseline gap-8 border-0 bg-transparent pl-30 text-left font-sans text-13/[normal] text-sidebar-foreground'

/* The name keeps the row; the folder after it is what gives way when there is no space. A file the
   index already holds is what Commit would take, so the row says so quietly. */
const NAME = 'shrink grow-0 basis-auto overflow-hidden text-ellipsis whitespace-nowrap'

const DIR =
  'min-w-0 shrink-[1000] grow-0 basis-auto overflow-hidden text-11/[normal] text-ellipsis whitespace-nowrap text-muted-foreground'

const MARK = 'w-10 shrink-0 text-center font-code font-semibold text-11/[normal]'

const MARK_TONE = {
  added: 'text-brand-success',
  modified: 'text-brand-warning',
  removed: 'text-brand-danger',
  renamed: 'text-primary',
} satisfies Record<ChangeMark, string>

const ACTION =
  'flex size-20 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:not-disabled:bg-[color-mix(in_srgb,var(--sidebar-accent)_90%,transparent)] hover:not-disabled:text-foreground disabled:cursor-default disabled:opacity-35'

/*
 * The commit box of one place. VS Code has one because it has one repository; here `Commit 2 staged`
 * means those two, in that worktree, on that branch.
 */
const MESSAGE =
  'block min-h-52 w-full resize-y rounded-md border border-border bg-input px-12 py-8 font-sans text-13/[normal] text-foreground placeholder:text-muted-foreground'

const COMMIT_BUTTON =
  'inline-flex h-35 cursor-pointer items-center justify-center gap-8 rounded-md border-0 px-12 py-0 font-sans font-semibold text-13/[normal] disabled:cursor-default disabled:opacity-50'

/** The two tabs over the Files sidebar: the tree, and what git says changed, with its count. */
export function SidebarTabs({ tab, count, onTab }: { tab: SidebarTab; count: number; onTab(tab: SidebarTab): void }) {
  return (
    <div className={SIDE_TABS} role="tablist" aria-label="Files and changes">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'files'}
        className={tab === 'files' ? SIDE_TAB_ON : SIDE_TAB}
        onClick={() => onTab('files')}
      >
        Files
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'changes'}
        className={tab === 'changes' ? SIDE_TAB_ON : SIDE_TAB}
        onClick={() => onTab('changes')}
      >
        Changes
        {count > 0 && <span className={TAB_COUNT}>{count}</span>}
      </button>
    </div>
  )
}

export interface ChangesPanelProps {
  groups: readonly ChangeGroup[]
  /** The change the diff pane is showing; its row is the one marked. */
  pick: ChangePick | null
  /** The places the boss folded away, by place id. */
  collapsed: ReadonlySet<string>
  /** The place an action is in flight for; its group's buttons wait for it. */
  busy: string | null
  error: string | null
  onToggle(placeId: string): void
  onPick(pick: ChangePick): void
  onStage(placeId: string, path: string): void
  onUnstage(placeId: string, path: string): void
  onDiscard(placeId: string, row: ChangeRow): void
  onCommit(placeId: string, message: string): void
  onPush(placeId: string): void
}

/**
 * The Changes tab (frame `LFdty`): one group per place, the Employee and the ticket on the first
 * line, the repo and the branch under it in mono, and the changed files below with their marks.
 * The Company's own repos are the last groups, with no holder.
 */
export function ChangesPanel({
  groups,
  pick,
  collapsed,
  busy,
  error,
  onToggle,
  onPick,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  onPush,
}: ChangesPanelProps) {
  return (
    <aside className="min-h-0 flex-1 overflow-auto pb-16" aria-label="Changes">
      {error && <p className="m-0 p-16 text-12/[normal] text-destructive">{error}</p>}
      {groups.length === 0 && <p className={CHANGES_EMPTY}>{NOTHING_CHANGED}</p>}
      {groups.map((group) => (
        <Group
          key={group.place.id}
          group={group}
          pick={pick}
          open={isOpen(collapsed, group.place.id)}
          busy={busy === group.place.id}
          onToggle={onToggle}
          onPick={onPick}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
          onCommit={onCommit}
          onPush={onPush}
        />
      ))}
    </aside>
  )
}

function Group({
  group,
  pick,
  open,
  busy,
  onToggle,
  onPick,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  onPush,
}: {
  group: ChangeGroup
  pick: ChangePick | null
  open: boolean
  busy: boolean
} & Pick<ChangesPanelProps, 'onToggle' | 'onPick' | 'onStage' | 'onUnstage' | 'onDiscard' | 'onCommit' | 'onPush'>) {
  const { place, changes } = group
  const rows = changeRows(changes.files)
  const staged = groupStaged(group)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section className="pt-12" data-ui="Change group">
      <button type="button" className={GROUP_HEAD} aria-expanded={open} onClick={() => onToggle(place.id)}>
        <Chevron size={14} aria-hidden />
        <strong className="font-bold text-13-5/[normal] text-foreground">{group.name}</strong>
        {group.ticketKey && (
          <span className="files-group__key font-code text-12/[normal] text-primary">{group.ticketKey}</span>
        )}
        <span className="flex-1" />
        <span className="text-12/[normal] text-muted-foreground">{changes.files.length}</span>
      </button>
      <p className={GROUP_WHERE}>{group.where}</p>
      {open && (
        <>
          <ul className="m-0 list-none p-0">
            {rows.map((row) => (
              <ChangeRowItem
                key={row.path}
                row={row}
                on={pick?.placeId === place.id && pick.path === row.path}
                busy={busy}
                onPick={() => onPick({ placeId: place.id, path: row.path })}
                onStage={() => onStage(place.id, row.path)}
                onUnstage={() => onUnstage(place.id, row.path)}
                onDiscard={() => onDiscard(place.id, row)}
              />
            ))}
          </ul>
          {changes.truncated && <p className={TRUNCATED}>Showing the first {rows.length}; there are more.</p>}
          {/* The same warning the file editor gives for the same hazard, one step further on. */}
          {place.sessionRunning && (
            <SessionWarning holderName={place.holderName} text={commitWarning(place.holderName)} />
          )}
          {hasCommitBox(changes) && (
            <CommitBox
              staged={staged}
              push={pushLabel(changes)}
              busy={busy}
              onCommit={(message) => onCommit(place.id, message)}
              onPush={() => onPush(place.id)}
            />
          )}
        </>
      )}
    </section>
  )
}

function ChangeRowItem({
  row,
  on,
  busy,
  onPick,
  onStage,
  onUnstage,
  onDiscard,
}: {
  row: ChangeRow
  on: boolean
  busy: boolean
  onPick(): void
  onStage(): void
  onUnstage(): void
  onDiscard(): void
}) {
  return (
    <li className={cx(CHANGE, on && 'bg-sidebar-accent')}>
      <button type="button" className={OPEN} aria-current={on ? 'true' : undefined} onClick={onPick}>
        <span className={cx(NAME, row.staged && 'font-semibold text-foreground')}>{row.name}</span>
        {row.dir && <span className={DIR}>{row.dir}</span>}
      </button>
      <span
        className={cx(MARK, MARK_TONE[row.mark], `files-change__mark--${row.mark}`)}
        title={row.conflicted ? CONFLICTED_NOTE : undefined}
      >
        {row.conflicted ? '!' : CHANGE_MARKS[row.mark]}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className={ACTION}
          disabled={busy}
          aria-label={`Discard the changes in ${row.path}`}
          title="Discard"
          onClick={onDiscard}
        >
          <Undo2 size={13} aria-hidden />
        </button>
        {row.staged ? (
          <button
            type="button"
            className={ACTION}
            disabled={busy}
            aria-label={`Unstage ${row.path}`}
            title="Unstage"
            onClick={onUnstage}
          >
            <Minus size={13} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className={ACTION}
            disabled={busy || row.conflicted}
            aria-label={`Stage ${row.path}`}
            title={row.conflicted ? CONFLICTED_NOTE : 'Stage'}
            onClick={onStage}
          >
            <Plus size={13} aria-hidden />
          </button>
        )}
      </span>
    </li>
  )
}

/**
 * The commit box of one place. VS Code has one because it has one repository; here a ticket gets a
 * worktree per repo, so `Commit 2 staged` means *those two, in that worktree, on that branch*.
 */
function CommitBox({
  staged,
  push,
  busy,
  onCommit,
  onPush,
}: {
  staged: number
  push: string
  busy: boolean
  onCommit(message: string): void
  onPush(): void
}) {
  const [message, setMessage] = useState('')
  function commit(): void {
    if (staged === 0 || !message.trim()) return
    onCommit(message.trim())
    setMessage('')
  }
  return (
    <div className="px-16 pt-12 pb-16">
      <textarea
        className={MESSAGE}
        rows={2}
        value={message}
        placeholder={commitPlaceholder(hostPlatform())}
        aria-label={commitPlaceholder(hostPlatform())}
        disabled={busy}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (!isCommitKey(event)) return
          event.preventDefault()
          commit()
        }}
      />
      <div className="mt-12 flex gap-8">
        <button
          type="button"
          className={cx(COMMIT_BUTTON, 'flex-1 bg-primary text-primary-foreground')}
          disabled={busy || staged === 0 || !message.trim()}
          onClick={commit}
        >
          <Check size={15} aria-hidden />
          {commitLabel(staged)}
        </button>
        <button
          type="button"
          className={cx(COMMIT_BUTTON, 'bg-secondary text-secondary-foreground')}
          disabled={busy}
          onClick={onPush}
        >
          <ArrowUp size={15} aria-hidden />
          {push}
        </button>
      </div>
    </div>
  )
}
