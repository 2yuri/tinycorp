/**
 * The window's own frame, as class lists (design/html/office.html: Title Bar, Main > Top Bar).
 *
 * These lived in `shell/shell.css` until T210f, where `App.tsx`, this folder, three screens and ten
 * capture harnesses all drew a shell they did not own. They are here because this folder is the
 * window the screens sit in, and because it names nothing else in the renderer — so every folder
 * may name it, which is what a shared frame needs.
 */

/**
 * The whole window: the title bar over the body, and nothing scrolls but a view. `overflow-clip`,
 * not `overflow-hidden`: a hidden box is still a scroll container, and focusing a card taller than
 * the window scrolled the whole frame up under the title bar, sidebar and all.
 */
export const SHELL =
  'flex h-screen w-screen flex-col overflow-clip bg-background font-sans text-foreground leading-normal'

/** The rail, the drawer and the main column, side by side under the title bar. */
export const SHELL_BODY = 'flex min-h-0 w-full flex-1 basis-0'

/** The main column: the content header over the view. */
export const SHELL_MAIN = 'flex h-full min-w-0 flex-1 basis-0 flex-col bg-background'

/** One view under the content header. It is the only thing on the screen that scrolls. */
export const SHELL_VIEW = 'relative min-h-0 flex-1 basis-0 overflow-auto'

/*
 * `.shell-view--legacy` and `.shell-view--centered` are not here: both were rules in `shell.css`
 * that no component had named for some time, and a dead rule translated is a dead rule kept.
 */

/** The 64px header above every view (Top Bar). */
export const SHELL_HEADER = 'flex h-64 w-full shrink-0 items-center gap-16 border-b border-b-border bg-card px-20'

export const HEADER_INFO = 'flex min-w-0 shrink flex-col gap-2'

export const HEADER_TITLE_ROW = 'flex min-w-0 items-center gap-8'

export const HEADER_TITLE = 'm-0 truncate font-bold text-17/normal text-foreground tracking-[-0.3px]'

export const HEADER_SUBTITLE = 'truncate font-normal text-12/normal text-muted-foreground'

export const HEADER_SPACER = 'h-1 flex-1 basis-0'

/** An empty action slot draws nothing, so the header's 16px gap does not double after the spacer. */
export const HEADER_ACTIONS = 'flex shrink-0 items-center gap-16 empty:hidden'
