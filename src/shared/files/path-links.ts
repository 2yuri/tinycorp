/**
 * T114: a path an Employee wrote is a link. This is the matcher and the shapes around it — what a
 * path looks like in prose, and how a piece of text is cut into plain parts and links.
 *
 * Nothing here touches disk: it only says what *could* be a path. Whether it is one is the main
 * process's answer, in `src/main/engine/path-links.ts`, and a path that is not there stays text.
 */

/** A path as it was written, before anyone has looked on disk for it. */
export interface PathMention {
  /** Where the whole of it starts in the text it was found in. */
  index: number
  /** The whole of it as written: the repo in front and the `:line:column` included. */
  text: string
  /** The path alone, without the repo in front and without the line and column. */
  path: string
  /** The repo written in front of it (`web src/format/currency.ts:19`); null when there is none. */
  repo: string | null
  line: number | null
  column: number | null
}

/** Where a link goes when the boss clicks it. */
export type PathTarget =
  /** A file of one of the Company's repos or worktrees: the Files view opens it. */
  | { kind: 'place'; placeId: string; path: string; line: number | null; column: number | null }
  /** A file elsewhere on the machine: the viewer draws it, or the system opens it. */
  | { kind: 'outside'; path: string }

/** A mention that really is a file, with where a click on it goes. */
export interface PathLink extends PathMention {
  target: PathTarget
  /** The absolute path the click will open, which is what the hover shows. */
  full: string
}

/** A piece of text: plain, or a link over the path that was written there. */
export interface PathSegment {
  text: string
  /** Set when this piece is a path that is really there. */
  link?: PathLink
}

/** How many mentions one piece of text may turn into links; the rest stay text. */
export const MAX_MENTIONS = 32

/**
 * A path as prose holds one: `/Users/yuri/shot.png`, `~/notes.md`, `./counter.ts`,
 * `src/shared/office/counter.ts`, `counter.ts:19:8` — and the same four written the way Windows
 * writes them: `C:\Users\yuri\shot.png`, `\\nas\team\notes.md`, `.\counter.ts`,
 * `src\shared\counter.ts` (T166). A URL never matches: the lookbehind refuses a path glued to a
 * word, a scheme or another path, and a drive letter is only a drive when a separator follows it.
 * A `~` inside a segment is a segment's own character — Windows writes `RUNNER~1` for a folder
 * whose real name is longer, and that is the shape a temp path comes back in.
 */
const CANDIDATE =
  /(?<![\w@:~./\\-])(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\.{1,2}[\\/]|[\\/])?[\w.@+%~-]+(?:[\\/][\w.@+%~-]+)*[\\/]?(?::\d+){0,2}/gu

/** A name that ends in an extension — `counter.ts` — which is what makes a bare word a path. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/

/** What a sentence leaves behind it, which is never part of the path. */
const TRAILING = /[.,;:!?)\]}'"«»]+$/

/** The word just before a path, which may be the repo it is in. */
const WORD_BEFORE = /(?:^|[\s(["'`])([A-Za-z0-9][\w.-]*) $/

/**
 * Every path written in `text`, in the order they appear. A word in `repoNames` immediately in
 * front of one is taken as the repo it is in, the shape a review comment already writes.
 */
export function pathMentions(text: string, repoNames: readonly string[] = []): PathMention[] {
  const mentions: PathMention[] = []
  for (const match of text.matchAll(CANDIDATE)) {
    if (mentions.length >= MAX_MENTIONS) break
    const mention = mentionOf(text, match[0], match.index, repoNames)
    if (mention) mentions.push(mention)
  }
  return mentions
}

function mentionOf(text: string, raw: string, index: number, repoNames: readonly string[]): PathMention | null {
  const token = raw.replace(TRAILING, '')
  if (!token) return null
  const [path, line, column] = split(token)
  if (!looksLikePath(path)) return null
  const repo = repoBefore(text.slice(0, index), repoNames)
  return {
    index: repo === null ? index : index - (repo.length + 1),
    text: repo === null ? token : `${repo} ${token}`,
    path,
    repo,
    line,
    column,
  }
}

/** `counter.ts:19:8` as its three parts. A `:` that is not a number is part of the path. */
function split(token: string): [path: string, line: number | null, column: number | null] {
  const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(token)
  if (!match) return [token, null, null]
  const [, path, line, column] = match
  return [path ?? token, line === undefined ? null : Number(line), column === undefined ? null : Number(column)]
}

/**
 * Whether a token is worth looking for on disk: it says where it starts (`/`, `~/`, `./`, `C:\`),
 * it has a folder in it, or it ends in an extension. A bare word never does.
 */
function looksLikePath(path: string): boolean {
  if (path === '' || /^(?:[\\/]|~[\\/]|[A-Za-z]:[\\/])$/.test(path)) return false
  if (/^(?:[\\/]|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/.test(path)) return true
  if (/[\\/]/.test(path)) return true
  return EXTENSION.test(path)
}

/** The repo named right in front of a path, when the word there is one of the Company's. */
function repoBefore(before: string, repoNames: readonly string[]): string | null {
  const word = WORD_BEFORE.exec(before)?.[1]
  if (word === undefined) return null
  return repoNames.some((name) => name.toLowerCase() === word.toLowerCase()) ? word : null
}

/** `text` cut into plain parts and the links found in it, in order, with nothing lost. */
export function pathSegments(text: string, links: readonly PathLink[]): PathSegment[] {
  const segments: PathSegment[] = []
  let last = 0
  for (const link of [...links].sort((a, b) => a.index - b.index)) {
    if (link.index < last || text.slice(link.index, link.index + link.text.length) !== link.text) continue
    if (link.index > last) segments.push({ text: text.slice(last, link.index) })
    segments.push({ text: link.text, link })
    last = link.index + link.text.length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}

/** What the hover says, and what the click will open: the whole path, with the line when there is one. */
export function pathTitle(link: PathLink): string {
  return link.line === null ? link.full : `${link.full}:${link.line}`
}
