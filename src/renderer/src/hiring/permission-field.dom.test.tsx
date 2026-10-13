// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PERMISSION_CHOICE_LABEL,
  PERMISSION_DEFAULT_HELP,
  PERMISSION_HELP,
  PERMISSION_HIRE_HELP,
  type PermissionMode,
} from '../../../shared/domain/staff'
import { PermissionField } from './modal-fields'

/**
 * PERMISSIONS, the field frames `XJxrZ`, `PGtFO` and `V0AWNP` all draw: two chips and a line under
 * them. It is one control on three screens, so this is where its behaviour is pinned; each screen's
 * own test says where it sits and which line it carries.
 *
 * The chips carry the boss's words. No screen may name a CLI flag — `no-provider-names.test.ts`
 * enforces that, and what either choice puts on a command line is the adapter's business.
 */

// React only drives effects inside `act` when the environment says it is a test one.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function draw(value: PermissionMode, help: string) {
  const picked: PermissionMode[] = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(<PermissionField value={value} help={help} onChange={(mode) => picked.push(mode)} />)
  })
  return { picked, host: host! }
}

const chips = (host: HTMLElement) => [...host.querySelectorAll<HTMLLabelElement>('[data-ui="Chip"]')]
/** The control under each chip: the chip is the frame's box, the radio is what a keyboard sees. */
const radios = (host: HTMLElement) => [...host.querySelectorAll<HTMLInputElement>('[data-ui="Chip"] > input')]

describe('the PERMISSIONS field', () => {
  it('offers both choices in the frame’s words, with the one in force checked', () => {
    const { host } = draw('skip-permissions', PERMISSION_HELP['skip-permissions'])

    expect(chips(host).map((chip) => chip.textContent)).toEqual([
      PERMISSION_CHOICE_LABEL['skip-permissions'],
      PERMISSION_CHOICE_LABEL.interactive,
    ])
    expect(radios(host).map((radio) => radio.checked)).toEqual([true, false])
  })

  it('is one radio group, so a screen reader reads it as a choice and not two switches', () => {
    const { host } = draw('interactive', PERMISSION_HELP.interactive)

    const group = host.querySelector('[role="radiogroup"]')!
    expect(host.querySelector(`#${group.getAttribute('aria-labelledby')}`)?.textContent).toBe('PERMISSIONS')
    expect(radios(host).every((radio) => radio.type === 'radio')).toBe(true)
    expect(new Set(radios(host).map((radio) => radio.name)).size).toBe(1)
    expect(radios(host).map((radio) => radio.checked)).toEqual([false, true])
  })

  it('hands back the choice the boss pressed', () => {
    const { picked, host } = draw('skip-permissions', PERMISSION_HELP['skip-permissions'])

    act(() => chips(host)[1]!.click())

    expect(picked).toEqual(['interactive'])
  })

  it('carries the line its own screen gives it, and never invents one', () => {
    for (const line of [PERMISSION_HELP['skip-permissions'], PERMISSION_HIRE_HELP, PERMISSION_DEFAULT_HELP]) {
      const { host } = draw('skip-permissions', line)
      expect(host.querySelector('[data-ui="Field Help"]')?.textContent).toBe(line)
      act(() => root!.unmount())
      host.remove()
      root = null
    }
  })

  it('names no CLI flag anywhere the boss can read: the words are about the Session, not the argv', () => {
    const { host } = draw('skip-permissions', PERMISSION_HELP['skip-permissions'])

    expect(host.textContent).not.toContain('--')
  })
})
