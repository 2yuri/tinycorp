/**
 * Company settings' shared vocabulary (design/html/company-settings.html), as utilities.
 *
 * Every tab draws the same container, the same card and the same head, so they are written once
 * here rather than eight times. `ui/tailwind.css` names this file in its `@source` list, which is
 * what makes Tailwind generate these rules at all, and `ui/tailwind.test.ts` compiles every list
 * below — so a class that produces nothing fails here rather than in a screenshot.
 *
 * **Only class lists live in this file.** The test compiles every module-level `UPPERCASE` string
 * an `@source` file declares, so a sentence kept here would be read as a list of classes.
 */

/**
 * The screen. The first four utilities are `shell.css`'s `.shell-view`, written out here because a
 * file Tailwind scans may not carry a class from a folder that has not migrated yet — every class
 * in it has to compile. When the shell moves, these four and this list should become one shared
 * list rather than two copies.
 */
export const VIEW = 'relative flex min-h-0 flex-[1_1_0] flex-col overflow-auto bg-background font-sans leading-[normal]'

/** The tab strip. The divider is drawn inside, so the current tab's underline paints over it. */
export const TABS = 'flex shrink-0 gap-24 bg-card px-24 pt-16 shadow-[inset_0_-1px_0_var(--border)]'

/**
 * One tab. `border-b-2` is always there, and coloured by one of the two lists below, so the label
 * never moves when it becomes current. `ui/tailwind.css` gives every button `font: inherit`, so the
 * stylesheet's `font-family: inherit` is not restated.
 *
 * `border-0` and not `border-none` for the three sides that do not draw: `border-none` sets
 * `--tw-border-style: none`, which `border-b-2` then reads for its own style — and the underline
 * would never appear. Zero width says the same thing and leaves the style alone.
 *
 * `p-0` before `pb-10` because this is a `<button>`: `ui/tailwind.css` gives it `font` and `colour` but
 * not padding, so the shorthand the stylesheet wrote (`padding: 0 0 10px`) was also holding back
 * the UA's own. `pb-10` alone left it, every tab grew, and all fifteen settings states moved.
 */
export const TAB =
  'flex cursor-pointer items-center border-0 border-b-2 bg-transparent p-0 pb-10 text-14/[inherit] font-medium whitespace-nowrap'

/**
 * The two states are exclusive lists rather than a base and an override, because **the attribute's
 * order is not the cascade's**: `border-b-transparent` is emitted after `border-b-primary`, so a
 * tab carrying both draws no underline at all however they are written. The same goes for the
 * colour and the weight, so each state names all three.
 */
export const TAB_CURRENT = 'border-b-primary font-semibold text-primary'
export const TAB_REST = 'border-b-transparent text-muted-foreground hover:text-foreground'

/**
 * One container for every tab (T181): full width at `20px 22px`, which is what `Content` is in
 * every settings frame. A tab that laid out its own padding on top of this one drew its cards 46px
 * in from the window, so no tab carries its own.
 */
export const CONTENT = 'm-0 flex flex-wrap items-start gap-16 px-22 py-20'

/** The Office tab fills the panel: its own card layout, the design's own gutter. */
export const CONTENT_OFFICE = 'm-0 flex flex-nowrap items-start gap-16 p-0'

export const ERRORS = 'flex basis-full flex-col gap-8'

/** A column of cards. `flex-[1_1_360px]` as one value: `flex-1` would reset the basis after it. */
export const COLUMN = 'flex min-w-0 flex-[1_1_360px] flex-col gap-16'

/** A tab that draws its own grid is the container's only row, and fills it. */
export const FULL_ROW = 'min-w-0 flex-[1_1_100%]'

/**
 * The card, its head and the divided row inside it are `ui/kit/SettingsCard.tsx` since T213 — the
 * component the eleven tabs draw, and the lists it is built from. They keep the names the tabs
 * already call them by, so a tab that lays out a card row by hand rather than drawing a
 * `SettingsRow` goes on naming the same list rather than a copy of it.
 */
export {
  SETTINGS_CARD as CARD,
  SETTINGS_CARD_HEAD as CARD_HEAD,
  SETTINGS_CARD_SUB as CARD_SUB,
  SETTINGS_DIVIDER as DIVIDER,
  SETTINGS_LINE as LINE,
  SETTINGS_LINE_TEXT as LINE_TEXT,
  SETTINGS_LINE_TITLE as LINE_TITLE,
} from '../ui'

export const ROW = 'flex items-start gap-12'

/** The logo's bottom lines up with the fields'. */
export const IDENTITY = 'flex items-end gap-12'

/**
 * The Company's key as a badge. `rounded-md` and not a circle: this is the Company's mark, not a
 * person's avatar. `.settings-logo--round` went with the stylesheet — nothing in the app ever set
 * it, and the only thing that named it was a test asserting it was absent.
 */
export const LOGO =
  'flex size-56 shrink-0 items-center justify-center rounded-md border border-border bg-primary-subtle text-19/[inherit] font-bold whitespace-nowrap text-primary'

/**
 * The all-caps label over a panel or a field: 11/700, its box 13 tall.
 *
 * `m-0` because `ui/tailwind.css` resets the margin on `html`, `body` and `fieldset` and nothing else:
 * a heading or a paragraph keeps the UA's, which is why every stylesheet here wrote `margin: 0`.
 * This label is drawn as an `<h3>` in one card and a `<p>` in another.
 */
export const LABEL = 'm-0 text-11/13 font-bold uppercase tracking-[0.5px] text-muted-foreground'

/**
 * Fields: an 11px uppercase label, a 40px control, and a helper line only for errors. Each list
 * reaches into the kit's own markup, so every BEM underscore is `\_` and the whole list is a
 * `` template — Tailwind reads the source text, not the runtime string.
 *
 * Focus doubles the control's stroke, so the padding gives back exactly what the stroke takes;
 * an errored field already draws the thicker stroke, so it keeps its 11.
 */
export const FIELD =
  'gap-6 [&_[data-slot=field-label]]:text-11/13 [&_[data-slot=field-label]]:font-bold [&_[data-slot=field-label]]:uppercase [&_[data-slot=field-label]]:tracking-[0.5px] [&_[data-slot=field-label]]:text-muted-foreground [&_[data-slot=field-control]]:h-40 [&_[data-slot=field-control]]:gap-9 [&_[data-slot=field-control]]:px-11 [&_[data-slot=field-control]]:focus-within:px-10 [&[data-slot=field][data-error]_[data-slot=field-control]]:focus-within:px-11 [&[data-slot=field][data-error]_[data-slot=field-helper]]:whitespace-normal'

/**
 * What the value is set in, as one of two exclusive lists beside `FIELD`.
 *
 * The size is **not** in `FIELD`: both lists write `font-size` on `[data-slot=field]__input`, and
 * `text-13-5` is emitted after `text-12-5`, so a field carrying `FIELD` *and* `FIELD_MONO` drew
 * its mono value at 13.5 — the third time in this migration that a base plus an override lost to
 * the sheet's own order.
 *
 * The frame reads selects half a point under the text inputs (13 against 13.5).
 */
export const FIELD_TEXT =
  '[&_[data-slot=field-input]]:text-13-5/[inherit] [&_select[data-slot=field-input]]:text-13/[inherit]'

/** A field whose value is a path or a number the boss reads character by character. */
export const FIELD_MONO = '[&_[data-slot=field-input]]:font-code [&_[data-slot=field-input]]:text-12-5/[inherit]'

/**
 * The one hint the design gives a field wraps, and sits on 16 rather than the 17 the scale pairs
 * with 11: Pen draws a one-line text box shorter than the line box CSS gives it, and at 17 the
 * divider under this field landed a pixel below the frame's (measured against `QgXdU`).
 */
export const FIELD_HINTED =
  '[&_[data-slot=field-helper]]:whitespace-normal [&_[data-slot=field-helper]]:text-11/16 [&_[data-slot=field-helper]]:text-muted-foreground'

/** A label and what it labels, 6px apart — the shape every settings frame gives a small field. */
export const LABELLED = 'flex flex-col gap-6'

/** The line a card writes when a save fails. */
export const CARD_ERROR = 'm-0 text-11-5/[inherit] text-destructive'

/** Daily digest (T172, frame `b9EZF`): its error line, and the block its days sit in. */
export const DIGEST_ERROR = 'm-0 text-12/[inherit] text-status-error-foreground'
export const DIGEST_DAYS = 'flex flex-col gap-6'
