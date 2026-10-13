import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FoundRepo, FoundReposWalk } from '../../../shared/repos/found-repos'
import type { Repo, RepoInspection } from '../../../shared/repos/repo'
import { everyOffered, type FoundRepos, foundCounts, foundRows, foundTree, withRows } from './found-repos-model'

export type { FoundRepos } from './found-repos-model'

const api = () => window.tinyCorp.repos

/**
 * Walks a folder for the repos inside it and holds what the picker needs: the rows as they stream
 * in, what is ticked, the filter, and the remote and branch of the rows on screen. Changing the
 * folder, or leaving, stops the walk it started — nothing keeps reading a folder nobody is looking
 * at any more.
 */
export function useFoundRepos(folder: string | null, repos: readonly Repo[]): FoundRepos {
  const [found, setFound] = useState<FoundRepo[]>([])
  const [total, setTotal] = useState(0)
  const [at, setAt] = useState('')
  const [walk, setWalk] = useState<FoundReposWalk | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [inspections, setInspections] = useState<Record<string, RepoInspection>>({})
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>())
  const [filter, setFilter] = useState('')
  const running = useRef<string | null>(null)
  const asked = useRef(new Set<string>())

  useEffect(() => {
    setFound([])
    setTotal(0)
    setAt('')
    setWalk(null)
    setError(null)
    setInspections({})
    setSelected(new Set<string>())
    asked.current = new Set()
    if (!folder) {
      setScanning(false)
      return
    }
    const scan = crypto.randomUUID()
    running.current = scan
    setScanning(true)
    const off = api().onFound((event) => {
      if (event.scan !== scan) return
      if (event.found.length > 0) setFound((before) => [...before, ...event.found])
      setTotal(event.total)
      setAt(event.at)
      if (event.error) setError(event.error)
      if (event.walk || event.error) {
        setWalk(event.walk)
        setScanning(false)
      }
    })
    void api()
      .findRepos(folder, scan)
      .then((started) => {
        if (started.ok || running.current !== scan) return
        setError(started.error)
        setScanning(false)
      })
    return () => {
      off()
      running.current = null
      void api().stopFinding(scan)
    }
  }, [folder])

  const rows = useMemo(() => foundRows(found, repos, inspections), [found, repos, inspections])
  const tree = useMemo(() => foundTree(rows, selected, filter), [rows, selected, filter])
  const counts = useMemo(() => foundCounts(rows, walk, selected), [rows, walk, selected])
  const chosen = useMemo(
    () => rows.filter((row) => row.offered && selected.has(row.path)).map((row) => row.path),
    [rows, selected],
  )

  const seen = useCallback((paths: readonly string[]) => {
    const missing = paths.filter((path) => !asked.current.has(path))
    if (missing.length === 0) return
    for (const path of missing) asked.current.add(path)
    void api()
      .inspectMany(missing)
      .then((read) => setInspections((before) => ({ ...before, ...read })))
  }, [])

  return {
    folder,
    scanning,
    at,
    total,
    rows,
    tree,
    counts,
    walk,
    error,
    selected,
    chosen,
    filter,
    setFilter,
    toggle: (some, on) => setSelected((before) => withRows(before, some, on)),
    selectAll: () => setSelected(everyOffered(rows)),
    clear: () => setSelected(new Set<string>()),
    stop: () => {
      if (running.current) void api().stopFinding(running.current)
    },
    seen,
  }
}
