import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileSides } from '../../../shared/review/review-diff'

/**
 * One file's two sides, read when the boss opens it — and, where a hover says they are about to,
 * a moment before (T243).
 *
 * The file list arrives with the change; a file's text does not, because a PR of forty files would
 * otherwise cross IPC whole to draw one of them. So the list is what the screen renders first and
 * this reads the one file under the boss's eyes. What has been read is kept for as long as the
 * screen is open, keyed by the commit it was read at, so going back to a file is instant.
 */
export interface FileSidesReader {
  /** The picked file's sides, or null while they are on their way. */
  sides: FileSides | null
  /** True while the pick's sides are being read for the first time. */
  loading: boolean
  /** Why they could not be read, or null. */
  error: string | null
  /** Reads a file's sides into the cache without picking it — what a hover asks for. */
  prefetch(repoId: string, path: string): void
}

/** What a set of sides is keyed by: nothing outlives a Company switch or a new head. */
function keyOf(ticketId: number, repoId: string, path: string): string {
  return `${ticketId}\u0000${repoId}\u0000${path}`
}

export function useFileSides(
  ticketId: number,
  pick: { repoId: string; path: string } | null,
  /** Bumped whenever the change itself moved, so what is cached is thrown away with it. */
  generation: string,
): FileSidesReader {
  const [read, setRead] = useState<Map<string, FileSides>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What is already in flight, so a hover and a click never ask twice for the same file. */
  const flying = useRef(new Map<string, Promise<void>>())

  // A new head is a new set of files: everything kept is about the change that was there before.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is not read in here — it is the thing that happened, and throwing the cache away is what happens because of it.
  useEffect(() => {
    setRead(new Map())
    flying.current.clear()
  }, [generation])

  const fetch = useCallback(
    (repoId: string, path: string, picked: boolean): void => {
      const key = keyOf(ticketId, repoId, path)
      if (picked) setLoading(true)
      // A hover that has already started the read is the click's read too: the boss waits on the
      // one call either way, and the pane still says it is reading.
      const flight =
        flying.current.get(key) ??
        window.tinyCorp.reviews.fileSides(ticketId, repoId, path).then((result) => {
          flying.current.delete(key)
          if (result.ok) setRead((was) => new Map(was).set(key, result.value))
          else if (picked) setError(result.error)
          // A hover that fails says nothing: the boss never asked for that file.
        })
      flying.current.set(key, flight)
      if (picked) void flight.then(() => setLoading(false))
    },
    [ticketId],
  )

  const key = pick === null ? null : keyOf(ticketId, pick.repoId, pick.path)
  const held = key === null ? null : (read.get(key) ?? null)

  useEffect(() => {
    if (pick === null || held !== null) return
    setError(null)
    fetch(pick.repoId, pick.path, true)
  }, [pick, held, fetch])

  // A pick whose sides are already read is not loading, whatever some other read is doing.
  return {
    sides: held,
    loading: held === null && loading,
    error: held === null ? error : null,
    prefetch: useCallback((repoId, path) => fetch(repoId, path, false), [fetch]),
  }
}
