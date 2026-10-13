import { BOSS, dmChannelId, type Message } from '../../../shared/domain/chat'
import type { Result } from '../../../shared/domain/result'
/**
 * Hands `text` to the team as a DM from the boss to the Employee who answers them (decision 41),
 * which wakes them with the goal prompt. Null when the text is blank or nobody answers.
 */
export async function assignTask(
  post: (channelId: string, text: string) => Promise<Result<Message>>,
  answererId: string | null,
  text: string,
): Promise<Result<Message> | null> {
  const goal = text.trim()
  if (!goal || !answererId) return null
  return post(dmChannelId(BOSS, answererId), goal)
}
