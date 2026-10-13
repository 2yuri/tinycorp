/**
 * Where the counter's own line is written (T100): across the middle of the queue, under the feet of
 * whoever stands nearest the viewer, and never off the painting.
 */
import { describe, expect, it } from 'vitest'
import { officeLayout } from '../../../shared/office/layout'
import { roomGeometry } from '../../../shared/office/rooms'
import { counterLabelSpot } from './counter-label'

describe('the counter label’s spot', () => {
  it('sits across the middle of the queue, under the one standing nearest the viewer', () => {
    const spots = [
      { x: 822, y: 440 },
      { x: 798, y: 526 },
      { x: 822, y: 478 },
    ]

    expect(counterLabelSpot(spots)).toEqual({ x: 810, y: 532 })
  })

  it('stays inside the painting where the corner reaches its edge', () => {
    expect(counterLabelSpot([{ x: 100, y: 655 }], 660).y).toBe(646)
  })

  it('is under every stander in every room’s coffee corner, and on the painting', () => {
    for (const slug of [
      'night-studio',
      'warm-loft',
      'scandi-daylight',
      'night-shift',
      'greenhouse',
      'garage-startup',
      'night-city',
    ] as const) {
      const layout = officeLayout(roomGeometry(slug))
      const at = counterLabelSpot(layout.coffee, layout.painting.height)

      expect(at.y, slug).toBeLessThanOrEqual(layout.painting.height)
      expect(at.x, slug).toBeGreaterThanOrEqual(Math.min(...layout.coffee.map((s) => s.x)))
      expect(at.x, slug).toBeLessThanOrEqual(Math.max(...layout.coffee.map((s) => s.x)))
    }
  })
})
