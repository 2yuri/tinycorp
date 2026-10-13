import { Container, Graphics } from 'pixi.js'
import { doorDepth, doorPanels, doorWalls } from '../../../shared/office/doors'
import type { PaintedWall, Point } from '../../../shared/office/layout'

/**
 * Colours of the painted glass front, sampled from `design/office/empty-room.png`:
 * the panes read as a pale blue over whatever is behind them, the frame as the room's darkest navy.
 */
const GLASS = { pane: 0xa7c0d2, paneAlpha: 0.46, sheen: 0xdfeaf2, frame: 0x161d2e, stile: 5 }
/** The gap the panels leave, darkened a touch so an open door reads as a way through and not as glass. */
const THRESHOLD = { fill: 0x0d1421, alpha: 0.5 }
/** How much of the slide the panels take to fade in: the painting already draws the door shut. */
const FADE_IN = 0.3

/** A door on the stage: two glass panels over the painting, slid by `set`. */
export interface DoorNode {
  /** The wall this door is in. */
  name: string
  /** Add this to the world; its `zIndex` sorts it against the walkers. */
  node: Container
  /** Slides the panels: 0 shut, 1 fully open. */
  set(open: number): void
}

/** A door for every wall that has one, in the order the room lists its walls. */
export function createDoors(walls: readonly PaintedWall[]): DoorNode[] {
  return doorWalls(walls).map(createDoor)
}

/**
 * The sliding door of one wall, drawn over the painting in the world's own layer.
 * Its depth is the bottom of its gap, so whoever stands outside the door passes in front of the glass
 * and whoever is in the meeting room stays behind it. A shut door is hidden: the painting draws that.
 */
export function createDoor(wall: PaintedWall): DoorNode {
  const gap = wall.door!
  const node = new Container()
  node.zIndex = doorDepth(wall)
  const threshold = new Graphics()
    .poly(face(gap.from, gap.to, wall.height))
    .fill({ color: THRESHOLD.fill, alpha: THRESHOLD.alpha })
  node.addChild(threshold)

  const panels = doorPanels(wall).map((panel) => {
    const art = pane(panel.shut)
    node.addChild(art)
    return { art, slide: panel.slide }
  })

  return {
    name: wall.name,
    node,
    set(open) {
      const amount = Math.min(1, Math.max(0, open))
      node.visible = amount > 0
      node.alpha = Math.min(1, amount / FADE_IN)
      for (const { art, slide } of panels) art.position.set(slide.x * amount, slide.y * amount)
    },
  }
}

/** The quad a stretch of wall foot stands in: `height` px up from `a`→`b`, top-left first. */
function face(a: Point, b: Point, height: number): Point[] {
  return [
    { x: a.x, y: a.y - height },
    { x: b.x, y: b.y - height },
    { x: b.x, y: b.y },
    { x: a.x, y: a.y },
  ]
}

/** One sliding pane: glass with a dark stile down each edge, as the painting draws the fixed panels. */
function pane(quad: Point[]): Graphics {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad as [Point, Point, Point, Point]
  const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y)
  const lerp = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  /** The upright strip of the pane between two fractions of its width. */
  const strip = (from: number, to: number) => [
    lerp(topLeft, topRight, from),
    lerp(topLeft, topRight, to),
    lerp(bottomLeft, bottomRight, to),
    lerp(bottomLeft, bottomRight, from),
  ]
  const edge = GLASS.stile / width
  return new Graphics()
    .poly(quad)
    .fill({ color: GLASS.pane, alpha: GLASS.paneAlpha })
    .poly(strip(edge, edge * 3))
    .fill({ color: GLASS.sheen, alpha: 0.24 })
    .poly(strip(0, edge))
    .fill(GLASS.frame)
    .poly(strip(1 - edge, 1))
    .fill(GLASS.frame)
}
