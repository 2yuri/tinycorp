// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { COLLEAGUE_VOICE_HELP, type ColleagueVoice, VOICE_EXAMPLE } from '../../../shared/colleague-voice'

/**
 * One bridge for the whole file: the view module reads `window.tinyCorp` when it is imported, so
 * the object stays put and only its answers move (see `routing.test.tsx`).
 */
let saved: ColleagueVoice = 'terse'
let calls: ColleagueVoice[] = []

Object.assign(window, {
  tinyCorp: {
    voice: {
      colleague: () => Promise.resolve({ ok: true as const, value: saved }),
      setColleague: (voice: ColleagueVoice) => {
        calls.push(voice)
        saved = voice
        return Promise.resolve({ ok: true as const, value: voice })
      },
      onChanged: () => () => {},
    },
  },
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLElement | null = null
afterEach(() => {
  host?.remove()
  host = null
})

async function mount(voice: ColleagueVoice) {
  saved = voice
  calls = []
  const { ColleagueVoiceCard } = await import('./ColleagueVoiceCard')
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<ColleagueVoiceCard />)
  })
  return host
}

const button = (label: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!

describe('How Employees talk (frame L0glbm, right column)', () => {
  it('draws the segments with the saved one pressed, and its help line under them', async () => {
    await mount('terse')

    expect(button('Terse').getAttribute('aria-pressed')).toBe('true')
    expect(button('Plain').getAttribute('aria-pressed')).toBe('false')
    expect(host!.textContent).toContain(COLLEAGUE_VOICE_HELP.terse)
    expect(host!.textContent).not.toContain(COLLEAGUE_VOICE_HELP.plain)
  })

  it('saves the moment the boss picks the other one, without a Save changes', async () => {
    await mount('terse')

    await act(async () => button('Plain').click())

    expect(calls).toEqual(['plain'])
    expect(button('Plain').getAttribute('aria-pressed')).toBe('true')
    expect(host!.textContent).toContain(COLLEAGUE_VOICE_HELP.plain)
  })

  it('shows the same news twice, as the fixed illustration the frame draws', async () => {
    await mount('terse')

    expect(host!.textContent).toContain('The same news, twice')
    expect(host!.textContent).toContain(VOICE_EXAMPLE.terse.text)
    expect(host!.textContent).toContain(VOICE_EXAMPLE.plain.text)
    expect(host!.textContent).toContain('24 tokens')
    expect(host!.textContent).toContain('41 tokens')
  })

  it('says what the setting does not reach, and offers no control for it', async () => {
    await mount('plain')

    expect(host!.textContent).toContain('To you: always plain words')
    expect(host!.textContent).toContain('Not a setting.')
    expect(host!.textContent).toContain('Always full sentences')
    // Two segments and nothing else: the locked rows are text, never a switch.
    expect(host!.querySelectorAll('button')).toHaveLength(2)
    expect(host!.querySelectorAll('input')).toHaveLength(0)
  })
})
