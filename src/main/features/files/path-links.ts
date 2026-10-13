import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { FilePlace, OpenedFile } from '../../../shared/files/files'
import { type PathLink, type PathMention, type PathTarget, pathMentions } from '../../../shared/files/path-links'
import { openFileAt } from './files'

/** What the resolver needs of the disk; injected so tests need no checkout. */
export interface PathLinksDeps {
  /** Whether there is a readable file at an absolute path. A folder does not count. */
  isFile(path: string): boolean
  /** The boss's home, for a `~/…` path. */
  home(): string
}

export interface PathLinksOptions {
  /** The Company's repos and worktrees: an Employee's worktree first, as the Files view lists them. */
  places(): FilePlace[]
  deps?: PathLinksDeps
}

export interface PathLinksReader {
  /** Every path written in `text` that is really a file, with where a click on it goes. */
  links(text: string): PathLink[]
  /** The absolute path one written path names, or null when no file is there. */
  locate(written: string): string | null
  /** Reads a file outside the Company for the viewer, the way the Files view reads one of its own. */
  open(written: string): OpenedFile
}

export const realPathLinksDeps: PathLinksDeps = {
  isFile(path) {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  home: homedir,
}

/**
 * Turns the paths an Employee wrote into links (T114). A path is a link only when a file is really
 * there: one that is not stays plain text, and nothing is ever guessed at.
 *
 * Nothing here runs anything. A path is resolved first, then read or handed on as one argument of
 * its own; it never becomes part of a command line.
 */
export function createPathLinks({ places, deps = realPathLinksDeps }: PathLinksOptions): PathLinksReader {
  /** The Company's places; with no Company open there are none, which is not a failure. */
  function known(): FilePlace[] {
    try {
      return places()
    } catch {
      return []
    }
  }

  function found(mention: PathMention, inside: FilePlace[]): { target: PathTarget; full: string } | null {
    for (const full of candidates(mention, inside, deps.home())) {
      if (!deps.isFile(full)) continue
      const place = placeOf(full, inside)
      return place === null
        ? { full, target: { kind: 'outside', path: full } }
        : { full, target: { kind: 'place', ...place, line: mention.line, column: mention.column } }
    }
    return null
  }

  function locate(written: string): string | null {
    const inside = known()
    const trimmed = written.trim()
    const mention = pathMentions(trimmed, repoNames(inside))[0]
    if (!mention || mention.text !== trimmed) return null
    return found(mention, inside)?.full ?? null
  }

  return {
    links(text) {
      const inside = known()
      const names = repoNames(inside)
      const links: PathLink[] = []
      for (const mention of pathMentions(text, names)) {
        const target = found(mention, inside)
        if (target) links.push({ ...mention, ...target })
      }
      return links
    },

    locate,

    open(written) {
      const full = locate(written)
      if (full === null) throw new Error(`There is no file at ${written.trim()}`)
      return openFileAt(full)
    },
  }
}

function repoNames(places: readonly FilePlace[]): string[] {
  return [...new Set(places.map((place) => place.repoName))]
}

/** Every absolute path a written one could mean, in the order they are worth trying. */
function candidates(mention: PathMention, places: readonly FilePlace[], home: string): string[] {
  const { path, repo } = mention
  // `~\notes.md` is the same sentence as `~/notes.md`, and an Employee on Windows writes it (T166).
  if (/^~[\\/]/.test(path)) return [resolve(home, path.slice(2))]
  if (isAbsolute(path)) return [resolve(path)]
  const wanted = repo === null ? places : places.filter((place) => place.repoName.toLowerCase() === repo.toLowerCase())
  const written = path.replace(/^\.[\\/]/, '')
  return wanted.map((place) => resolve(place.path, written))
}

/**
 * The place an absolute path is in, with where it sits inside it; null when it is nowhere the
 * Company owns. A path that climbs out of a place is not in it.
 */
function placeOf(full: string, places: readonly FilePlace[]): { placeId: string; path: string } | null {
  for (const place of places) {
    const inside = relative(resolve(place.path), full)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) continue
    return { placeId: place.id, path: inside.split(sep).join('/') }
  }
  return null
}
