import type { ReactNode } from 'react'
import { TitleBar } from '../chrome'
import { ShellUpdateNotice } from '../updates'
import '../ui/tailwind.css'

/**
 * The 680×740 window the Launcher's steps share: the plain title bar over the body.
 *
 * `leading-[normal]` and not `leading-normal`: Tailwind's named value is `1.5`, and this window is
 * drawn on the font's own line box. The two differ by about 4px a row, which is every row in the
 * Company list. Every `text-*` inside therefore pins `/[normal]` too, because a size utility sets
 * the line height as well and would otherwise put the scale's own leading back.
 *
 * The focus ring is a descendant variant rather than a utility per button because that is what
 * `.launcher button:focus-visible` was: one rule over every button in the window, the title bar's
 * included.
 */
const WINDOW =
  'flex h-screen w-screen flex-col overflow-clip bg-background font-sans text-foreground leading-[normal] [&_button:focus-visible]:shadow-focus [&_button:focus-visible]:outline-none'

/*
 * The chrome both steps and the preflight screen draw: the centred column, and the mark, wordmark
 * and tagline above it. `LAUNCHER_HEAD` carries no padding-bottom, because the Launcher puts 26px
 * under it and the preflight screen 48px — and two paddings from the same layer have no order
 * between them, so the one that differs is written by the screen that wants it.
 */
export const LAUNCHER_BODY = 'relative flex min-h-0 w-full flex-1 flex-col items-center justify-center px-44'
export const LAUNCHER_HEAD = 'flex w-full shrink-0 flex-col items-center gap-12'
export const LAUNCHER_MARK = 'shrink-0'
export const LAUNCHER_WORDMARK =
  'm-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-heading-ink text-30/[normal] font-bold tracking-[-1px]'
export const LAUNCHER_TAGLINE = 'm-0 whitespace-nowrap text-muted-foreground text-13/[normal] font-normal'

export function LauncherFrame({
  name,
  title = 'tinycorp',
  children,
}: {
  name: string
  /** What the title bar says; `PreflightScreen` (T129) names the app instead. */
  title?: string
  children: ReactNode
}) {
  return (
    <div className={WINDOW} data-pencil-name={name}>
      <TitleBar
        plain
        title={title}
        notice={<ShellUpdateNotice />}
        onToggleMaximize={() => void window.tinyCorp.shell.toggleMaximize()}
      />
      {children}
    </div>
  )
}
