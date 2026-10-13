import { describe, expect, it } from 'vitest'
import { parseMaxHeadcount } from './HeadcountSetting'

describe('parseMaxHeadcount', () => {
  it('reads blank as unlimited and a whole number from 1 as the maximum', () => {
    expect(parseMaxHeadcount('  ')).toEqual({ ok: true, max: null })
    expect(parseMaxHeadcount('12')).toEqual({ ok: true, max: 12 })
  })

  it('refuses anything else', () => {
    for (const bad of ['0', '-3', '2.5', 'ten']) expect(parseMaxHeadcount(bad)).toEqual({ ok: false })
  })
})
