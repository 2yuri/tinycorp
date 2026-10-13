import { describe, expect, it } from 'vitest'
import { railMarks } from './rail-marks'

describe('railMarks (T145)', () => {
  it('draws nothing for a Company that is not open', () => {
    expect(railMarks('Acme', undefined)).toEqual({ badge: null, working: false, label: 'Acme' })
  })

  it('draws nothing for an open Company with nothing waiting and nobody working', () => {
    expect(railMarks('Acme', { companyId: 'c1', waiting: 0, working: false })).toEqual({
      badge: null,
      working: false,
      label: 'Acme',
    })
  })

  it('prints the waiting count, and 9+ past nine so it fits the tile’s corner', () => {
    expect(railMarks('Acme', { companyId: 'c1', waiting: 3, working: false }).badge).toBe('3')
    expect(railMarks('Acme', { companyId: 'c1', waiting: 9, working: false }).badge).toBe('9')
    expect(railMarks('Acme', { companyId: 'c1', waiting: 12, working: false }).badge).toBe('9+')
  })

  it('says both marks in the tile’s name, the full count included', () => {
    expect(railMarks('Acme', { companyId: 'c1', waiting: 12, working: true })).toEqual({
      badge: '9+',
      working: true,
      label: 'Acme, 12 waiting on you, working',
    })
  })
})
