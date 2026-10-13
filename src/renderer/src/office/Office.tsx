import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
// Pixi compiles shaders with `new Function` unless this is loaded; the CSP forbids eval.
import 'pixi.js/unsafe-eval'
import {
  Application,
  Assets,
  Container,
  Graphics,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextureSource,
} from 'pixi.js'
import { bossAtDesk } from '../../../shared/office/boss'
import { BUBBLE_STYLE, type BubbleGlyph, bubbleFor } from '../../../shared/office/bubbles'
import { type DoorStates, doorState } from '../../../shared/office/doors'
import {
  type Facing,
  type OfficeLayout,
  type Point,
  type Spot,
  walkable,
  walkPath,
} from '../../../shared/office/layout'
import { logoCorners, logoSurface } from '../../../shared/office/logo-spots'
import type { Quad } from '../../../shared/office/painted-room'
import type { OfficeScene, OfficeSprite, SpriteState } from '../../../shared/office/projection'
import { type RoomSlug, roomOf } from '../../../shared/office/rooms'
import { AWAY_TAG_DROP, FLOOR_GUTTER } from './away-tag'
import { type BossNode, createBoss } from './boss-node'
import { BUBBLE_LIFT, BUBBLE_SCALE, type BubbleShape, bubbleBox, bubbleTip } from './bubble-box'
import { CHARACTER_SCALE, type CharacterFrames, loadCharacters, type Pose } from './characters'
import { type CounterLabelNode, createCounterLabel } from './counter-label'
import { floorText, TEXT_RES } from './floor-text'
import { awayKey, bubbleObstacle, CHAIR_LABEL_MARGIN, chairKey, chairLabelSpot, floorLabelBoxes } from './label-boxes'
import { type FloorLabel, layOutLabels } from './label-layout'
import { loadMarkers, type MarkerFrames } from './markers'
import { createMeetingLabel, type MeetingLabelNode } from './meeting-label'
import { createDoors, type DoorNode } from './office-door'
import { createShadow } from './shadow'
import { floorLabels } from './sprite-tag'
import '../ui/tailwind.css'

TextureSource.defaultOptions.scaleMode = 'nearest'
// Worker-based loading needs blob: workers, which the CSP does not allow.
Assets.setPreferences({ preferWorkers: false })

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const WHEEL_STEP = 1.15
/** Painting pixels per second. */
const WALK_SPEED = 70
const ASSET_BASE = './office/'
const TOP = 1e6

/** How far over the boss's seat their count bubble floats, in painting pixels: clear of the emerald. */
const BOSS_BUBBLE_LIFT = 96
/** And how far to its left, so the bubble and the emerald do not share the same air. */
const BOSS_BUBBLE_ASIDE = 22

/** A chair whose owner is away keeps their name alone, dimmed: the desk is theirs, they are not on it. */
const CHAIR_TAG_DIM = 0.6
/** The glyph in the bubble's box, in painting pixels. */
const BUBBLE_FONT = 12
/** Clear air the glyph keeps inside the bubble's painted rim, in painting pixels. */
const BUBBLE_PAD = 8
/** Two tints over one sprite: multiply them channel by channel, as light and paint both do. */
function mixTint(light: number, state: number): number {
  const channel = (shift: number) => Math.round((((light >> shift) & 0xff) * ((state >> shift) & 0xff)) / 0xff) << shift
  return channel(16) | channel(8) | channel(0)
}

const STATE_TINT: Partial<Record<SpriteState, number>> = {
  starting: 0xc8c8d8,
}

interface OfficeTextures {
  room: Texture
  characters: CharacterFrames
  /** The emerald and the speech bubbles, off the marker sheet (T98). */
  markers: MarkerFrames
}

/** One load per painting: the stage is rebuilt when the Company picks another room (T83). */
const loading = new Map<string, Promise<OfficeTextures>>()

/** The marker sheet every room draws from: loaded once, whatever painting is on the stage. */
let markerSheet: Promise<MarkerFrames> | null = null

function loadSheets(): Promise<MarkerFrames> {
  markerSheet ??= loadMarkers(ASSET_BASE)
  return markerSheet
}

function loadTextures(slug: RoomSlug | string): Promise<OfficeTextures> {
  const { art } = roomOf(slug)
  let found = loading.get(art)
  if (!found) {
    found = (async () => {
      const [room, characters, markers] = await Promise.all([
        Assets.load<Texture>(`./${art}`),
        loadCharacters(ASSET_BASE),
        loadSheets(),
      ])
      return { room, characters, markers }
    })()
    loading.set(art, found)
  }
  return found
}

export interface OfficeProps {
  scene: OfficeScene
  /** The Company whose logo the room's walls carry (T280). */
  company?: { name: string; logo?: string | null | undefined }
  /** Called with the Employee whose sprite was clicked. */
  onSelect?(employeeId: string): void
  /** Called when the boss's own desk is clicked. */
  onBossDesk?(): void
  /** Called with the zoom (1 = one screen pixel per painting pixel) whenever it changes. */
  onZoom?(zoom: number): void
  /** Zoom controls for whoever draws them. */
  ref?: Ref<OfficeHandle>
}

export interface OfficeHandle {
  zoomIn(): void
  zoomOut(): void
  fit(): void
}

/**
 * The PixiJS office stage: the painted room with live sprites on its anchors.
 * Draws whatever `scene` the projection produced; drag to pan, wheel to zoom.
 * It fills its parent; zoom buttons are the parent's, through `ref`.
 */
export function Office(props: OfficeProps) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const stage = useRef<OfficeStage | null>(null)
  const latest = useRef(props)
  latest.current = props

  const [live, setLive] = useState(false)
  useEffect(() => {
    let cancelled = false
    let created: OfficeStage | null = null
    const ready = (async () => {
      // The room the textures belong to, not whatever the scene says by the time they arrive.
      const mounted = latest.current.scene.room
      const textures = await loadTextures(mounted)
      if (cancelled || !host.current) return
      created = await createStage(host.current, textures, {
        select: (id) => latest.current.onSelect?.(id),
        bossDesk: () => latest.current.onBossDesk?.(),
        zoom: (zoom) => latest.current.onZoom?.(zoom),
        moved: (x, y, zoom) => {
          if (overlay.current) overlay.current.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
        },
      })
      if (cancelled) return
      stage.current = created
      painted.current = mounted
      created.update(latest.current.scene)
      created.setLogo(latest.current.company?.logo ?? null)
      setLive(true)
    })()
    return () => {
      cancelled = true
      stage.current = null
      void ready.finally(() => created?.destroy())
    }
  }, [])

  const room = props.scene.room
  // The room the stage is actually painted with. Until the next one's texture is in, the stage keeps
  // showing the room it has: drawing another Company's people on the old painting is the flicker.
  const painted = useRef<string | null>(null)
  useEffect(() => {
    // `live` is in the deps so a room that changed while the stage was still being built is picked
    // up the moment it exists, instead of leaving the wrong painting under the new Company.
    if (!live || painted.current === room) return
    let cancelled = false
    void loadTextures(room).then((textures) => {
      if (cancelled || !stage.current) return
      stage.current.setTextures(textures)
      painted.current = room
      stage.current.update(latest.current.scene)
    })
    return () => {
      cancelled = true
    }
  }, [room, live])

  useEffect(() => {
    if (painted.current !== props.scene.room) return
    stage.current?.update(props.scene)
  }, [props.scene])

  const logo = props.company?.logo ?? null
  useEffect(() => {
    if (live) stage.current?.setLogo(logo)
  }, [logo, live])

  useImperativeHandle(
    props.ref,
    () => ({
      zoomIn: () => stage.current?.zoomBy(WHEEL_STEP),
      zoomOut: () => stage.current?.zoomBy(1 / WHEEL_STEP),
      fit: () => stage.current?.fit(),
    }),
    [],
  )

  return (
    // `leading-[0]` on the room, and `leading-normal` back on the overlay: the canvas is an inline
    // box, and a line box under it would leave a strip of card at the foot of the office.
    <div className="relative h-full w-full overflow-hidden leading-[0]" data-testid="office">
      {/* The canvas is dragged, not scrolled, so the browser's own panning never takes the gesture. */}
      <div className="h-full w-full touch-none [&_canvas]:cursor-grab" ref={host} />
      {/* Live parts drawn over the painting, moved with it: the stage sets the transform. */}
      <div className="pointer-events-none absolute top-0 left-0 origin-top-left leading-normal" ref={overlay} />
    </div>
  )
}

interface OfficeStage {
  /** Another room's painting, without tearing the canvas down. */
  setTextures(next: OfficeTextures): void
  /** The Company's logo as a `data:` URL, painted on the room's walls; null takes it off (T280). */
  setLogo(url: string | null): void
  update(scene: OfficeScene): void
  zoomBy(factor: number, at?: { x: number; y: number }): void
  fit(): void
  destroy(): void
}

interface StageActions {
  select(employeeId: string): void
  bossDesk(): void
  zoom(zoom: number): void
  /** The world moved: its top-left on screen and its zoom. */
  moved(x: number, y: number, zoom: number): void
}

/** A character on the stage, moving along a path in painting pixels. */
interface Walker {
  node: Container
  body: Sprite
  bubble: Container | null
  glyph: BubbleGlyph | null
  /** The drawing of that bubble, so the floor knows the air it takes and keeps labels out of it (T156). */
  bubbleShape: BubbleShape | null
  /** Under the Employee's own chair, whoever is on it: their whole tag, or their name alone while they are away. */
  tag: Text
  /** Under the sprite itself, a child of its node, so the status travels with the Employee (T94). */
  awayTag: Text
  sheet: number
  sprite: OfficeSprite
  x: number
  y: number
  path: Point[]
  goal: Spot
  facing: Facing
  clock: number
}

async function createStage(host: HTMLDivElement, loaded: OfficeTextures, actions: StageActions): Promise<OfficeStage> {
  // The painting can change under the same stage: swapping a texture keeps the canvas, so the room
  // never blinks white while another one loads (T93).
  let textures = loaded
  const app = new Application()
  // Transparent: the panel around the stage paints the background.
  await app.init({ backgroundAlpha: 0, antialias: false, resizeTo: host, roundPixels: true })
  host.prepend(app.canvas)

  const world = new Container({ sortableChildren: true })
  app.stage.addChild(world)
  /** The painting and its occluders: direct children of the world, so characters sort between them. */
  let roomNodes: Container[] = []
  let roomKey = ''
  let layout: OfficeLayout | null = null
  let grid: boolean[][] = []
  let bossBubble: Container | null = null
  /** `Meeting · N` over the glass room, on for as long as a meeting is (T94). */
  let meetingLabel: MeetingLabelNode | null = null
  /** `At the counter · N parked` over the coffee corner, on while anyone waits there (T100). */
  let counterLabel: CounterLabelNode | null = null
  /** The boss, seated at their own desk for as long as the Company is open (T86). */
  let boss: BossNode | null = null
  /** `Your chair` under the boss's own seat: painted with the room, so the people move around it (T105). */
  let bossChairTag: Text | null = null
  let doors: DoorNode[] = []
  let doorStates: DoorStates = {}
  let fitted = false
  /** The character Your profile last picked for the boss; a new room rebuilds their sprite with it. */
  let bossSheet = 0
  /** The Company's logo, and what the walls draw of it: redrawn whole whenever either changes (T280). */
  let logoUrl: string | null = null
  let logoNodes: Container[] = []
  /** The logo's own textures, made for these walls: the plaques' are the asset cache's and stay. */
  let logoTextures: Texture[] = []
  let logoDrawing = 0
  const walkers = new Map<string, Walker>()

  function place(x: number, y: number, zoom: number): void {
    world.scale.set(zoom)
    world.position.set(Math.round(x), Math.round(y))
    actions.moved(world.x, world.y, zoom)
  }

  // The room is fixed in its box (boss's call): no pan, no zoom — only a click, which the stage's
  // own nodes handle. The wheel is swallowed so a trackpad gesture cannot scroll the view either.
  const canvas = app.canvas
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
  }
  canvas.addEventListener('wheel', onWheel, { passive: false })
  const resize = new ResizeObserver(() => {
    app.resize()
    stage.fit()
  })
  resize.observe(host)

  /** A click that was not the end of a pan. */
  function onClick<T extends Container>(node: T, action: () => void): T {
    node.eventMode = 'static'
    node.cursor = 'pointer'
    node.on('pointertap', () => {
      action()
    })
    return node
  }

  /**
   * The Company's logo on the room's walls (T280), just over the painting and under everyone in it:
   * on each spot's own board, or on the plaque the room hangs there first. A drawing that a newer one
   * has overtaken — another room, another logo — puts nothing on the stage.
   */
  async function drawLogo(next: OfficeLayout): Promise<void> {
    const drawing = ++logoDrawing
    for (const node of logoNodes) node.destroy()
    for (const texture of logoTextures) texture.destroy(true)
    logoNodes = []
    logoTextures = []
    if (!logoUrl) return
    const url = logoUrl
    const image = await decoded(url).catch(() => null)
    if (!image || drawing !== logoDrawing) return
    for (const spot of next.logo) {
      if (spot.plaque) {
        const plaque = await Assets.load<Texture>(`./${spot.plaque.art}`)
        if (drawing !== logoDrawing) return
        logoNodes.push(onWall(plaque, spot.corners, 1))
      }
      const corners = logoCorners(logoSurface(spot), image.width / image.height)
      const texture = await wallTexture(image, span(corners))
      logoTextures.push(texture)
      logoNodes.push(onWall(texture, corners, 2))
      if (drawing !== logoDrawing) return
    }
  }

  function onWall(texture: Texture, corners: Quad, above: number): Container {
    const [a, b, c, d] = corners
    const mesh = new PerspectiveMesh({
      texture,
      verticesX: 8,
      verticesY: 8,
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
      x2: c.x,
      y2: c.y,
      x3: d.x,
      y3: d.y,
    })
    mesh.zIndex = -TOP + above
    world.addChild(mesh)
    return mesh
  }

  function buildRoom(next: OfficeLayout): void {
    for (const node of roomNodes) node.destroy({ children: true })
    roomNodes = []
    const add = (node: Container, zIndex: number) => {
      node.zIndex = zIndex
      world.addChild(node)
      roomNodes.push(node)
    }
    add(new Sprite({ texture: textures.room }), -TOP)

    // The sliding doors, over the painting but sorted with the walkers by the bottom of their gap.
    doors = createDoors(next.walls)
    doorStates = {}
    for (const door of doors) {
      door.set(0)
      add(door.node, door.node.zIndex)
    }

    for (const seat of next.seats) {
      // What the painting draws in front of the sitter — a chair back, a desk — drawn again over them.
      for (const outline of seat.occluders) {
        const node = new Container()
        const art = new Sprite({ texture: textures.room })
        const shape = new Graphics().poly(outline).fill(0xffffff)
        node.addChild(art, shape)
        art.mask = shape
        add(node, Math.max(...outline.map((p) => p.y)))
      }
    }

    meetingLabel = createMeetingLabel(next.meetingArea)
    add(meetingLabel.node, TOP)

    counterLabel = createCounterLabel()
    add(counterLabel.node, TOP)

    const { desk, seat } = next.boss
    const bossDesk = onClick(new Container(), actions.bossDesk)
    bossDesk.hitArea = new Rectangle(desk.x, desk.y, desk.w, desk.h)
    add(bossDesk, TOP)
    // Under the chair, but never off the painting: a boss chair at the frame's edge keeps its label
    // just inside it, where a room that cuts the chair's wheels away would push the words out (T95).
    const chairLabelY = Math.min(seat.y + 30, next.painting.height - CHAIR_LABEL_MARGIN)
    bossChairTag = onClick(floorText('Your chair', seat.x + 2, chairLabelY), actions.bossDesk)
    add(bossChairTag, TOP)
    // The boss sits here whatever the Sessions do; their sprite opens Your desk as the desk itself does.
    boss = createBoss(bossAtDesk(next, bossSheet), textures.characters, textures.markers)
    add(onClick(boss.node, actions.bossDesk), boss.node.zIndex)
    bossBubble = bubble(textures.markers, '!')
    // Over the boss's own head, not over the middle of their desk: a desk rectangle can reach across
    // a monitor or a wall, and a count floating there belongs to nothing anyone can see. Off to one
    // side of it, so the emerald keeps the air straight above the head to itself.
    bossBubble.position.set(seat.x - BOSS_BUBBLE_ASIDE, seat.y - BOSS_BUBBLE_LIFT)
    add(onClick(bossBubble, actions.bossDesk), TOP)
  }

  /** Where a sprite stands: away from its desk, or at its own chair. An Employee the room had no
   * desk for has no chair, so the counter they wait at is the only place they are (T101). */
  function spotOf(sprite: OfficeSprite): Spot {
    return sprite.away ?? sprite.seat ?? layout?.coffee[0] ?? { x: 0, y: 0, facing: 'down' }
  }

  function addWalker(sprite: OfficeSprite): Walker {
    const node = new Container()
    const body = new Sprite()
    body.anchor.set(0.5, 1)
    // Under the body, over the floor: the rooms light from above and paint a shadow under their own
    // furniture, so a sprite with none floats.
    node.addChild(createShadow(), body)
    onClick(node, () => actions.select(sprite.employeeId))
    world.addChild(node)
    const tag = onClick(floorText('', 0, 0), () => actions.select(sprite.employeeId))
    tag.zIndex = TOP
    world.addChild(tag)
    // A child of the node, like the bubble: it follows the sprite and sorts with it, so it is never
    // drawn under the furniture the sprite itself is behind. Clicking it is clicking the Employee:
    // the tap bubbles up to the node, which is the one that opens their drawer.
    const awayTag = floorText('', 0, AWAY_TAG_DROP)
    awayTag.eventMode = 'static'
    awayTag.cursor = 'pointer'
    node.addChild(awayTag)
    const walker: Walker = {
      node,
      body,
      bubble: null,
      glyph: null,
      bubbleShape: null,
      tag,
      awayTag,
      sheet: sprite.sprite,
      sprite,
      x: spotOf(sprite).x,
      y: spotOf(sprite).y,
      path: [],
      goal: spotOf(sprite),
      facing: spotOf(sprite).facing,
      clock: 0,
    }
    walkers.set(sprite.employeeId, walker)
    return walker
  }

  function removeWalker(employeeId: string): void {
    const walker = walkers.get(employeeId)
    if (!walker) return
    walker.node.destroy({ children: true })
    walker.tag.destroy()
    walkers.delete(employeeId)
  }

  function setBubble(walker: Walker, glyph: BubbleGlyph | null): void {
    if (walker.glyph === glyph) return
    walker.bubble?.destroy({ children: true })
    walker.bubble = glyph ? bubble(textures.markers, glyph) : null
    walker.bubbleShape = glyph ? textures.markers.bubble(glyph) : null
    walker.glyph = glyph
    if (walker.bubble) walker.node.addChild(walker.bubble)
  }

  function setGoal(walker: Walker, goal: Spot, wasOff: boolean): void {
    const same = goal.x === walker.goal.x && goal.y === walker.goal.y
    walker.goal = goal
    const jump = () => {
      walker.x = goal.x
      walker.y = goal.y
      walker.path = []
      walker.facing = goal.facing
    }
    if (wasOff) return void jump()
    if (same && walker.path.length === 0) {
      walker.facing = goal.facing
      return
    }
    if (same) return
    const path = walkPath({ x: walker.x, y: walker.y }, goal, grid)
    if (path.length === 0) jump()
    else walker.path = path
  }

  function animate(walker: Walker, deltaMs: number): void {
    const { sprite, body } = walker
    walker.clock += deltaMs
    walker.node.visible = sprite.state !== 'off'

    let pose: Pose
    const next = walker.path[0]
    if (next) {
      const step = (WALK_SPEED * deltaMs) / 1000
      const dx = next.x - walker.x
      const dy = next.y - walker.y
      const distance = Math.hypot(dx, dy)
      if (distance > 0.01) {
        walker.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
      }
      if (distance <= step) {
        walker.x = next.x
        walker.y = next.y
        walker.path.shift()
        if (walker.path.length === 0) walker.facing = walker.goal.facing
      } else {
        walker.x += (dx / distance) * step
        walker.y += (dy / distance) * step
      }
      pose = 'walk'
    } else if (!sprite.away) {
      // At their own chair. `waiting` is the one who owes the boss a decision and did not get the
      // single spot at the boss desk — they put a hand up from where they are.
      pose =
        sprite.state === 'working'
          ? 'type'
          : sprite.state === 'reading'
            ? 'read'
            : sprite.state === 'waiting'
              ? 'waiting'
              : 'sit'
    } else if (sprite.away.seated) {
      // A chair away from the desk: the meeting room's table.
      pose = 'sit'
    } else if (sprite.away.place === 'coffee') {
      // Waiting at the counter: parked, out of budget or blocked, mug in hand (T90).
      pose = 'coffee'
    } else {
      pose = 'stand'
    }

    // A sitter at their own chair may be drawn from the front; the seat says which way they turn.
    const turn = sprite.away ? undefined : sprite.seat?.turn
    const frame = textures.characters(walker.sheet, pose, walker.facing, walker.clock, turn)
    body.texture = frame.texture
    body.scale.set(frame.flip ? -CHARACTER_SCALE : CHARACTER_SCALE, CHARACTER_SCALE)
    // The seated cells draw their chair off centre; the shift puts its wheels back on the seat.
    body.x = frame.shift
    // Typing nods; walking bobs.
    const bob =
      pose === 'type' ? Math.floor(walker.clock / 250) % 2 : pose === 'walk' ? Math.floor(walker.clock / 150) % 2 : 0
    walker.node.position.set(Math.round(walker.x), Math.round(walker.y) - bob)
    // Sorted by the seat or the feet; a walker passes in front of what it is level with.
    walker.node.zIndex = walker.y + (next ? 1 : 0)
    if (walker.bubble) walker.bubble.y = -body.height - BUBBLE_LIFT + Math.round(Math.sin(walker.clock / 250))
  }

  /** How far over the feet the sprite's own top is: its head, or the bubble already floating on it. */
  function headroomOf(walker: Walker): number {
    const bubbleTop = walker.bubble ? walker.body.height + 2 + walker.bubble.height : 0
    return Math.max(walker.body.height, bubbleTop)
  }

  /**
   * The pass that keeps two labels off each other (T105). Every label the floor is about to draw
   * hands over its box — the room's own lines first, which never move, then the people's — and
   * whatever the layout gives back is where it is drawn. It runs on the frame, after the sprites
   * have been moved, so a label follows its Employee across the floor and still never collides.
   */
  function layOutFloor(): void {
    if (!layout) return
    /** The `Text` each box belongs to, and the walker it rides with when it is a travelling one. */
    const nodes = new Map<string, { text: Text; walker: Walker | null }>()
    const fixed: FloorLabel[] = []
    const room = (key: string, text: Text, top: number) => {
      if (!text.visible || text.text === '') return
      nodes.set(key, { text, walker: null })
      fixed.push({ key, x: text.x, y: top, width: text.width, height: text.height, fixed: true })
    }
    if (bossChairTag) room('boss-chair', bossChairTag, bossChairTag.y)
    if (meetingLabel) room('meeting', meetingLabel.node, meetingLabel.node.y - meetingLabel.node.height)
    if (counterLabel) room('counter', counterLabel.node, counterLabel.node.y)
    // The boss's own count floats over their chair, and no label is drawn across it either (T156).
    if (bossBubble?.visible) {
      const tip = { x: bossBubble.x, y: bossBubble.y }
      fixed.push(bubbleObstacle('bubble:boss', bubbleBox(textures.markers.bubble('!'), tip, 1)))
    }

    const sprites: OfficeSprite[] = []
    for (const walker of walkers.values()) {
      if (walker.tag.visible) nodes.set(chairKey(walker.sprite.employeeId), { text: walker.tag, walker })
      // An off Employee is not drawn, so the label that travels with them is not on the floor either.
      if (walker.awayTag.visible && walker.sprite.state !== 'off') {
        nodes.set(awayKey(walker.sprite.employeeId), { text: walker.awayTag, walker })
      }
      sprites.push(walker.sprite)
    }
    const people = floorLabelBoxes(sprites, layout.painting, {
      at: (sprite) => {
        const walker = walkers.get(sprite.employeeId)
        return walker ? { x: walker.node.x, y: walker.node.y } : spotOf(sprite as OfficeSprite)
      },
      // Where the bubble hangs at rest, off the unrounded walk and the unbobbed head: the box already
      // covers the bob, so a label beside a bubble is laid out once, not jolted every frame.
      bubble: (sprite) => {
        const walker = walkers.get(sprite.employeeId)
        if (!walker?.bubbleShape || !walker.node.visible) return null
        const feet = { x: walker.node.x, y: Math.round(walker.y) }
        return bubbleBox(walker.bubbleShape, bubbleTip(feet, walker.body.height))
      },
      measure: (key) => {
        const found = nodes.get(key)
        if (!found) return { width: 0, height: 0 }
        return {
          width: found.text.width,
          height: found.text.height,
          headroom: found.walker ? headroomOf(found.walker) : 0,
        }
      },
    })
    // A bubble is a box with no text of its own: it is kept, fixed, for the labels to move around.
    const boxes = [...fixed, ...people.filter((box) => box.fixed || nodes.has(box.key))]
    for (const placed of layOutLabels(boxes, { bottom: layout.painting.height - FLOOR_GUTTER })) {
      const found = nodes.get(placed.key)
      if (!found || placed.fixed) continue
      // A chair's name is a child of the world; a travelling label is a child of its own sprite.
      found.text.y = found.walker && found.text === found.walker.awayTag ? placed.y - found.walker.node.y : placed.y
    }
  }

  const tick = (ticker: { deltaMS: number }) => {
    for (const walker of walkers.values()) animate(walker, ticker.deltaMS)
    layOutFloor()
    if (doors.length > 0) {
      const feet = [...walkers.values()].filter((w) => w.sprite.state !== 'off').map((w) => ({ x: w.x, y: w.y }))
      doorStates = doorState(feet, Date.now(), doorStates, layout?.walls)
      for (const door of doors) door.set(doorStates[door.name]?.open ?? 0)
    }
    if (bossBubble) bossBubble.pivot.y = Math.round(Math.sin(performance.now() / 250))
    // Straight off the clock, so the bob and the turn cannot drift with the frame rate.
    boss?.animate(performance.now())
  }
  app.ticker.add(tick)

  const stage: OfficeStage = {
    setTextures(next) {
      textures = next
      roomKey = ''
    },

    setLogo(url) {
      if (url === logoUrl) return
      logoUrl = url
      if (layout) void drawLogo(layout)
    },

    update(scene) {
      const key = `${scene.room}:${scene.layout.width}x${scene.layout.height}:${scene.layout.seats.length}`
      if (key !== roomKey) {
        roomKey = key
        layout = scene.layout
        grid = walkable(scene.layout)
        buildRoom(scene.layout)
        void drawLogo(scene.layout)
        if (!fitted) {
          fitted = true
          stage.fit()
        }
      }
      meetingLabel?.set(scene.meetingCount ?? 0)
      // The corner speaks for the group standing at it, and none of them carries a label (T100).
      counterLabel?.set(
        scene.counterLabel ?? null,
        scene.sprites.flatMap((sprite) => (sprite.away?.place === 'coffee' ? [sprite.away] : [])),
        scene.layout.painting.height,
      )
      bossSheet = scene.boss.sprite
      boss?.setSheet(bossSheet)
      boss?.animate(performance.now())
      if (bossBubble) {
        bossBubble.visible = (scene.pendingApprovals ?? 0) > 0
        const count = bossBubble.children.find((child) => child instanceof Text)
        if (count) count.text = String(scene.pendingApprovals ?? '!')
      }

      const seen = new Set<string>()
      for (const sprite of scene.sprites) {
        seen.add(sprite.employeeId)
        let walker = walkers.get(sprite.employeeId)
        if (walker && walker.sheet !== sprite.sprite) {
          removeWalker(sprite.employeeId)
          walker = undefined
        }
        const wasOff = !walker || walker.sprite.state === 'off'
        walker ??= addWalker(sprite)
        walker.sprite = sprite
        setGoal(walker, spotOf(sprite), wasOff)
        setBubble(walker, bubbleFor(sprite))
        // The room's own light over the state's own tint: a body drawn under a neutral light reads as
        // cut out and dropped into a warm loft or a rainy night.
        walker.body.tint = mixTint(roomOf(scene.room).light, STATE_TINT[sprite.state] ?? 0xffffff)
        // The chair keeps the name and the status travels with the Employee (T94): at their own desk
        // that is one label, as it always was; away from it the chair says who the desk belongs to
        // and the whole tag is drawn under them, wherever they are standing.
        const labels = floorLabels(sprite)
        walker.tag.text = labels.chair ?? ''
        walker.tag.alpha = labels.dimmed ? CHAIR_TAG_DIM : 1
        // Under the seat, in the aisle — but never off the painting, as the boss's own chair does it
        // (T95): a desk the free floor grew near the near edge would push its label out of the frame.
        if (sprite.seat) {
          const at = chairLabelSpot(sprite.seat, scene.layout.painting.height)
          walker.tag.position.set(at.x, at.y)
        }
        // An off Employee keeps its name over its own chair, so the floor still says whose desk is
        // whose; the chair beside the boss's is nobody's now that the boss sits in a painted one.
        // An Employee the room had no desk for has no chair to keep a name over (T101).
        walker.tag.visible = labels.chair !== null
        walker.awayTag.text = labels.away ?? ''
        walker.awayTag.visible = labels.away !== null
        animate(walker, 0)
      }
      for (const employeeId of [...walkers.keys()]) if (!seen.has(employeeId)) removeWalker(employeeId)
      // Nothing the floor draws sits on top of anything else it draws (T105).
      layOutFloor()
    },

    zoomBy(factor, at = { x: app.screen.width / 2, y: app.screen.height / 2 }) {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, world.scale.x * factor))
      const worldX = (at.x - world.x) / world.scale.x
      const worldY = (at.y - world.y) / world.scale.y
      place(at.x - worldX * zoom, at.y - worldY * zoom, zoom)
      actions.zoom(zoom)
    },

    fit() {
      if (!layout) return
      const { width, height } = layout
      const zoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.min(app.screen.width / width, app.screen.height / height)),
      )
      place((app.screen.width - width * zoom) / 2, (app.screen.height - height * zoom) / 2, zoom)
      actions.zoom(zoom)
    },

    destroy() {
      resize.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      app.ticker.remove(tick)
      app.destroy(true, { children: true })
    },
  }
  return stage
}

/**
 * A speech bubble off the marker sheet, its tail's tip at (0, 0) so it lands on the head wherever the
 * bubble is hung: the sheet's own bubble in the glyph's colour, with the glyph drawn over it, centred
 * in the rounded box and never on the tail. The sheet draws the bubbles empty, so `…` keeps its three
 * painted dots.
 */
function bubble(markers: MarkerFrames, glyph: BubbleGlyph): Container {
  const style = BUBBLE_STYLE[glyph]
  const frame = markers.bubble(glyph)
  const node = new Container()
  const art = new Sprite({ texture: frame.texture, scale: BUBBLE_SCALE })
  art.position.set(-frame.tip.x * BUBBLE_SCALE, -frame.tip.y * BUBBLE_SCALE)
  node.addChild(art)
  // The middle of the bubble's box, in the node's own space: from the tail's tip, which is its origin.
  const middle = {
    x: (frame.body.x + frame.body.w / 2 - frame.tip.x) * BUBBLE_SCALE,
    y: (frame.body.y + frame.body.h / 2 - frame.tip.y) * BUBBLE_SCALE,
  }
  if (glyph === '…') {
    const dots = new Graphics()
    for (const dx of [-6, -1, 4]) dots.rect(middle.x + dx, middle.y - 1, 2, 2).fill(style.text)
    node.addChild(dots)
  } else {
    const text = new Text({
      text: glyph,
      style: {
        fontFamily: 'Inter Variable, system-ui, sans-serif',
        fontSize: BUBBLE_FONT,
        fontWeight: '800',
        fill: style.text,
      },
      resolution: TEXT_RES,
    })
    text.anchor.set(0.5, 0.5)
    text.position.set(middle.x, middle.y)
    // `Zzz` is three letters where the others are one, and the sheet paints one box for them all:
    // a glyph wider than that box is set down until it sits inside the painted rim.
    const room = frame.body.w * BUBBLE_SCALE - BUBBLE_PAD
    if (text.width > room) text.scale.set(room / text.width)
    node.addChild(text)
  }
  return node
}

/** A logo's image, decoded once however many walls and rooms draw it. */
const images = new Map<string, Promise<HTMLImageElement>>()

function decoded(url: string): Promise<HTMLImageElement> {
  let found = images.get(url)
  if (!found) {
    const image = new Image()
    image.src = url
    found = image.decode().then(() => image)
    images.set(url, found)
  }
  return found
}

/** How many painting pixels a surface is across, along its top edge. */
function span([topLeft, topRight]: Quad): number {
  return Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y)
}

/**
 * The logo at the size the wall shows it (T280): shrunk smoothly to the painting pixels it covers,
 * then drawn nearest-neighbour, so it is enlarged with the room the way the room's own pixels are
 * and reads as painted rather than pasted.
 */
async function wallTexture(image: HTMLImageElement, across: number): Promise<Texture> {
  const width = Math.max(4, Math.round(across))
  const height = Math.max(4, Math.round((width * image.height) / image.width))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas to draw the logo with')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  const texture = Texture.from(canvas)
  texture.source.scaleMode = 'nearest'
  return texture
}
