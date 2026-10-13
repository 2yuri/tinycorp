import { AlarmClock, Hash } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Channel } from '../../../shared/domain/chat'
import {
  DAY_CHIPS,
  type DigestSchedule,
  type DigestScheduleUpdate,
  daysPreset,
} from '../../../shared/planning/daily-digest'
import { machineWordsHere } from '../chrome'
import { ChipToggleGroup, cx, Select, SettingsCard, SettingsRow, Toggle } from '../ui'
import '../ui/tailwind.css'
import { DIGEST_DAYS, DIGEST_ERROR, FIELD, FIELD_TEXT, LABEL, ROW } from './settings-classes'

const api = window.tinyCorp

/** Every half hour of the day, which is as fine as a digest time needs to be. */
export function timeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    options.push({ value: time, label: time })
  }
  return options
}

/** The chosen time, plus the saved one when the boss set something off the half hour. */
export function timeChoices(time: string): { value: string; label: string }[] {
  const options = timeOptions()
  return options.some((option) => option.value === time) ? options : [{ value: time, label: time }, ...options]
}

/**
 * Daily digest (T172, frame `b9EZF`): whether it posts, at what time, in which channel, on which
 * days, and whether it also rings. It saves as it changes, like Who answers you and the maximum
 * headcount — a schedule is not a draft.
 */
export function DailyDigestSetting() {
  const [schedule, setSchedule] = useState<DigestSchedule | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [saved, list] = await Promise.all([api.digest.schedule(), api.chat.channels()])
    if (!saved.ok) return setError(saved.error)
    setError(null)
    setSchedule(saved.value)
    if (list.ok) setChannels(list.value.filter((channel) => channel.kind === 'channel'))
  }, [])

  useEffect(() => {
    void refresh()
    const offs = [api.digest.onChanged(() => void refresh()), api.chat.onChanged(() => void refresh())]
    return () => {
      for (const off of offs) off()
    }
  }, [refresh])

  if (!schedule) return null

  async function change(update: DigestScheduleUpdate) {
    const result = await api.digest.setSchedule(update)
    if (!result.ok) return setError(result.error)
    setError(null)
    setSchedule(result.value)
  }

  function toggleDay(day: number) {
    const days = schedule!.days.includes(day) ? schedule!.days.filter((d) => d !== day) : [...schedule!.days, day]
    void change({ days })
  }

  const off = !schedule.enabled
  return (
    <SettingsCard
      title="Daily digest"
      sub="TinyCorp posts what shipped, what waits on you and today’s usage. The app writes it, not an Employee — it spends no usage."
      control={
        <Toggle
          label={null}
          aria-label="Daily digest"
          checked={schedule.enabled}
          onChange={(event) => void change({ enabled: event.target.checked })}
        />
      }
    >
      {error && <p className={DIGEST_ERROR}>{error}</p>}
      <div className={ROW}>
        <Select
          className={cx(FIELD, FIELD_TEXT)}
          label="Time"
          icon={AlarmClock}
          value={schedule.time}
          disabled={off}
          options={timeChoices(schedule.time)}
          onChange={(event) => void change({ time: event.target.value })}
        />
        <Select
          className={cx(FIELD, FIELD_TEXT)}
          label="Where"
          icon={Hash}
          value={schedule.channelId}
          disabled={off}
          options={channels.map((channel) => ({ value: channel.id, label: channel.name }))}
          onChange={(event) => void change({ channelId: event.target.value })}
        />
      </div>
      <div className={DIGEST_DAYS}>
        <span className={LABEL}>Days · {daysPreset(schedule.days)}</span>
        <ChipToggleGroup
          label="Days"
          options={DAY_CHIPS.map((chip) => ({ value: chip.day, label: chip.label }))}
          selected={schedule.days}
          disabled={off}
          onToggle={toggleDay}
        />
      </div>
      <SettingsRow
        title="Also notify me"
        sub={`A native notification on ${machineWordsHere().machine} when the digest posts.`}
      >
        <Toggle
          label={null}
          aria-label="Also notify me"
          checked={schedule.notify}
          disabled={off}
          onChange={(event) => void change({ notify: event.target.checked })}
        />
      </SettingsRow>
    </SettingsCard>
  )
}
