/**
 * The emerald over the boss's head (T86): a small diamond that floats there whenever a Company is
 * open, bobbing on a slow loop and turning like the one in The Sims. Everything here is painting
 * pixels and pure time, so the stage only has to draw what `plumbobPose` says.
 * The diamond itself is drawn from `design/office/office-marker-sheet.png`, in three steps of the
 * turn, so nothing here says what colour it is (T98).
 */

export const PLUMBOB = {
  /** Point to point; the sheet's own steps decide how wide the diamond reads at each of them (T98). */
  height: 30,
  /** Clear air between the top of the head and the diamond's lowest point, at the bottom of the bob. */
  gap: 2,
  /** How far it rises above that, and falls back. */
  bob: 3,
  /** One rise and fall. */
  bobMs: 2600,
  /** One full turn. */
  spinMs: 4200,
  /** The narrowest the turning diamond gets, as a share of its width, so it never vanishes edge-on. */
  minTurn: 0.22,
} as const

export interface PlumbobPose {
  /** The diamond's centre above the sprite's feet, in painting pixels; negative is up. */
  y: number
  /** How wide it reads as it turns: 1 face-on, negative for the same face seen from the other side. */
  turn: number
}

/**
 * Where the emerald is at `clock` ms over a body `bodyHeight` painting pixels tall. It is a function
 * of the clock alone — never of the frame that just passed — so the loop cannot drift with the frame
 * rate, and the pose is the same whether the stage drew one frame or a hundred to get here.
 * The rest height already allows for the whole bob, so the diamond clears the head at every point of it.
 */
export function plumbobPose(bodyHeight: number, clock: number): PlumbobPose {
  const rest = -bodyHeight - PLUMBOB.gap - PLUMBOB.bob - PLUMBOB.height / 2
  const rise = Math.sin((clock / PLUMBOB.bobMs) * 2 * Math.PI) * PLUMBOB.bob
  const turn = Math.cos((clock / PLUMBOB.spinMs) * 2 * Math.PI)
  return { y: rest + rise, turn: (turn < 0 ? -1 : 1) * Math.max(Math.abs(turn), PLUMBOB.minTurn) }
}

/** The lowest point of the diamond in that pose: what has to stay above the head. */
export function plumbobBottom(pose: PlumbobPose): number {
  return pose.y + PLUMBOB.height / 2
}
