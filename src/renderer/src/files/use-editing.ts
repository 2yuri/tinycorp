/**
 * The file the viewer is showing, and the boss's unsaved work in it (T122).
 *
 * One subject, because it is one promise: nothing the boss typed is lost without them being asked.
 * Reading a tab, ⌘S, the Save button, closing a tab, leaving the view and ⌘W all come through here,
 * and so do the two dialogs a write puts in front of them — the ask, and the save that stopped.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileConflict } from '../../../shared/files/file-edits'
import type { OpenedFile } from '../../../shared/files/files'
import { onCloseRequest, onLeaveRequest } from '../chrome'
import {
  type Drafts,
  dirtyKeys,
  draftOf,
  dropDraft,
  isDirty,
  isEditable,
  isSaveKey,
  NO_DRAFTS,
  textOf,
  typedInto,
} from './editing-model'
import type { FileTabs } from './use-file-tabs'

const api = window.tinyCorp.files

/** The ask before unsaved work would go: which file, how many others, and the three answers. */
export interface UnsavedAsk {
  path: string
  others: number
  onCancel(): void
  onDiscard(): void
  onSave(): void
}

/** Both versions, when a save stopped because the file changed under the boss. */
export interface ConflictAsk {
  conflict: FileConflict
  onCancel(): void
  onTakeTheirs(): void
  onKeepMine(): void
}

export interface Editing {
  /** Null while nothing is open, or while a file is being read. */
  file: OpenedFile | null
  /** True when the shown file can be typed into: text, code or Markdown of a place, read whole. */
  editable: boolean
  /** What the editor shows: the boss's own text where they have one, else the file as it was read. */
  text: string
  /** True while the shown tab has work the disk has not seen. */
  dirty: boolean
  /** True while a save is in flight; the buttons wait for it. */
  saving: boolean
  /** The keys of every tab with unsaved work, which the tabs mark with a dot of their own. */
  dirtyKeys: readonly string[]
  onEdit(text: string): void
  onSave(): void
  onDiscard(): void
  /** Closing a tab with work the disk has not seen asks first; an untouched one just goes. */
  closeTab(key: string): void
  unsaved: UnsavedAsk | null
  conflict: ConflictAsk | null
}

/** What the boss is being asked about before their unsaved work would go. */
interface Ask {
  /** The tabs with work in them; the first is the one the dialog names. */
  keys: string[]
  path: string
  /** What happens once they are dealt with: the tab closes, or the shell shows the next view. */
  done(): void
}

export function useEditing(tabs: FileTabs, setError: (error: string | null) => void): Editing {
  const [file, setFile] = useState<OpenedFile | null>(null)
  // The boss's unsaved work, per tab (T122), and everything a write puts in front of them.
  const [drafts, setDrafts] = useState<Drafts>(NO_DRAFTS)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<FileConflict | null>(null)
  const [asking, setAsking] = useState<Ask | null>(null)

  // The stable half of the tabs handle: every effect below is installed once and reads through it.
  const { current, activate, close, update } = tabs
  const shown = tabs.shown
  const edited = useMemo(() => dirtyKeys(drafts), [drafts])
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  // The tab the viewer shows, read by the place it is in — or, for one from outside, on its own.
  const key = shown?.key
  useEffect(() => {
    const tab = current().tabs.find((one) => one.key === key)
    if (!tab) return setFile(null)
    let live = true
    const reading = tab.placeId === null ? window.tinyCorp.paths.open(tab.path) : api.open(tab.placeId, tab.path)
    void reading.then((result) => {
      if (!live) return
      // A tab that cannot be read shows why, not the file the boss was looking at before it.
      if (!result.ok) {
        setFile(null)
        return setError(result.error)
      }
      setError(null)
      setFile(result.value)
      // A line to land on in Markdown is a line of the source, so the source is what opens.
      if (result.value.kind === 'markdown' && tab.line !== null) update(tab.key, { source: true })
    })
    return () => {
      live = false
    }
  }, [key, current, update, setError])

  /**
   * Writes one tab back to disk. False when nothing was written: the file changed underneath and
   * both versions are now in front of the boss, or the main process refused it outright.
   */
  async function saveTab(key: string): Promise<boolean> {
    const tab = current().tabs.find((one) => one.key === key)
    const draft = draftOf(draftsRef.current, key)
    if (!tab || !draft || tab.placeId === null) return true
    setSaving(true)
    try {
      const result = await api.save(tab.placeId, { path: tab.path, text: draft.text, digest: draft.digest })
      if (!result.ok) {
        setError(result.error)
        return false
      }
      setError(null)
      if (!result.value.saved) {
        // Never clobber: the tab the save stopped on comes forward with both versions on it.
        activate(key)
        setConflict(result.value.conflict)
        return false
      }
      setDrafts((was) => dropDraft(was, key))
      if (key === current().activeKey) setFile(result.value.file)
      return true
    } finally {
      setSaving(false)
    }
  }

  /** Save, from the button, from ⌘S, and from the ask before unsaved work would go. */
  async function saveAll(keys: readonly string[]): Promise<boolean> {
    for (const key of keys) {
      if (!(await saveTab(key))) return false
    }
    return true
  }

  /** Discard: the file goes back to what it was opened as, and the tab has nothing unsaved. */
  function discard(keys: readonly string[]): void {
    setDrafts((was) => keys.reduce(dropDraft, was))
  }

  /** A tab that closes takes its draft with it: nothing is held for a file nobody has open. */
  function closeAndForget(key: string): void {
    setDrafts((was) => dropDraft(was, key))
    close(key)
  }

  /** Asking about one tab's unsaved work, by key: ⌘W and a tab's own × both land here. */
  function askAbout(keys: string[], done: () => void): void {
    const tab = current().tabs.find((one) => one.key === keys[0])
    setAsking({ keys, path: tab?.path ?? '', done })
  }

  const saveRef = useRef(saveTab)
  saveRef.current = saveTab
  const askRef = useRef(askAbout)
  askRef.current = askAbout
  const closeRef = useRef(closeAndForget)
  closeRef.current = closeAndForget

  // ⌘S saves the file the boss is in, wherever the focus is while Files is in front.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSaveKey(event)) return
      const key = current().activeKey
      if (key === null || !isDirty(draftsRef.current, key)) return
      event.preventDefault()
      void saveRef.current(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // Installed once: the handler reads the refs, so it never holds a stale tab or draft.
  }, [current])

  // Leaving the view with unsaved work asks first; the shell waits for the answer.
  useEffect(
    () =>
      onLeaveRequest((next, go) => {
        if (next.view === 'files') return false
        const keys = dirtyKeys(draftsRef.current)
        if (keys.length === 0) return false
        askRef.current(keys, go)
        return true
      }),
    [],
  )

  // ⌘W closes the active tab while Files has one; with none it is the menu's to close the Company.
  useEffect(
    () =>
      onCloseRequest(() => {
        const state = current()
        const key = state.activeKey
        if (state.tabs.length === 0 || key === null) return false
        // Unsaved work is asked about here too: ⌘W is a way of leaving a tab like any other.
        if (isDirty(draftsRef.current, key)) {
          askRef.current([key], () => closeRef.current(key))
          return true
        }
        closeRef.current(key)
        return true
      }),
    [current],
  )

  /** The boss kept their own version: it is written over exactly the text they were shown. */
  async function keepMine(): Promise<void> {
    const key = current().activeKey
    const tab = current().tabs.find((one) => one.key === key)
    if (!conflict || !tab || tab.placeId === null || key === null) return
    setSaving(true)
    const result = await api.save(tab.placeId, { path: tab.path, text: conflict.yours, digest: conflict.theirDigest })
    setSaving(false)
    if (!result.ok) return setError(result.error)
    if (!result.value.saved) return setConflict(result.value.conflict)
    setConflict(null)
    setDrafts((was) => dropDraft(was, key))
    setFile(result.value.file)
  }

  /** The boss took the Employee's version: their own typing goes, and the file is read again. */
  async function takeTheirs(): Promise<void> {
    const key = current().activeKey
    const tab = current().tabs.find((one) => one.key === key)
    if (key === null || !tab || tab.placeId === null) return
    setConflict(null)
    setDrafts((was) => dropDraft(was, key))
    const result = await api.open(tab.placeId, tab.path)
    if (result.ok) setFile(result.value)
    else setError(result.error)
  }

  return {
    file,
    editable: isEditable(file, shown?.placeId ?? null),
    text: textOf(drafts, shown?.key ?? null, file),
    dirty: isDirty(drafts, shown?.key ?? null),
    saving,
    dirtyKeys: edited,
    onEdit: (next) => {
      if (shown && file) setDrafts((was) => typedInto(was, shown.key, file, next))
    },
    onSave: () => {
      if (shown) void saveTab(shown.key)
    },
    onDiscard: () => {
      if (shown) discard([shown.key])
    },
    closeTab: (key) => {
      if (!isDirty(draftsRef.current, key)) return closeAndForget(key)
      askAbout([key], () => closeAndForget(key))
    },
    unsaved:
      asking === null
        ? null
        : {
            path: asking.path,
            others: asking.keys.length - 1,
            onCancel: () => setAsking(null),
            onDiscard: () => {
              discard(asking.keys)
              setAsking(null)
              asking.done()
            },
            onSave: () => {
              void saveAll(asking.keys).then((all) => {
                setAsking(null)
                if (all) asking.done()
              })
            },
          },
    conflict:
      conflict === null
        ? null
        : {
            conflict,
            onCancel: () => {
              setConflict(null)
              setAsking(null)
            },
            onTakeTheirs: () => void takeTheirs(),
            onKeepMine: () => void keepMine(),
          },
  }
}
