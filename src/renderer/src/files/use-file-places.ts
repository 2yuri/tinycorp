/**
 * The places the Files view can read — a repo, or an Employee's worktree for a ticket — and which
 * one it is on. The subtitle's picker is here too, because it is the one thing that changes it by
 * hand.
 */
import { useCallback, useState } from 'react'
import type { FilePlace } from '../../../shared/files/files'
import { activeTab } from './tabs-model'
import { recallTabs } from './tabs-store'

const api = window.tinyCorp.files

export interface FilePlaces {
  places: FilePlace[]
  /** The place the tree shows: the chosen one, or the first the Company has. */
  place: FilePlace | null
  choose(id: string): void
  /** Whether the subtitle's picker is open; with one place there is nothing to pick. */
  picking: boolean
  setPicking(open: boolean): void
  /** Ask the engine again — the view calls it on the `files:changed` it already listens for. */
  reload(): Promise<void>
}

export interface FilePlacesWatch {
  /** The place the route names; a route that names another switches to it. */
  placeId: string | undefined
  /** The Company whose tabs — and so whose place — the view comes back to. */
  companyId: string | null
  setError(error: string | null): void
}

export function useFilePlaces({ placeId, companyId, setError }: FilePlacesWatch): FilePlaces {
  const [places, setPlaces] = useState<FilePlace[]>([])
  // The view opens on the place of the tab it comes back to, as the tree does (T121).
  const [chosen, setChosen] = useState<string | null>(
    () => placeId ?? activeTab(recallTabs(companyId))?.placeId ?? null,
  )
  const [picking, setPicking] = useState(false)
  // A route that names another place — a link to a file of another repo — switches to it, while the
  // boss stays free to switch back by hand. Read while rendering, so the tree is never drawn on the
  // place they have just left (T211).
  const [routedTo, setRoutedTo] = useState(placeId)
  if (placeId !== routedTo) {
    setRoutedTo(placeId)
    if (placeId !== undefined) setChosen(placeId)
  }

  const reload = useCallback(async () => {
    const result = await api.places()
    if (!result.ok) return setError(result.error)
    setError(null)
    setPlaces(result.value)
  }, [setError])

  return {
    places,
    place: places.find((one) => one.id === chosen) ?? places[0] ?? null,
    choose: setChosen,
    picking,
    setPicking,
    reload,
  }
}
