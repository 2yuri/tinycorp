import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { betweenColleagues, DEFAULT_COLLEAGUE_VOICE, voiceHint } from '../../shared/colleague-voice'
import { BOSS, dmChannelId } from '../../shared/domain/chat'
import { createVoiceSettings } from './colleague-voice'
import { migrate } from './engine/migrations'

/** An empty Company database with every migration applied, the setting's own among them. */
function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

describe('The Company’s colleague voice', () => {
  it('is terse until the boss says otherwise, including in a Company made before the setting', () => {
    expect(createVoiceSettings(database()).colleagueVoice()).toBe('terse')
    expect(DEFAULT_COLLEAGUE_VOICE).toBe('terse')
  })

  it('round-trips through the migration’s one row, and keeps only the last value', () => {
    const db = database()
    const voice = createVoiceSettings(db)

    expect(voice.setColleagueVoice('plain')).toBe('plain')
    expect(voice.colleagueVoice()).toBe('plain')
    voice.setColleagueVoice('terse')

    expect(voice.colleagueVoice()).toBe('terse')
    expect(db.prepare('SELECT COUNT(*) AS n FROM voice_setting').get()).toMatchObject({ n: 1 })
  })

  it('reads back as terse rather than refusing when the row holds something this build forgot', () => {
    const db = database()
    db.prepare(`INSERT INTO voice_setting (id, colleague_voice) VALUES (1, 'telegraphic')`).run()

    expect(createVoiceSettings(db).colleagueVoice()).toBe('terse')
  })

  it('refuses a voice it does not know rather than writing it', () => {
    const voice = createVoiceSettings(database())

    expect(() => voice.setColleagueVoice('shouty' as never)).toThrow(/Unknown colleague voice/)
    expect(voice.colleagueVoice()).toBe('terse')
  })

  it('tells one change apart from the next', () => {
    let changes = 0
    const voice = createVoiceSettings(database(), () => changes++)

    voice.setColleagueVoice('plain')
    voice.setColleagueVoice('terse')

    expect(changes).toBe(2)
  })
})

describe('Who is on the other side of a channel', () => {
  it('is two colleagues only in a DM neither the boss is in', () => {
    expect(betweenColleagues(dmChannelId('emp-1', 'emp-2'), BOSS)).toBe(true)
    expect(betweenColleagues(dmChannelId(BOSS, 'emp-1'), BOSS)).toBe(false)
    expect(betweenColleagues(dmChannelId('emp-1', BOSS), BOSS)).toBe(false)
    expect(betweenColleagues('general', BOSS)).toBe(false)
    expect(betweenColleagues('ep-login', BOSS)).toBe(false)
  })
})

describe('The voice hint a wake carries', () => {
  const colleagues = dmChannelId('emp-1', 'emp-2')

  it('asks for terse in a colleague DM, and names what terse never shortens', () => {
    const hint = voiceHint(colleagues, 'terse')

    expect(hint).toContain('Colleague DM')
    expect(hint).toContain('terse')
    expect(hint).toMatch(/code, paths, numbers and error text exact/)
    expect(hint).toMatch(/full sentences for a warning, a destructive step or a question/)
  })

  it('asks for plain words everywhere the boss reads, whatever the Company set', () => {
    for (const voice of ['terse', 'plain'] as const) {
      for (const channelId of ['general', 'tech', 'ep-login', dmChannelId(BOSS, 'emp-1')]) {
        expect(voiceHint(channelId, voice)).toBe('The boss can read this → plain words, full sentences.')
      }
    }
  })

  it('asks for plain words in a colleague DM too once the Company is on Plain', () => {
    expect(voiceHint(colleagues, 'plain')).toBe('The boss can read this → plain words, full sentences.')
    expect(voiceHint(colleagues, 'plain')).not.toContain('terse')
  })
})
