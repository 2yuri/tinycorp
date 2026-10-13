import { describe, expect, it } from 'vitest'
import { cx, SHELL_BUTTON } from '../ui'
import usageSource from './UsageButton.tsx?raw'

/**
 * The drawer's Usage row carries the frame's rule above it (`AAI0w`, `strokeWidth: {top: 1}`), and
 * for a while it did not: the bare-button reset takes the border off every button that carries it,
 * it won a tie on load order, and it was loaded after this file — so the line went missing from the
 * drawer of every screen (T196).
 *
 * It is a class list rather than a rule since T216, and `cx` is what keeps the row's own border:
 * the caller's classes go last, so the reset can no longer take one off.
 */
describe('the bare button reset', () => {
  it('is a class list a screen can out-write, not a rule it has to out-weigh', () => {
    expect(SHELL_BUTTON).toContain('border-0')
    expect(cx(SHELL_BUTTON, 'border-t border-t-border')).toContain('border-t-border')
  })

  it('leaves the frame’s rule over the drawer’s Usage row', () => {
    const row = /^const BUTTON =\s*\n?\s*'([^']*)'/m.exec(usageSource)?.[1] ?? ''
    expect(row).toContain('border-t')
    expect(row).toContain('border-t-border')
  })
})
