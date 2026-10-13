/**
 * The class lists the Repositories screens share (T210c), off `design/html/repositories.html`
 * (Desktop App / Repositories, and the Add Repository frame).
 *
 * A folder-wide module rather than a list per component, because the card, the modal, the panel,
 * the scan and the onboarding step all draw the same field, input, chip and button. `tailwind.css`
 * names this file as a source: Tailwind reads the text a class is written in, so these lists have
 * to be somewhere it scans, and `tailwind.test.ts` compiles every one of them.
 *
 * Two things to know when reading them. The screens set the line box to the font's own, so a size
 * carries `/[normal]` wherever the stylesheet left the line alone and its measured value where it
 * did not. And `font: inherit` on an element that is really a button is `font-sans
 * text-[length:inherit]` — there is no `font-inherit` utility, and writing one compiles to
 * nothing at all.
 */

import { cx } from '../ui'

/*
 * The view's own frame. The capture harness draws the same three, which is why they are here and
 * not in `Repositories.tsx`: a harness that lays a screen out differently from the app is the one
 * drift `design:compare` cannot see past.
 */
export const VIEW = 'flex min-h-0 flex-1 flex-col font-sans leading-[normal]'
export const SPLIT = 'flex min-h-0 w-full flex-1'
export const LIST = 'flex min-w-0 flex-1 flex-col gap-14 overflow-auto p-24'

/* Pen's strokes sit inside the box, so a bordered surface draws its stroke over itself. */
export const INSET_STROKE =
  'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border after:content-[""]'

export const FIELD = 'flex w-full min-w-0 shrink-0 flex-col gap-6'
export const FIELD_GROW = 'flex min-w-0 flex-1 flex-col gap-6'
export const FIELD_LABEL = 'shrink-0 whitespace-nowrap text-muted-foreground text-11/13 font-bold tracking-[0.5px]'
export const FIELD_HELPER = 'text-muted-foreground text-11/16 font-normal'
export const ROW = 'flex w-full shrink-0 gap-12'

export const INPUT =
  'flex w-full min-w-0 items-center gap-9 rounded-sm border border-border bg-card px-11 py-8 text-muted-foreground focus-within:border-ring focus-within:shadow-focus [&_svg]:shrink-0'
export const INPUT_TALL =
  'flex h-40 w-full min-w-0 items-center gap-9 rounded-sm border border-border bg-card px-11 text-muted-foreground focus-within:border-ring focus-within:shadow-focus [&_svg]:shrink-0'
export const INPUT_BROWSE =
  'flex h-40 w-full min-w-0 items-center gap-8 rounded-sm border border-border bg-card pr-5 pl-11 text-muted-foreground focus-within:border-ring focus-within:shadow-focus [&_svg]:shrink-0'
export const INPUT_CONTROL_MONO =
  'm-0 min-w-0 flex-1 overflow-hidden border-0 bg-transparent p-0 text-ellipsis whitespace-nowrap font-code text-foreground text-12-5/17 font-normal outline-none'
/* A native select, so the list is the platform's; the options take the popover's colours. */
export const INPUT_SELECT =
  'm-0 min-w-0 flex-1 cursor-pointer appearance-none overflow-hidden border-0 bg-transparent p-0 text-ellipsis whitespace-nowrap font-sans text-foreground text-13-5/16 font-normal outline-none [&_option]:bg-popover [&_option]:text-popover-foreground'
export const BROWSE =
  'm-0 shrink-0 cursor-pointer rounded-[6px] border-0 bg-secondary px-10 py-6 font-sans text-foreground text-12/15 font-semibold hover:bg-[color-mix(in_srgb,var(--secondary)_80%,var(--white))] focus-visible:shadow-focus focus-visible:outline-none'

export const DIVIDER = 'h-1 w-full shrink-0 bg-border'
export const SPACER = 'h-1 flex-1'

export const CHIP =
  'inline-flex max-w-full shrink-0 items-center gap-6 rounded-full bg-secondary px-9 py-4 text-muted-foreground [&_svg]:shrink-0'
export const CHIP_PATH =
  'inline-flex max-w-full min-w-0 shrink items-center gap-6 rounded-full bg-secondary px-9 py-4 text-muted-foreground [&_svg]:shrink-0'
export const CHIP_LABEL =
  'overflow-hidden text-ellipsis whitespace-nowrap font-code text-soft-ink text-11/15 font-normal'

/*
 * What TinyCorp may do to the repo: quiet for `merges`, amber for `PR only`, red for `local only`.
 *
 * Each tone is the whole chip rather than a colour laid over `CHIP`. The base sets a `color` for
 * its icon and the tone would set another, and two utilities for one property come from the same
 * layer with no order between them — the winner would be whichever Tailwind wrote last.
 */
export const RUNG_CHIP =
  'inline-flex max-w-full shrink-0 items-center gap-6 rounded-full bg-secondary px-9 py-4 text-muted-foreground [&_svg]:shrink-0'
export const RUNG_CHIP_WARNING =
  'inline-flex max-w-full shrink-0 items-center gap-6 rounded-full bg-[color-mix(in_srgb,var(--brand-warning)_16%,transparent)] px-9 py-4 text-brand-warning [&_svg]:shrink-0'
export const RUNG_CHIP_ERROR =
  'inline-flex max-w-full shrink-0 items-center gap-6 rounded-full bg-[color-mix(in_srgb,var(--destructive)_18%,transparent)] px-9 py-4 text-destructive [&_svg]:shrink-0'
export const RUNG_LABEL_CLASS =
  'overflow-hidden text-ellipsis whitespace-nowrap font-sans text-soft-ink text-11/15 font-semibold tracking-[0.2px]'
export const RUNG_WARNING_LABEL =
  'overflow-hidden text-ellipsis whitespace-nowrap font-sans text-brand-warning text-11/15 font-semibold tracking-[0.2px]'
export const RUNG_ERROR_LABEL =
  'overflow-hidden text-ellipsis whitespace-nowrap font-sans text-destructive text-11/15 font-semibold tracking-[0.2px]'

export const ICON_BUTTON =
  'm-0 flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'
export const TEXT_BUTTON =
  'm-0 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent px-16 py-9 font-sans text-muted-foreground text-13-5/16 font-semibold hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] focus-visible:shadow-focus focus-visible:outline-none'
export const TEXT_BUTTON_LG =
  'm-0 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent px-18 py-11 font-sans text-muted-foreground text-14/17 font-semibold hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] focus-visible:shadow-focus focus-visible:outline-none'

/* The kit's, under this folder's own name: one list, wherever a frame draws the box and not the box. */
export { CHOICE_INPUT } from '../ui'

/* The ladder, one row per rung: the panel is narrow, so they stack rather than sit side by side. */
export const RUNGS = 'flex w-full flex-col gap-6'
export const RUNG_OPTION =
  'm-0 grid grid-cols-[auto_1fr] items-center gap-x-8 gap-y-2 rounded-sm border border-border bg-card px-11 py-9 text-left font-sans text-[length:inherit] text-muted-foreground has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none'
export const RUNG_OPTION_ON =
  'm-0 grid grid-cols-[auto_1fr] items-center gap-x-8 gap-y-2 rounded-sm border border-primary bg-primary-subtle px-11 py-9 text-left font-sans text-[length:inherit] text-foreground has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none'
export const RUNG_OPTION_TITLE = 'text-foreground text-13/16 font-semibold'
export const RUNG_OPTION_SUB = 'col-start-2 text-muted-foreground text-11/15 font-normal'

export const STACK_HEADER = 'flex w-full shrink-0 items-center gap-8'
export const STACK_HEADER_TITLE = 'text-foreground text-14/17 font-bold'
export const STACK_HELP = 'm-0 shrink-0 text-muted-foreground text-11-5/17 font-normal'
export const DETECTED =
  'm-0 inline-flex cursor-pointer items-center gap-5 rounded-[4px] border-0 bg-transparent p-0 font-sans text-foreground text-11/13 font-semibold focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:text-muted-foreground'

export const REMOTE =
  'flex w-full shrink-0 items-center gap-10 rounded-sm bg-card px-12 py-10 text-foreground [&_svg]:shrink-0'
export const REMOTE_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
export const REMOTE_URL =
  'overflow-hidden text-ellipsis whitespace-nowrap font-code text-foreground text-11-5/15 font-normal'
export const REMOTE_SUB = 'whitespace-pre text-muted-foreground text-11/13 font-normal'
export const REMOTE_SUB_COMPACT = 'whitespace-pre text-foreground text-11/13 font-normal'
export const CONNECTED_PILL =
  'inline-flex shrink-0 items-center gap-5 rounded-full bg-status-success px-10 py-5 text-status-success-foreground text-11-5/[normal] font-semibold'

/* The Add repository modal (step 1), Scan a folder and the found-repositories picker's modal. */
export const MODAL_OVERLAY =
  'fixed inset-[44px_0_0_0] z-30 flex items-center justify-center bg-modal-scrim p-24 font-sans leading-[normal]'
export const MODAL = cx('relative m-0 flex max-h-full w-620 flex-col rounded-md bg-card shadow-modal', INSET_STROKE)
/* The picker's modal is the wide one, and stops short of the window on every side. */
export const MODAL_FOUND = cx(
  'relative m-0 flex h-800 max-h-[calc(100vh-80px)] w-760 max-w-[calc(100vw-80px)] flex-col rounded-md bg-card shadow-modal',
  INSET_STROKE,
)
export const MODAL_HEADER = 'flex shrink-0 items-center gap-12 border-b border-border px-20 pt-16 pb-15'
export const MODAL_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
export const MODAL_TITLE = 'text-foreground text-16/19 font-bold'
export const MODAL_SUB = 'text-muted-foreground text-11-5/14 font-normal'
export const MODAL_FORM = 'flex flex-col gap-14 overflow-auto px-20 py-16'
export const MODAL_FORM_FOUND = 'flex min-h-0 flex-1 flex-col gap-12 overflow-auto px-20 py-16'
export const MODAL_FOOTER = 'flex shrink-0 items-center gap-10 border-t border-border px-20 pt-13 pb-14'
export const MODAL_CONTINUE = '[&_svg]:h-15 [&_svg]:w-15 px-16 py-9 text-13-5/16'
export const STEPS = 'flex flex-1 items-center gap-6'
export const STEPS_DOT = 'h-6 w-6 rounded-full bg-secondary'
export const STEPS_DOT_ACTIVE = 'h-6 w-18 rounded-full bg-primary'
export const STEPS_TEXT = 'text-muted-foreground text-11-5/[normal] font-normal'

/* The source cards are labels over a real radio (T190): the ring comes from the control. */
export const SOURCES = 'flex w-full gap-10'
export const SOURCE =
  'm-0 flex min-w-0 flex-1 flex-col items-start gap-6 rounded-sm border border-border bg-card p-11 text-left font-sans text-[length:inherit] text-muted-foreground has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none has-[>input:disabled]:cursor-default'
export const SOURCE_SELECTED =
  'm-0 flex min-w-0 flex-1 flex-col items-start gap-6 rounded-sm border border-primary bg-primary-subtle p-11 text-left font-sans text-[length:inherit] text-foreground has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none has-[>input:disabled]:cursor-default'
export const SOURCE_TITLE = 'text-foreground text-13/16 font-semibold'
export const SOURCE_SUB = 'text-muted-foreground text-11/15 font-normal'

export const DETECT = 'flex w-full shrink-0 items-center gap-16'
export const DETECT_TEXT = 'flex flex-1 flex-col gap-2'
export const DETECT_TITLE = 'text-foreground text-13-5/16 font-semibold'
export const DETECT_SUB = 'text-muted-foreground text-11-5/17 font-normal'
/* The frame draws the switch alone: the kit's own label is the one thing taken off it. */
export const DETECT_TOGGLE = '[&_[data-slot=choice-label]]:hidden'

/*
 * The `Not a git repository yet` alert every attach surface shows. The kit's Alert stacks its body
 * inline; here it is a column with the button under the sentence, which is a utility on the Alert
 * reaching its own body — the kit is in `@layer kit`, so no `!` is needed.
 */
export const INIT_ALERT =
  '[&_[data-slot=alert-body]]:flex [&_[data-slot=alert-body]]:flex-col [&_[data-slot=alert-body]]:items-start [&_[data-slot=alert-body]]:gap-8'
export const INIT_TEXT = '[&_code]:font-code'
export const INIT_ERROR = 'text-status-error-foreground'

/*
 * New repository (frames `gFdvh` and `zzGk4`, T144). `PLAN_DETECT_OFF` said two things at once —
 * the title goes quiet and the switch goes half — and is written here as the two it was.
 */
export const PLAN_DETECT_OFF =
  'flex w-full shrink-0 items-center gap-16 [&_[data-detect-title]]:text-muted-foreground [&_[data-detect-toggle]]:opacity-50'
export const PLAN_SUB = 'whitespace-normal text-muted-foreground text-11/15 font-normal'
export const PLAN_SUB_REFUSED = 'whitespace-normal text-foreground text-11/15 font-normal'
/* A refused plan marks its own icon, which is the only red on the row. */
export const PLAN_REFUSED =
  'flex w-full shrink-0 items-center gap-10 rounded-sm bg-card px-12 py-10 text-foreground [&>svg]:shrink-0 [&>svg]:text-status-error'
export const PLAN_BADGE =
  'inline-flex shrink-0 items-center gap-5 rounded-full px-10 py-5 whitespace-nowrap text-11-5/[normal] font-semibold'
export const PLAN_BADGE_LOCAL = 'bg-secondary text-secondary-foreground'
export const PLAN_BADGE_IN_PLACE = 'bg-status-warning text-status-warning-foreground'
export const PLAN_BADGE_REFUSED = 'bg-status-error text-status-error-foreground'
export const NEW_REPO_ERROR = 'text-status-error-foreground text-12/16'
