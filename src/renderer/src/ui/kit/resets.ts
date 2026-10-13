import '../tailwind.css'

/**
 * The two resets the whole app shares, as class lists (T216).
 *
 * They were rules in `ui/base.css` — `.shell-btn` and `.choice-input` — and a rule is the one thing
 * this renderer no longer has. A class list is the same thing said where it can be imported: `cx`
 * puts the caller's own utilities after it, so a screen that wants a different background or a
 * different focus ring writes one and gets it, which is exactly what out-layering the base gave it
 * before.
 */

/**
 * Every bare `<button>` in the app: the UA's chrome off, and the app's focus ring on.
 *
 * `font` and `color` are not here. The base layer gives every `button` `font: inherit` and
 * `color: inherit` already, and `:where(.shell-btn)` weighed nothing, so those two declarations
 * never decided anything — an element selector out-specifies a `:where()` whatever the order.
 */
export const SHELL_BUTTON =
  'm-0 cursor-pointer border-0 bg-transparent text-left focus-visible:shadow-focus focus-visible:outline-none'

/**
 * One option of a set, drawn as the frame draws it — a chip, a swatch, a thumbnail, a segment — with
 * a real radio or checkbox under it. `a11y/useSemanticElements` asks for the native control and the
 * frames ask for the box: the control is in the accessibility tree and on the keyboard, and the
 * `label` around it is what is seen and what is clicked. It is out of flow, so it takes no cell of a
 * grid and no space in a flex row.
 *
 * The element carries `data-slot="choice-input"` beside it, because a dozen screens reach it from
 * their own label with `has-[>[data-slot=choice-input]:focus-visible]:` — a control that is never
 * drawn still decides how the box around it looks.
 */
export const CHOICE_INPUT = 'pointer-events-none absolute m-0 h-1 w-1 opacity-0'
