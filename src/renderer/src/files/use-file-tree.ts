/**
 * The folder on the left: the place's tree, which folders are open, the find box, and the New file
 * dialog that writes into it (T122).
 *
 * The route the view was opened with is carried here too, because the tree is what says whether the
 * path it named is a file of this place: a path with no place waits for the tree to load, while one
 * that names its own place — or a whole path from outside (T121) — opens as a tab straight away.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileTree as Tree } from '../../../shared/files/files'
import { type FileRow, fileRows, firstFile, firstOpenFolders, foldersOf, openedFor, toggleFolder } from './files-model'
import { activeTab } from './tabs-model'
import type { FileTabs } from './use-file-tabs'

const api = window.tinyCorp.files

/** The New file dialog, while the boss is filling it in. */
export interface Creating {
  /** The folder the tree has chosen, which the path starts at. */
  folder: string | null
  busy: boolean
  error: string | null
  onCancel(): void
  onCreate(path: string): void
}

export interface FileTreeState {
  rows: readonly FileRow[]
  /** True when the tree stopped short of the whole folder. */
  truncated: boolean | undefined
  query: string
  onQuery(query: string): void
  onPick(row: { path: string; kind: 'file' | 'folder' }): void
  /** New file, from the header's button; null until the boss asks for one. */
  creating: Creating | null
  onNew(): void
}

/** The file a route named, opened once. */
export interface FileRoute {
  placeId?: string | undefined
  path?: string | undefined
  line?: number | undefined
  /** The whole path of a file nowhere the Company owns, which opens as a tab of its own (T121). */
  outside?: string | undefined
}

export interface FileTreeWatch {
  /** The place the tree shows; nothing is read while the Company has none. */
  placeId: string | undefined
  route: FileRoute
  tabs: FileTabs
  setError(error: string | null): void
  onOpen?: ((placeId: string, path: string | null) => void) | undefined
}

export function useFileTree({ placeId, route, tabs, setError, onOpen }: FileTreeWatch): FileTreeState {
  const [tree, setTree] = useState<Tree | null>(null)
  const [folders, setFolders] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { current, open } = tabs
  // The file the route arrived with, opened once; a path with no place waits for the tree to load.
  const arrived = useRef<FileRoute | null>(
    route.placeId === undefined && route.path === undefined && route.outside === undefined ? null : route,
  )

  // The route the view was opened with: a file of a place, or one from outside, opened once.
  useEffect(() => {
    const first = arrived.current
    if (!first) return
    if (first.outside !== undefined) {
      arrived.current = null
      open({ placeId: null, path: first.outside, line: first.line ?? null })
    } else if (first.path !== undefined && first.placeId !== undefined) {
      const { placeId, path } = first
      arrived.current = null
      open({ placeId, path, line: first.line ?? null })
    }
  }, [open])

  // A new place brings its own tree, folded open to the file it shows; with nothing open at all it
  // opens on the file its Employee is in, as it did before there were tabs.
  useEffect(() => {
    if (placeId === undefined) return setTree(null)
    let live = true
    void api.tree(placeId).then((result) => {
      if (!live) return
      if (!result.ok) return setError(result.error)
      setError(null)
      setTree(result.value)
      const first = arrived.current
      const named =
        first?.path !== undefined && result.value.entries.some((entry) => entry.path === first.path) ? first.path : null
      const state = current()
      const showing = activeTab(state)
      const wanted =
        named ??
        (showing?.placeId === placeId ? showing.path : null) ??
        (state.tabs.length === 0 ? firstFile(result.value.entries) : null)
      setFolders(firstOpenFolders(result.value.entries, wanted))
      if (named !== null) arrived.current = null
      if (wanted !== null && (named !== null || showing?.placeId !== placeId)) {
        open({ placeId, path: wanted, line: named === null ? null : (first?.line ?? null) })
      }
    })
    return () => {
      live = false
    }
  }, [placeId, current, open, setError])

  /** New file: it is made inside the place, and opens as its own tab. */
  async function create(path: string): Promise<void> {
    if (placeId === undefined) return
    setBusy(true)
    const result = await api.create(placeId, path)
    setBusy(false)
    if (!result.ok) return setCreateError(result.error)
    setCreating(false)
    setCreateError(null)
    setFolders((was) => openedFor(was, result.value.path))
    open({ placeId, path: result.value.path })
    // The tree again, after the boss made a file in it: the new one has to be in the panel.
    const again = await api.tree(placeId)
    if (again.ok) setTree(again.value)
  }

  return {
    rows: useMemo(() => fileRows({ entries: tree?.entries ?? [], open: folders, query }), [tree, folders, query]),
    truncated: tree?.truncated,
    query,
    onQuery: setQuery,
    onPick: (row) => {
      if (row.kind === 'folder') {
        // The folder the tree has chosen is where a new file starts (T122), open or closed.
        setFolder(row.path)
        return setFolders(toggleFolder(folders, row.path))
      }
      if (placeId === undefined) return
      setFolder(foldersOf(row.path).at(-1) ?? '')
      setFolders(openedFor(folders, row.path))
      open({ placeId, path: row.path })
      onOpen?.(placeId, row.path)
    },
    creating: creating
      ? {
          folder,
          busy,
          error: createError,
          onCancel: () => {
            setCreating(false)
            setCreateError(null)
          },
          onCreate: (path) => void create(path),
        }
      : null,
    onNew: () => {
      setCreateError(null)
      setCreating(true)
    },
  }
}
