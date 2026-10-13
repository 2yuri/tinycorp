import { COMPANY_AUTHOR, type Message } from '../../../shared/domain/chat'
import type { Migration } from '../../core'

/** The company-wide channel: its unaddressed messages wake only the answerer, the rest read them (decision 41). */
export const GENERAL_CHANNEL = 'general'

/** The messages folded into an inbox item (now `thread` items), oldest first by message id. */
export const GENERAL_WAKES_MIGRATION: Migration = {
  name: 'inbox-general-folded-messages',
  sql: `
  CREATE TABLE inbox_item_message (
    item_id INTEGER NOT NULL REFERENCES inbox_item (id),
    message_id INTEGER NOT NULL REFERENCES message (id),
    PRIMARY KEY (item_id, message_id)
  );
`,
}

/** Whether `message` is a `#general` post everyone reads: top level, and said by a person. */
export function isGeneralPost(message: Message): boolean {
  return message.channelId === GENERAL_CHANNEL && message.threadId === null && message.authorId !== COMPANY_AUTHOR
}

/** One `#general` (or epic channel) message, with its author's name. */
export interface GeneralLine {
  message: Pick<Message, 'id' | 'text'>
  fromName: string
}

/**
 * What an unread item says: the messages in a channel someone else answers, oldest first. Only
 * read, never pushed; the prompt stays on one line.
 */
export function generalPrompt(lines: GeneralLine[], channelId: string = GENERAL_CHANNEL): string {
  const count = lines.length === 1 ? '1 message' : `${lines.length} messages`
  const listed = lines
    .map(
      ({ message, fromName }, i) =>
        `${i + 1}. from ${fromName} (message ${message.id}): ${JSON.stringify(message.text)}`,
    )
    .join(' ')
  return (
    `[company] #${channelId}, ${count}, oldest first: ${listed} ` +
    'For your information: someone else answers this. Do not reply unless you are @mentioned.'
  )
}
