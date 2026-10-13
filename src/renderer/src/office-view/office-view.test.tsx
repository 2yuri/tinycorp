import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  KEEP_AWAKE_DEFAULT,
  KEEP_AWAKE_MODES,
  type KeepAwakeState,
  keepAwakeSummary,
} from '../../../shared/app/keep-awake'
import type { OfficeSprite } from '../../../shared/office/projection'
import { ControlDock, dockHint, isFocusShortcut } from './ControlDock'
import { officeHeaderFacts } from './header-facts'
import { MapControls } from './MapControls'
import mapControlsSource from './MapControls.tsx?raw'
import { AtWorkBadge, OfficeActions, officeSubtitle } from './OfficeHeader'

const noop = () => {}

function sprites(names: string[]): OfficeSprite[] {
  return names.map((name) => ({
    employeeId: name,
    name,
    title: 'Engineer',
    sprite: 0,
    state: 'working',
    reason: 'Working',
    withIds: [],
    seat: { uid: name, x: 0, y: 0, facing: 'down', visitor: { x: 10, y: 0, facing: 'left' }, occluders: [] },
  }))
}

function header(names: string[], capacity = { running: 2, concurrencyCap: 5 }, paused = false) {
  const facts = officeHeaderFacts(sprites(names))
  const html = renderToStaticMarkup(
    <>
      <h1>Acme</h1>
      <AtWorkBadge atWork={facts.atWork} />
      <p>{officeSubtitle('Acme', facts)}</p>
      <OfficeActions
        floor="Acme"
        facts={facts}
        capacity={capacity}
        canPause={capacity.running > 0}
        onPauseAll={noop}
        paused={paused}
        onResumeAll={noop}
        onHire={noop}
      />
    </>,
  )
  return {
    html,
    text: html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }
}

describe('OfficeHeader', () => {
  it('names the floor after the Company and counts from the office', () => {
    const { text } = header(['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'])
    expect(text).toContain('Acme 6 at work')
    expect(text).toContain('Acme · 6 Employees at their desks')
    expect(text).toContain('2 / 5 Sessions running')
  })

  it('says the room is full when the Company outgrew it, so the boss knows to pick a bigger one', () => {
    const facts = officeHeaderFacts([
      ...sprites(['Ada', 'Bo']),
      ...sprites(['Cy']).map(({ seat: _, ...rest }) => ({ ...rest, reason: 'Waiting for a desk' })),
    ])
    const text = renderToStaticMarkup(<p>{officeSubtitle('Acme', facts)}</p>).replace(/<[^>]+>/g, '')

    expect(text).toContain('Room full · 1 waiting for a desk')
    expect(header(['Ada', 'Bo']).text).not.toContain('Room full')
  })

  it('says how many are waiting on the boss, which is what the menu bar says too (T117)', () => {
    const waiting = sprites(['Ada', 'Bo']).map((sprite, i) =>
      i === 0 ? { ...sprite, state: 'waiting' as const, reason: 'Waiting on you', bubble: '!' as const } : sprite,
    )
    const text = renderToStaticMarkup(<p>{officeSubtitle('Acme', officeHeaderFacts(waiting))}</p>).replace(
      /<[^>]+>/g,
      '',
    )

    expect(text).toContain('1 waiting on you')
    expect(header(['Ada', 'Bo']).text).not.toContain('waiting on you')
  })

  it('stacks four avatars and the rest as +N', () => {
    const { html } = header(['Ada Lorne', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'])
    expect(html.match(/data-ui="Avatar"/g)).toHaveLength(5)
    expect(html).toContain('>AL<')
    expect(html).toContain('>+2<')
  })

  it('has the designed actions, with Pause all off while nothing runs', () => {
    const { html, text } = header(['Ada'], { running: 0, concurrencyCap: 3 })
    expect(text).toContain('Pause all Hire Employee')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Pause all/)
    expect(html).not.toContain('aria-label="More"')
  })

  it('reads Resume all with a play icon while paused, with no Session running', () => {
    const { html, text } = header(['Ada'], { running: 0, concurrencyCap: 3 }, true)
    expect(text).toContain('0 / 3 Sessions running')
    expect(text).toContain('Resume all Hire Employee')
    expect(text).not.toContain('Pause all')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*?Resume all/)
    expect(html).toMatch(/lucide-play[\s\S]*?Resume all/)
  })
})

describe('MapControls', () => {
  const asleep: KeepAwakeState = { mode: 'working', holding: false, supported: true }

  function dock(keepAwake: KeepAwakeState) {
    return renderToStaticMarkup(
      <MapControls fullscreen={false} onFullscreen={noop} keepAwake={keepAwake} onKeepAwake={noop} />,
    )
  }

  it('offers the cup and full screen only: the office is not zoomable', () => {
    const html = dock(asleep)
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])
    expect(labels).toEqual(['Office', 'Keep this Mac awake — Working · not holding', 'Full screen'])
    expect(html).not.toContain('%')
  })

  it('lights the cup while the Mac is held awake, and greys it when it is not (T99)', () => {
    // The attribute, not the word: the cup's class list names `data-holding:` as its variant.
    expect(dock(asleep)).not.toContain('data-holding="true"')
    const holding = dock({ ...asleep, holding: true })
    expect(holding).toMatch(
      /aria-haspopup="menu"[\s\S]*?data-holding="true"|data-holding="true"[\s\S]*?aria-haspopup="menu"/,
    )
    expect(holding).toContain('Keep this Mac awake — Working · holding')
  })

  it('leaves the cup out where there is no Mac to keep awake', () => {
    const html = dock({ ...asleep, supported: false })
    expect(html).not.toContain('aria-haspopup="menu"')
    expect([...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual(['Office', 'Full screen'])
  })

  it('names the three modes the design lists, in its order', () => {
    expect(KEEP_AWAKE_MODES.map((entry) => entry.title)).toEqual(['On', 'While anyone is working', 'Off'])
    expect(KEEP_AWAKE_DEFAULT).toBe('working')
    expect(keepAwakeSummary({ mode: 'on', holding: true, supported: true })).toBe('On · holding')
    expect(keepAwakeSummary({ mode: 'off', holding: false, supported: true })).toBe('Off · not holding')
  })

  it("names the mode in the header by a word of the mode's own title, as design/screens/sMIWE.png does (T159)", () => {
    for (const entry of KEEP_AWAKE_MODES) {
      expect(entry.title.split(' ').map((word) => word.toLowerCase())).toContain(entry.short.toLowerCase())
    }
    expect(keepAwakeSummary({ mode: 'working', holding: true, supported: true })).toBe('Working · holding')
  })

  it('draws every radio dot at one 8px diameter in one column, chosen or not (T159)', () => {
    // One class list for all three dots, so there is one diameter and one column by construction.
    const dot = /^const DOT =\s*\n?\s*'([^']*)'/m.exec(mapControlsSource)?.[1] ?? ''

    expect(dot).toContain('h-8')
    expect(dot).toContain('w-8')
    // The chosen dot only changes its ink: a size or a margin here would give the column two dots.
    const chosen = dot.split(/\s+/).filter((one) => one.startsWith('in-data-chosen:'))
    expect(chosen).toEqual(['in-data-chosen:border-transparent', 'in-data-chosen:bg-brand-success'])
  })
})

describe('ControlDock', () => {
  it('has the prompt, the ⌘K hint and a send button that names the answerer', () => {
    const html = renderToStaticMarkup(<ControlDock answererName="Pat" onSubmit={async () => true} />)
    expect(html).toContain('placeholder="Assign a task to the team…"')
    expect(html).toContain('⌘K')
    expect(html).toContain('title="Goes to Pat, who answers you"')
    expect(html).toMatch(/type="submit"[^>]*aria-label="Send to Pat"/)
  })

  it('says why it cannot send when the Company has nobody', () => {
    expect(dockHint(null)).toMatch(/^Nobody is hired yet/)
    const html = renderToStaticMarkup(<ControlDock answererName={null} onSubmit={async () => true} />)
    expect(html).toMatch(/type="submit"[^>]*disabled=""/)
  })

  it('focuses on ⌘K or Ctrl+K only', () => {
    const key = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
    expect(isFocusShortcut({ ...key, key: 'k', metaKey: true })).toBe(true)
    expect(isFocusShortcut({ ...key, key: 'K', ctrlKey: true })).toBe(true)
    expect(isFocusShortcut({ ...key, key: 'k' })).toBe(false)
    expect(isFocusShortcut({ ...key, key: 'k', metaKey: true, shiftKey: true })).toBe(false)
  })
})

describe('switching the room', () => {
  it('keeps the same stage: the painting is swapped, the canvas is not remounted', () => {
    const view = readFileSync(join(import.meta.dirname, 'OfficeView.tsx'), 'utf8')
    const office = readFileSync(join(import.meta.dirname, '../office/Office.tsx'), 'utf8')
    // A key on <Office> threw the canvas away on every room change, which is what flickered.
    expect(view).not.toMatch(/<Office[^>]*\skey=/s)
    expect(office).toContain('setTextures(next: OfficeTextures): void')
    expect(office).toMatch(/const key = `\$\{scene\.room\}/)
    // And a scene from another Company waits for its own painting instead of landing on this one.
    expect(office).toContain('if (painted.current !== props.scene.room) return')
  })
})

describe('the painting and the room', () => {
  it('marks the room the textures were loaded for, not whatever arrived meanwhile', () => {
    const office = readFileSync(join(import.meta.dirname, '../office/Office.tsx'), 'utf8')
    // A Company whose room changed while the stage was still building used to keep the first
    // painting and claim it was the new room, so the wrong floor carried the new team.
    expect(office).toContain('const mounted = latest.current.scene.room')
    expect(office).toContain('painted.current = mounted')
    expect(office).toMatch(/\}, \[room, live\]\)/)
  })
})
