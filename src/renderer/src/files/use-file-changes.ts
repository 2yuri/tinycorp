/**
 * The Changes tab and the diff beside it (T160): what git says per place, the change the diff pane
 * is on, the groups the boss folded away, and the ticket's line comments over a worktree's diff.
 *
 * It is the one half of the Files view that never touches a tab: the sidebar's other tab, the
 * viewer's other pane, and the commit box. The view hands it the places and tells it when the
 * engine says the list is stale; everything else is its own.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type ChangedFileDiff,
  changeGroups,
  changedCount as countChanged,
  type PlaceChanges,
} from '../../../shared/files/file-changes'
import type { FilePlace } from '../../../shared/files/files'
import type { ReviewComment } from '../../../shared/review/review-diff'
import { useDiffControls } from '../editor'
import { resources, useIpcResource } from '../ipc'
import type { ChangeDiffProps } from './ChangeDiff'
import type { ChangesPanelProps } from './ChangesPanel'
import { type ChangePick, type ChangeRow, stillThere, toggleGroup } from './changes-model'

const api = window.tinyCorp.files

/** What a discard would throw away, while the boss is being asked whether to. */
export interface Discarding {
  placeId: string
  /** Every path it touches: for a rename, both the name it has and the one it had. */
  paths: string[]
  /** True where the place is a ticket worktree, so a restore point can put it back (T118). */
  restorable: boolean
}

export interface FileChanges {
  /** The count on the Changes tab: changed files across every place, so it matches the rows. */
  changedCount: number
  /** Everything the Changes list draws and does. */
  panel: ChangesPanelProps
  /** Everything the diff pane draws. */
  diff: ChangeDiffProps
  /** What the boss is being asked to throw away, or null while nothing is being asked. */
  discarding: Discarding | null
  /** True while a stage, unstage, commit, push or discard is in flight. */
  acting: boolean
  onCancelDiscard(): void
  onDiscard(): void
  /** Ask the engine again — the view calls it on the `files:changed` it already listens for. */
  reload(): Promise<void>
}

/**
 * What git says, per place. It runs on the events the app already has — the same `files:changed` a
 * Session's hook, a worktree created, a ticket moved and the boss's own save each raise — and never
 * on a render or a timer. The engine caches it; this only asks.
 */
export function useFileChanges(places: readonly FilePlace[]): FileChanges {
  const [changes, setChanges] = useState<PlaceChanges[]>([])
  const [change, setChange] = useState<ChangePick | null>(null)
  const [diff, setDiff] = useState<ChangedFileDiff | null>(null)
  const [readingDiff, setReadingDiff] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [acting, setActing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState<Discarding | null>(null)
  const [commentOn, setCommentOn] = useState<number | null>(null)

  const groups = useMemo(() => changeGroups(places, changes), [places, changes])
  const changedCount = useMemo(() => countChanged(groups), [groups])
  const pick = useMemo(() => stillThere(change, groups), [change, groups])
  const place = pick === null ? null : (places.find((one) => one.id === pick.placeId) ?? null)
  const { comments, bossName, add } = useDiffComments(place)
  const employees = useIpcResource(resources.employees)
  const controls = useDiffControls()

  const reload = useCallback(async () => {
    const result = await api.changes()
    if (!result.ok) return setError(result.error)
    setError(null)
    setChanges(result.value)
  }, [])

  // The picked change's diff, read once per pick and again whenever its place moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pick is rebuilt with the change list, so its place and path are what the diff is keyed by.
  useEffect(() => {
    if (pick === null) {
      setDiff(null)
      return
    }
    let current = true
    setReadingDiff(true)
    void api.changeDiff(pick.placeId, pick.path).then((result) => {
      if (!current) return
      setReadingDiff(false)
      if (!result.ok) {
        setDiff(null)
        return setError(result.error)
      }
      setError(null)
      setDiff(result.value)
    })
    return () => {
      current = false
    }
  }, [pick?.placeId, pick?.path, changes])

  /**
   * Stage, unstage, commit and push: the main process does it, then says every view is stale, and
   * the list comes back from the engine's own cache. Only the group the action is in waits.
   */
  async function act(placeId: string, run: () => Promise<{ ok: boolean; error?: string }>): Promise<void> {
    setActing(placeId)
    const result = await run()
    setActing(null)
    setError(result.ok ? null : (result.error ?? 'That did not work'))
    await reload()
  }

  /** A comment on a line of a worktree's diff is the review screen's comment, written from here. */
  async function comment(line: number, body: string): Promise<void> {
    if (place?.ticketId == null || pick === null) return
    const written = await window.tinyCorp.reviews.comment({
      ticketId: place.ticketId,
      repoId: place.repoId,
      path: pick.path,
      line,
      body,
    })
    if (!written.ok) return setError(written.error)
    setError(null)
    setCommentOn(null)
    add(written.value)
  }

  async function discard(): Promise<void> {
    const asked = discarding
    if (!asked) return
    setDiscarding(null)
    await act(asked.placeId, () => api.discard(asked.placeId, asked.paths))
  }

  return {
    changedCount,
    panel: {
      groups,
      pick,
      collapsed,
      busy: acting,
      error,
      onToggle: (placeId) => setCollapsed((was) => toggleGroup(was, placeId)),
      onPick: (next) => {
        setChange(next)
        setCommentOn(null)
      },
      onStage: (placeId, path) => void act(placeId, () => api.stage(placeId, [path])),
      onUnstage: (placeId, path) => void act(placeId, () => api.unstage(placeId, [path])),
      // Discard is asked about first, and named file by file: it is the one that loses work.
      onDiscard: (placeId: string, row: ChangeRow) =>
        setDiscarding({
          placeId,
          paths: [row.path, row.previousPath].filter((path): path is string => path !== null),
          restorable: places.find((one) => one.id === placeId)?.ticketId != null,
        }),
      onCommit: (placeId, message) => void act(placeId, () => api.commit(placeId, message)),
      onPush: (placeId) => void act(placeId, () => api.push(placeId)),
    },
    diff: {
      place,
      diff,
      controls,
      loading: readingDiff,
      error,
      comments,
      employees,
      bossName,
      commentOn,
      onCommentOn: setCommentOn,
      onComment: (line, body) => void comment(line, body),
    },
    discarding,
    acting: acting !== null,
    onCancelDiscard: () => setDiscarding(null),
    onDiscard: () => void discard(),
    reload,
  }
}

/** The ticket's own line comments, and the boss's name to sign a new one with. */
function useDiffComments(place: FilePlace | null): {
  comments: readonly ReviewComment[]
  bossName: string
  add(comment: ReviewComment): void
} {
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [bossName, setBossName] = useState('')
  const ticketId = place?.ticketId ?? null
  const repoId = place?.repoId

  useEffect(() => {
    if (ticketId === null) return setComments([])
    let current = true
    const read = async () => {
      const [written, boss] = await Promise.all([
        window.tinyCorp.reviews.comments(ticketId),
        window.tinyCorp.profile.get(),
      ])
      if (!current) return
      if (written.ok) setComments(written.value.filter((comment) => comment.repoId === repoId))
      if (boss.ok) setBossName(boss.value.name)
    }
    void read()
    const off = window.tinyCorp.reviews.onChanged(() => void read())
    return () => {
      current = false
      off()
    }
  }, [ticketId, repoId])

  return { comments, bossName, add: (comment) => setComments((was) => [...was, comment]) }
}
