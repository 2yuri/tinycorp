import { describe, expect, it } from 'vitest'
import { inside } from './layout'
import { LOGO_MARGIN, logoCorners, logoSurface, pointIn } from './logo-spots'
import type { Quad } from './painted-room'
import { ROOM_SLUGS, roomGeometry } from './rooms'

/** A flat 100×50 surface with no perspective, where every fraction is easy to read. */
const flat: Quad = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
]

describe('fitting a logo on a surface (T280)', () => {
  it('reads a point by its fractions, perspective and all', () => {
    expect(pointIn(flat, 0.5, 0.5)).toEqual({ x: 50, y: 25 })
    const skewed: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 50 },
    ]
    expect(pointIn(skewed, 1, 0.5)).toEqual({ x: 100, y: 75 })
  })

  it('centres a logo as wide as the surface inside the margin', () => {
    const rounded = logoCorners(flat, 2).map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))
    expect(rounded).toEqual([
      { x: 10, y: 5 },
      { x: 90, y: 5 },
      { x: 90, y: 45 },
      { x: 10, y: 45 },
    ])
  })

  it('never stretches a logo: a square one on a wide surface keeps its shape', () => {
    const [topLeft, topRight, , bottomLeft] = logoCorners(flat, 1)
    const width = topRight.x - topLeft.x
    const height = bottomLeft.y - topLeft.y
    expect(width).toBeCloseTo(height)
    expect(height).toBeCloseTo(50 * LOGO_MARGIN)
  })

  it('puts a plaque’s logo on its face, not across the whole plaque', () => {
    const face = logoSurface({
      corners: flat,
      plaque: { art: 'x.png', face: { left: 0.1, top: 0.5, right: 0.9, bottom: 1 } },
    })
    expect(face[0]).toEqual({ x: 10, y: 25 })
    expect(face[2]).toEqual({ x: 90, y: 50 })
  })
})

describe('every room has somewhere for the logo (T280)', () => {
  it('on its walls, inside the painting and off the floor people walk on', () => {
    for (const slug of ROOM_SLUGS) {
      const room = roomGeometry(slug)
      expect(room.logo.length, slug).toBeGreaterThan(0)
      for (const spot of room.logo) {
        for (const corner of spot.corners) {
          expect(corner.x >= 0 && corner.x <= room.width && corner.y >= 0 && corner.y <= room.height, slug).toBe(true)
          expect(inside(corner, room.floor), `${slug} at ${corner.x},${corner.y}`).toBe(false)
        }
      }
    }
  })
})
