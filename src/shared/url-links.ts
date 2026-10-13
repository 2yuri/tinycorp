/**
 * The web links in a piece of text (T290): `https://gitlab.com/acme/web/-/merge_requests/157`, as an
 * Employee pastes it into a sentence. Only `http` and `https`, the only kinds the window hands to
 * the system browser, and never the full stop, comma or bracket the sentence put after it.
 */

export interface UrlSegment {
  text: string
  /** Set when the text is a link: the address it opens. */
  url?: string
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi
/** What a sentence leaves after a link that is not part of it. */
const TRAILING = /[.,;:!?*_~]+$/
const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** The link a match really is: trailing punctuation, and a closing bracket the link never opened, dropped. */
function trimmed(raw: string): string {
  let url = raw
  for (;;) {
    const before = url
    url = url.replace(TRAILING, '')
    const last = url.at(-1)
    const open = last === undefined ? undefined : PAIRS[last]
    if (open !== undefined && url.split(open).length <= url.split(last as string).length - 1) url = url.slice(0, -1)
    if (url === before) return url
  }
}

/** The text cut into plain runs and links, in order; text with no link comes back as one run. */
export function urlSegments(text: string): UrlSegment[] {
  const segments: UrlSegment[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimmed(match[0])
    if (!/^https?:\/\/[^/\s]+/i.test(url)) continue
    if (match.index > last) segments.push({ text: text.slice(last, match.index) })
    segments.push({ text: url, url })
    last = match.index + url.length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}
