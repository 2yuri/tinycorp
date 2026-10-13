import type { ReactNode } from 'react'
import { cx } from './cx'
import '../tailwind.css'

/**
 * The card every settings frame is built from, and the divided row inside it (T213).
 *
 * Eleven cards and five rows were written out by hand across the settings tabs, each one the same
 * seven elements. The measurements are the ones `settings-classes.ts` carried, and that module
 * re-exports them, so a tab that still names a list by hand goes on working.
 *
 * The stroke is drawn by an `::after` at `inset: 0` rather than a real `border`: the frame measures
 * its 18px from the card's outer edge, so a real border would eat a pixel off each side and move
 * every control in the card with it. `inset-ring-1` says the same thing in one utility, but it is a
 * `box-shadow` and the two antialias the rounded corners differently — about 900 pixels a screen,
 * enough to move the four Tokens states off their score. The pseudo-element is the translation; the
 * ring is a redesign, however small.
 */
export const SETTINGS_CARD =
  'relative flex flex-col gap-14 rounded-md bg-card p-18 [&_.hire-help]:m-0 [&_.hire-help]:text-11/16 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border after:content-[""]'

/**
 * One card in the General frames keeps 12 between its rows where the others keep 14 — `Chat &
 * notifications` in `QgXdU`, `hGQxG` and `PqC4p`. At 14 its four gaps put the divider, the
 * notifications row and the test button 2px lower each time.
 */
export const SETTINGS_CARD_TIGHT =
  'relative flex flex-col gap-12 rounded-md bg-card p-18 [&_.hire-help]:m-0 [&_.hire-help]:text-11/16 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border after:content-[""]'

export const SETTINGS_CARD_HEAD = 'flex flex-col gap-2'
export const SETTINGS_CARD_TITLE = 'm-0 text-14/17 font-bold text-foreground'

/** The sub of a card and of a line: the same 11.5 on 17 the frames set both on. */
export const SETTINGS_CARD_SUB = 'm-0 text-11-5/17 font-normal text-muted-foreground'

/** The Tokens tab sets its card subtitles at 12 where every other tab uses 11.5. */
export const SETTINGS_CARD_SUB_12 = 'm-0 text-12/17 font-normal text-muted-foreground'

/** Daily digest (T172, frame `b9EZF`): the card's control sits beside its own head. */
export const SETTINGS_CARD_HEAD_WITH_CONTROL = 'flex flex-row items-start gap-16'
export const SETTINGS_CARD_HEAD_TEXT = 'flex min-w-0 flex-[1_1_0] flex-col gap-2'

export const SETTINGS_DIVIDER = 'h-1 bg-border'
export const SETTINGS_LINE = 'flex items-center gap-16 [&_[data-slot=choice-label]:empty]:hidden'
export const SETTINGS_LINE_TEXT = 'flex min-w-0 flex-[1_1_0] flex-col gap-2'
export const SETTINGS_LINE_TITLE = 'text-13/[inherit] font-semibold text-foreground'

export interface SettingsCardProps {
  title: ReactNode
  /** The line under the title. `sub12` is the Tokens tab's half-point larger one. */
  sub?: ReactNode
  sub12?: boolean
  /** A control beside the head rather than under it — the digest's own switch. */
  control?: ReactNode
  /** 12px between rows instead of 14: the one card the General frames draw tighter. */
  tight?: boolean
  /** What a screen reader calls the card; the title when it is a plain string. */
  label?: string
  className?: string
  children?: ReactNode
}

export function SettingsCard({ title, sub, sub12, control, tight, label, className, children }: SettingsCardProps) {
  const named = label ?? (typeof title === 'string' ? title : undefined)
  return (
    <section
      data-ui="Settings Card"
      className={cx(tight ? SETTINGS_CARD_TIGHT : SETTINGS_CARD, className)}
      aria-label={named}
    >
      {control === undefined ? (
        <div className={SETTINGS_CARD_HEAD}>
          <h2 className={SETTINGS_CARD_TITLE}>{title}</h2>
          {sub !== undefined && <p className={sub12 ? SETTINGS_CARD_SUB_12 : SETTINGS_CARD_SUB}>{sub}</p>}
        </div>
      ) : (
        <div className={SETTINGS_CARD_HEAD_WITH_CONTROL}>
          <div className={SETTINGS_CARD_HEAD_TEXT}>
            <h2 className={SETTINGS_CARD_TITLE}>{title}</h2>
            {sub !== undefined && <p className={sub12 ? SETTINGS_CARD_SUB_12 : SETTINGS_CARD_SUB}>{sub}</p>}
          </div>
          {control}
        </div>
      )}
      {children}
    </section>
  )
}

export interface SettingsRowProps {
  title: ReactNode
  sub?: ReactNode
  /** The rule above the row. Every frame draws one; the first row of a card sometimes does not. */
  ruled?: boolean
  /** The row's own list, where a frame dims it or lays it out differently. */
  className?: string
  children?: ReactNode
}

/** A divided row: title and explanation on the left, an optional control on the right. */
export function SettingsRow({ title, sub, ruled = true, className, children }: SettingsRowProps) {
  return (
    <>
      {ruled && <div className={SETTINGS_DIVIDER} />}
      <div className={cx(className ?? SETTINGS_LINE)}>
        <div className={SETTINGS_LINE_TEXT}>
          <div className={SETTINGS_LINE_TITLE}>{title}</div>
          {sub !== undefined && <div className={SETTINGS_CARD_SUB}>{sub}</div>}
        </div>
        {children}
      </div>
    </>
  )
}
