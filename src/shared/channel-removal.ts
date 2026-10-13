/** Deleting a channel: the boss's own action, offered where it is allowed (T112). */
import { type Channel, DEFAULT_CHANNELS } from './domain/chat'

/** What deleting one channel takes with it, as the confirmation states it. */
export interface ChannelRemoval {
  channelId: string
  /** The channel's name, without the `#`. */
  name: string
  /** Every message in it, replies included. */
  messages: number
  /** The epic that loses its channel, or null when no epic holds it. */
  epicId: number | null
}

/** The label of the row's and the header's delete button: `Delete #epic-4-checkout`. */
export function deleteChannelAction(name: string): string {
  return `Delete #${name}`
}

/**
 * Whether the boss may delete this conversation: a named channel of their own making. `#general`,
 * `#tech` and `#prs` are the Company's own — the instructions name them — and a DM belongs to the
 * two people in it.
 */
export function canDeleteChannel(channel: Pick<Channel, 'id' | 'kind'>): boolean {
  return channel.kind === 'channel' && !isCompanyChannel(channel.id)
}

/** One of `#general`, `#tech` and `#prs`. */
function isCompanyChannel(channelId: string): boolean {
  return (DEFAULT_CHANNELS as readonly string[]).includes(channelId)
}

/** The confirmation's title: `Delete #epic-4-checkout?`. */
export function deleteChannelTitle(removal: Pick<ChannelRemoval, 'name'>): string {
  return `Delete #${removal.name}?`
}

/** The confirmation's body, naming the channel, its messages and the epic that keeps going. */
export function deleteChannelBody(removal: ChannelRemoval): string {
  const goes =
    removal.messages === 0
      ? `#${removal.name} has no messages yet; it goes with its read marks and anything waiting on it.`
      : `#${removal.name} and its ${plural(removal.messages, 'message')} go, with their threads, ` +
        'read marks and anything waiting on them.'
  const epic =
    removal.epicId === null ? '' : ` Epic ${removal.epicId} keeps its tickets and simply has no channel from then on.`
  return `${goes}${epic} This cannot be undone.`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
