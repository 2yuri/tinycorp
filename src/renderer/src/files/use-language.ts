import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type CodeSpot,
  type Defined,
  type Hovered,
  type LanguageReading,
  languageIdOf,
  NOTHING_KNOWN,
} from '../../../shared/files/language'

/**
 * What the code viewer knows about the file it is drawing (T115). The main process owns the
 * servers; this only asks, and only about a file a server speaks for — nothing is started for a
 * Markdown file or a stylesheet, and nothing is said about one either.
 *
 * The text it sends is whatever the viewer is showing, saved or not, so a diagnostic follows the
 * boss's typing. It waits for them to stop first: a read on every keystroke would ask the server
 * about text nobody has finished writing.
 *
 * The card under the pointer is no longer timed here: since T222 the editor is Monaco, and its own
 * hover decides when to ask. This answers the question and nothing else.
 */

/** How long the boss has to stop typing before the file is read again. */
export const READ_DELAY_MS = 400

export interface LanguageWatch {
  /** The place the file is in; null for one from outside the Company, which has no server. */
  placeId: string | null
  /** Relative to the place. */
  path: string | null
  /** What the viewer is showing right now. */
  text: string | null
  /**
   * True when the viewer only has the head of the file. A server told half a file would complain
   * about the half that is missing, so nothing is asked about one at all.
   */
  truncated?: boolean
}

export interface Language {
  reading: LanguageReading
  /** The type and the doc comment at a spot; null when the server knows nothing there. */
  hover(spot: CodeSpot): Promise<Hovered | null>
  /** Where the symbol at a spot is declared; null when the server knows nowhere. */
  find(spot: CodeSpot): Promise<Defined | null>
}

/** Whether a file is one a language server speaks for at all, and so worth asking about. */
export function worthReading({ placeId, path, truncated }: LanguageWatch): boolean {
  if (truncated === true) return false
  return placeId !== null && path !== null && languageIdOf(path) !== null
}

export function useLanguage(watch: LanguageWatch): Language {
  const [reading, setReading] = useState<LanguageReading>(NOTHING_KNOWN)
  const { placeId, path, text } = watch
  const asked = worthReading(watch)

  // The latest of everything, so an answer is never about the file the boss just left.
  const watching = useRef(watch)
  watching.current = watch

  useEffect(() => {
    if (!asked || placeId === null || path === null || text === null) return setReading(NOTHING_KNOWN)
    let current = true
    const wait = setTimeout(() => {
      void window.tinyCorp.language.read(placeId, path, text).then((result) => {
        if (!current) return
        // A server that went away leaves the viewer as it was, with the reason under the file.
        setReading(result.ok ? result.value : { ...NOTHING_KNOWN, status: 'failed', reason: result.error })
      })
    }, READ_DELAY_MS)
    return () => {
      current = false
      clearTimeout(wait)
    }
  }, [asked, placeId, path, text])

  const hover = useCallback(async (spot: CodeSpot): Promise<Hovered | null> => {
    const { placeId, path, text } = watching.current
    if (!worthReading(watching.current) || placeId === null || path === null || text === null) return null
    const result = await window.tinyCorp.language.hover(placeId, path, spot, text)
    return result.ok ? result.value : null
  }, [])

  const find = useCallback(async (spot: CodeSpot): Promise<Defined | null> => {
    const { placeId, path, text } = watching.current
    if (!worthReading(watching.current) || placeId === null || path === null || text === null) return null
    const result = await window.tinyCorp.language.definition(placeId, path, spot, text)
    return result.ok ? result.value : null
  }, [])

  return { reading, hover, find }
}
