import type { ColleagueVoice } from '../../../shared/colleague-voice'
import type { CompanyChanged } from '../company'
import type { Chat } from './chat'

/**
 * The chat screen's face on the engine (T188), and the one setting behind it.
 *
 * `chat()` is the current Company's; `onChatChange` fires for any open one, because the Company
 * rail marks a Company the boss is not looking at.
 */
export interface ChatFacade extends CompanyChanged {
  /** The chat of the current Company. Throws when no Company is open. */
  chat(): Chat
  /** Called after a message is posted in any open Company. Returns an unsubscribe function. */
  onChatChange(listener: () => void): () => void
}

/**
 * How Employees write to each other (T180). One Company-wide choice: both sides of a DM have to
 * agree on it. What the boss reads is never a setting.
 */
export interface VoiceFacade {
  voice: {
    colleague(): ColleagueVoice
    setColleague(voice: ColleagueVoice): ColleagueVoice
    /** Called after the voice changes, in any open Company. */
    onChange(listener: () => void): () => void
  }
}
