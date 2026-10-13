import { Lock, MessageSquare, Scissors, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  COLLEAGUE_VOICE_HELP,
  COLLEAGUE_VOICE_LABEL,
  COLLEAGUE_VOICES,
  type ColleagueVoice,
  VOICE_EXAMPLE,
  VOICE_LOCKS,
} from '../../../shared/colleague-voice'
import { refreshIpcResource, resources } from '../ipc'
import { SegmentedControl, SettingsCard } from '../ui'
import '../ui/tailwind.css'
import { AppliesNextSession } from './AppliesNextSession'
import { CARD_ERROR, CARD_SUB, DIVIDER, LABEL, LABELLED, LINE_TITLE } from './settings-classes'

/** The two sample messages, 14px apart as the frame stacks them. */
const SAMPLES = 'flex flex-col gap-14'

/** 12 from the outer edge, the frame's own, so the text wraps where the frame wraps it. */
export const SAMPLE = 'm-0 flex flex-col gap-6 rounded-sm border border-border bg-secondary p-11'
const SAMPLE_HEAD = 'flex items-baseline justify-between gap-12'
const SAMPLE_WHO = 'text-11-5/[inherit] font-semibold text-foreground'

/*
 * The count is set in the mono face in the frame, which is what keeps the head's two ends apart,
 * and its 15px box is what makes the head 15 rather than the 14 the name alone would give it.
 */
const SAMPLE_COUNT = 'font-code text-11/15 tabular-nums text-muted-foreground'
const SAMPLE_TEXT = 'm-0 text-12-5/19 text-foreground'

/** A row the setting does not reach: an icon, then the rule and why it is not a switch. */
const LOCK = 'flex items-start gap-10 last:[&_svg]:text-brand-warning'
const LOCK_MARK = 'mt-2 shrink-0 text-muted-foreground'
const LOCK_TEXT = 'flex min-w-0 flex-col gap-2'

const api = window.tinyCorp

const VOICE_ICON = { terse: Scissors, plain: MessageSquare } as const
const LOCK_ICON = [Lock, ShieldAlert] as const

/**
 * How Employees talk (T180, frame `L0glbm`, right column): the one segmented control the boss has
 * here, the same news said twice, and the two rows the setting does not reach.
 *
 * It saves as it changes, like who tests and the daily digest: picking a segment is not a draft,
 * and a Save the boss forgot would leave the team writing the other voice all night. It reaches a
 * running Session at its next start, which the note under the control says (T237).
 */
export function ColleagueVoiceCard() {
  const [voice, setVoice] = useState<ColleagueVoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const saved = await api.voice.colleague()
    if (!saved.ok) return setError(saved.error)
    setError(null)
    setVoice(saved.value)
  }, [])

  useEffect(() => {
    void refresh()
    return api.voice.onChanged(() => void refresh())
  }, [refresh])

  if (!voice) return null

  async function pick(next: ColleagueVoice) {
    const result = await api.voice.setColleague(next)
    if (!result.ok) return setError(result.error)
    setError(null)
    setVoice(result.value)
    // A setting written is not a Session event, so what the note reads is read again from here.
    refreshIpcResource(resources.staleSessions)
  }

  return (
    <SettingsCard
      title="How Employees talk"
      sub="Employees spend fewer words on each other and full sentences on you."
      sub12
    >
      {error && <p className={CARD_ERROR}>{error}</p>}

      <div className={LABELLED}>
        <span className={LABEL}>Between Employees</span>
        <SegmentedControl
          label="Between Employees"
          value={voice}
          options={COLLEAGUE_VOICES.map((option) => ({
            value: option,
            label: COLLEAGUE_VOICE_LABEL[option],
            icon: VOICE_ICON[option],
          }))}
          onChange={(option) => void pick(option)}
        />
        <p className={CARD_SUB}>{COLLEAGUE_VOICE_HELP[voice]}</p>
      </div>

      <AppliesNextSession setting="colleagueVoice" />

      {/*
        A fixed illustration of the two voices, with the counts the frame drew. Nothing in the app
        counts the tokens of a real message, and no message anywhere carries a count. The label is
        a card row of its own, not a field's: `L0glbm` puts the card's 14 between it and the first
        sample, where `Between Employees` keeps a field's 6.
      */}
      <span className={LABEL}>The same news, twice</span>
      <div className={SAMPLES}>
        {COLLEAGUE_VOICES.map((option) => {
          const example = VOICE_EXAMPLE[option]
          return (
            <figure key={option} className={SAMPLE}>
              <figcaption className={SAMPLE_HEAD}>
                <span className={SAMPLE_WHO}>Ada → {example.to}</span>
                <span className={SAMPLE_COUNT}>{example.tokens} tokens</span>
              </figcaption>
              <p className={SAMPLE_TEXT}>{example.text}</p>
            </figure>
          )
        })}
      </div>

      <div className={DIVIDER} />
      {VOICE_LOCKS.map((lock, index) => {
        const Icon = LOCK_ICON[index] ?? Lock
        return (
          <div key={lock.title} className={LOCK}>
            <Icon className={LOCK_MARK} size={14} aria-hidden />
            <div className={LOCK_TEXT}>
              <div className={LINE_TITLE}>{lock.title}</div>
              <div className={CARD_SUB}>{lock.detail}</div>
            </div>
          </div>
        )
      })}
    </SettingsCard>
  )
}
