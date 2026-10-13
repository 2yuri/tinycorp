import { extendTailwindMerge } from 'tailwind-merge'

/**
 * `cx` joins class names **and resolves the ones that fight** (T216).
 *
 * The kit styles itself in utilities now, so a component writes `gap-8` on its own element and a
 * caller writes `gap-6` on the same one. Both are one class in `@layer utilities` with the same
 * specificity, so neither the source order nor the `className` position decides it: Tailwind's own
 * sort order does, and it has no idea which of the two the screen meant. That is the tie T213
 * measured — 41 of 98 states moved — and `tailwind-merge` is what unties it: the later class wins,
 * which is the caller's, because the caller's `className` is appended last.
 *
 * **It has to be told our theme, or it unties the wrong ones.** `tailwind-merge` reads
 * `text-13` against Tailwind's own scale, finds no size called `13`, and files it as a *colour* —
 * so `text-foreground text-13` comes back as `text-13` with the colour dropped, and
 * `text-13 text-foreground` as `text-foreground` with the size dropped. Neither is an error and
 * both draw. The four scales below are ours, and `cx.test.ts` pins each one against the keys
 * `ui/tailwind.css` really declares, so a new size or elevation cannot be added in one place only.
 */

/** Our type scale: the `--text-*` keys of `ui/tailwind.css`, `11-5` and all. */
const TEXT = [
  '9',
  '9-5',
  '10',
  '10-5',
  '11',
  '11-5',
  '12',
  '12-5',
  '13',
  '13-5',
  '14',
  '14-5',
  '15',
  '15-5',
  '16',
  '17',
  '18',
  '19',
  '20',
  '22',
  '24',
  '26',
  '30',
  '40',
  '56',
]

/** The elevations, and the ring a focused control wears: the `--shadow-*` keys. */
const SHADOW = [
  'raised',
  'floating',
  'overlay',
  'card',
  'menu',
  'toast',
  'button-primary',
  'knob',
  'prompt',
  'modal',
  'drawer',
  'employee-drawer',
  'focus',
]

/** The two animations a Tailwind screen draws: the `--animate-*` keys. */
const ANIMATE = ['spin', 'check-spin']

/** The two families: Pen's `--font-primary` under Tailwind's name, and the mono stack under ours. */
const FONT = ['sans', 'code']

/**
 * Tailwind's own weights, spelled out because the group they replace is too greedy.
 *
 * `tailwind-merge` reads any `font-[…]` as a weight, and Tailwind compiles `font-[inherit]` to
 * `font-family: inherit` — the eleven places a chip takes the face of the row it sits in. Left
 * alone, `cx('font-[inherit]', 'font-semibold')` drops the family and the chip is set in the body
 * face. Naming the weights leaves the arbitrary value where it belongs.
 */
const WEIGHT = ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black']

const merge = extendTailwindMerge({
  override: { classGroups: { 'font-weight': [{ font: WEIGHT }] } },
  extend: { theme: { text: TEXT, shadow: SHADOW, animate: ANIMATE, font: FONT } },
})

/** The scales `cx.test.ts` checks against `ui/tailwind.css`. */
export const SCALES = { text: TEXT, shadow: SHADOW, animate: ANIMATE, font: FONT }

/** Joins class names, skipping falsy ones, and resolves the utilities that conflict. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return merge(names.filter(Boolean).join(' '))
}
