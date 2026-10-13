/**
 * A named channel's extras (T44): the topic the boss writes, the Employees who belong, the messages
 * anyone pinned and the search over a channel's bodies. Pure rules, shared by the engine, the MCP
 * tools and the renderer.
 */
import type { Message } from './domain/chat'

/** How long a topic may be. Long enough for a sentence, short enough for the header subtitle. */
export const TOPIC_MAX = 240

/** A pinned message, with who pinned it and when. */
export interface PinnedMessage extends Message {
  /** `BOSS` or an Employee id. */
  pinnedBy: string
  pinnedAt: string
}

/** What the boss or an Employee asks to pin. */
export interface PinRequest {
  messageId: number
  /** `BOSS` or an Employee id. */
  byId: string
}

export interface ChannelSearch {
  channelId: string
  /** The words to look for in message bodies; matching ignores case. */
  text: string
  /** The newest `limit` matches, default 50. */
  limit?: number
}

/**
 * A topic as it is stored: trimmed, its line breaks and runs of spaces collapsed, cut at `TOPIC_MAX`.
 * An empty topic means the channel has none and the view falls back to what it can say itself.
 */
export function normalizeTopic(text: unknown): string {
  const collapsed = typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : ''
  return collapsed.length > TOPIC_MAX ? collapsed.slice(0, TOPIC_MAX).trimEnd() : collapsed
}

/** The search text as it is used: trimmed. An empty one matches nothing, rather than everything. */
export function normalizeSearch(text: unknown): string {
  return typeof text === 'string' ? text.trim() : ''
}

/** The pin panel's heading: `3 pinned messages`. */
export function pinnedLabel(count: number): string {
  if (count === 0) return 'No pinned messages'
  return `${count} pinned ${count === 1 ? 'message' : 'messages'}`
}

/** The pin icon's label in the channel header, which carries the count when there is one. */
export function pinIconLabel(count: number): string {
  return count === 0 ? 'Pinned messages' : `Pinned messages (${count})`
}

/** The search panel's heading, naming what was looked for. */
export function searchLabel(count: number, text: string): string {
  const query = normalizeSearch(text)
  if (!query) return 'Search this channel'
  if (count === 0) return `No message matches “${query}”`
  return `${count} ${count === 1 ? 'message matches' : 'messages match'} “${query}”`
}

/** A result line with the match in the middle: enough words either side to read it. */
export interface Snippet {
  before: string
  match: string
  after: string
}

/** How many characters of context a snippet keeps on each side of the match. */
const SNIPPET_CONTEXT = 40

/**
 * `text` cut around the first case-insensitive occurrence of `query`, with an ellipsis where it was
 * cut. A text with no match comes back whole, as its own `before`.
 */
export function searchSnippet(text: string, query: string): Snippet {
  const needle = normalizeSearch(query)
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1
  if (at === -1) return { before: text, match: '', after: '' }
  const from = Math.max(0, at - SNIPPET_CONTEXT)
  const to = Math.min(text.length, at + needle.length + SNIPPET_CONTEXT)
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, at),
    match: text.slice(at, at + needle.length),
    after: text.slice(at + needle.length, to) + (to < text.length ? '…' : ''),
  }
}

/** Whether `channelId` is a channel whose members and topic the boss may set: a named one. */
export function isNamedChannel(channelId: string): boolean {
  return !channelId.startsWith('dm:')
}

/** What the members popover says a channel with no explicit member list means. */
export const EVERYONE_LABEL = 'Everyone in the Company'
