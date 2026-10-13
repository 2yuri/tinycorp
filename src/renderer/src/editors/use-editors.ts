import { useCallback, useEffect, useState } from 'react'
import { type EditorsState, SYSTEM_DEFAULT } from '../../../shared/files/editors'

/** What the button says before the main process has answered: the system default, and no list. */
export const NO_EDITORS: EditorsState = { found: [], choice: null, using: SYSTEM_DEFAULT }

/**
 * Which editor opens a file, and the boss's pick of it (T123). The main process owns both what
 * this Mac has and the choice, kept beside the boss profile; this reads it and passes a pick
 * along, so every button in every window says the same thing.
 */
export function useEditors(): { editors: EditorsState; choose(id: string): void } {
  const [editors, setEditors] = useState<EditorsState>(NO_EDITORS)

  useEffect(() => {
    const api = window.tinyCorp.editors
    let live = true
    void api.get().then((state) => {
      if (live) setEditors(state)
    })
    const off = api.onChanged((state) => setEditors(state))
    return () => {
      live = false
      off()
    }
  }, [])

  const choose = useCallback((id: string) => {
    // The broadcast follows, but the button answers the click at once.
    setEditors((current) => ({ ...current, choice: id, using: id }))
    void window.tinyCorp.editors.choose(id).then((result) => {
      if (result.ok) setEditors(result.value)
    })
  }, [])

  return { editors, choose }
}
