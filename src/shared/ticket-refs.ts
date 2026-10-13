/**
 * How a ticket is referenced in chat: `TC-142`, the Company's display id, and `#142`, the short
 * form (decision 33). Both link and both wake the ticket's holder. `#tech` is a link to a channel.
 */
import { ticketCode, ticketCodePattern } from './ticket-id'

/** A `#…` token: not glued to a word, an `&` entity or a path before it. */
const HASH_TOKEN = /(?<![\p{L}\p{N}_&/])#([\p{L}\p{N}_-]+)/gu
const TICKET_ID = /^[1-9]\d*$/

/** How many `#` suggestions the composer shows at most. */
const MAX_SUGGESTIONS = 8

/** The ids of the tickets `text` references as `TC-142` or `#142`, each once, in order of appearance. */
export function parseTicketRefs(text: string, companyKey: string): number[] {
  const ids = new Set<number>()
  for (const segment of hashSegments(text, [], companyKey)) {
    if (segment.ticketId !== undefined) ids.add(segment.ticketId)
  }
  return [...ids]
}

export interface HashSegment {
  text: string
  /** Set when the text is `TC-142` or `#142`. */
  ticketId?: number
  /** Set when the text is `#<name>` of one of the known channels. */
  channelId?: string
}

/** A link found in the text, before the parts between them are cut out. */
interface Hit extends HashSegment {
  start: number
  end: number
}

function hashHits(text: string, channelIds: readonly string[]): Hit[] {
  const hits: Hit[] = []
  for (const match of text.matchAll(HASH_TOKEN)) {
    const token = match[1]!
    const link = TICKET_ID.test(token)
      ? { ticketId: Number(token) }
      : channelIds.includes(token)
        ? { channelId: token }
        : null
    if (link) hits.push({ text: match[0], start: match.index, end: match.index + match[0].length, ...link })
  }
  return hits
}

function codeHits(text: string, companyKey: string): Hit[] {
  if (!companyKey) return []
  const hits: Hit[] = []
  for (const match of text.matchAll(ticketCodePattern(companyKey))) {
    hits.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      ticketId: Number(match[1]),
    })
  }
  return hits
}

/** `text` cut into plain parts, ticket references (`TC-142`, `#142`) and `#<name>` channel links. */
export function hashSegments(text: string, channelIds: readonly string[], companyKey: string): HashSegment[] {
  // Both patterns read the same text, so the earlier hit wins and anything inside it is dropped.
  const hits = [...hashHits(text, channelIds), ...codeHits(text, companyKey)].sort((a, b) => a.start - b.start)
  const segments: HashSegment[] = []
  let last = 0
  for (const hit of hits) {
    if (hit.start < last) continue
    if (hit.start > last) segments.push({ text: text.slice(last, hit.start) })
    const { start: _start, end: _end, ...segment } = hit
    segments.push(segment)
    last = hit.end
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}

/** The channel name of a new epic: `epic-<id>-<title slug>`. It does not follow later renames. */
export function epicChannelName(epic: { id: number; title: string }): string {
  const slug = epic.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 32)
    .replace(/^-+|-+$/g, '')
  return slug ? `epic-${epic.id}-${slug}` : `epic-${epic.id}`
}

/** The epic an `epic-<id>-<slug>` channel belongs to, or null for any other channel. */
export function epicIdOfChannel(channelId: string): number | null {
  const match = /^epic-([1-9]\d*)(?:-|$)/.exec(channelId)
  return match ? Number(match[1]) : null
}

/** The `#…` being typed just before `caret`, or null when the caret is not in one. */
export function hashAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_-]*)$/u.exec(before)
  if (!match) return null
  return { start: before.length - match[2]!.length - 1, query: match[2]! }
}

export interface HashSuggestion {
  kind: 'ticket' | 'channel'
  /** What the reference points at: a ticket id or a channel name. */
  value: string
  /** What goes into the composer: `TC-142` for a ticket, `#tech` for a channel. */
  insert: string
  label: string
}

/** What `#query` could mean: tickets by id prefix or title word prefix, then channels by name prefix. */
export function hashSuggestions(
  query: string,
  tickets: readonly { id: number; title: string }[],
  channelIds: readonly string[],
  companyKey: string,
): HashSuggestion[] {
  const q = query.toLowerCase()
  const ticketHits = tickets
    .filter(
      (t) =>
        String(t.id).startsWith(q) ||
        ticketCode(companyKey, t.id).toLowerCase().startsWith(q) ||
        t.title
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .some((word) => word.startsWith(q)),
    )
    .map(
      (t): HashSuggestion => ({
        kind: 'ticket',
        value: String(t.id),
        insert: ticketCode(companyKey, t.id),
        label: t.title,
      }),
    )
  const channelHits = channelIds
    .filter((id) => id.toLowerCase().startsWith(q))
    .map((id): HashSuggestion => ({ kind: 'channel', value: id, insert: `#${id}`, label: id }))
  return [...ticketHits, ...channelHits].slice(0, MAX_SUGGESTIONS)
}

/** `text` with the reference at `start…caret` replaced by `insert `, and where the caret goes next. */
export function completeHash(
  text: string,
  start: number,
  caret: number,
  insert: string,
): { text: string; caret: number } {
  const inserted = `${insert} `
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length }
}
