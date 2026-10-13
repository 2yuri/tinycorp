import { ChevronRight, Ellipsis, FolderOpen, FolderX, Plus } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { byRecency, type Company, type CompanySummary } from '../../../shared/company'
import { LogoMark } from '../brand'
import { modifierLabel } from '../chrome'
import { type CompanyMove, TemporaryFolderWarning, useCompanyMove } from '../company-move'
import { elementAnchor, type MenuAnchor, pointerAnchor, useCompanyRemoval } from '../company-removal'
import { resources, useIpcResource } from '../ipc'
import { tildePath } from '../paths'
import { Badge, Button, cx, IconButton, initialsOf, Search } from '../ui'
import { CreateCompanyView, EMPTY_DRAFT } from './CreateCompanyView'
import { type CompanyDraft, createCompany } from './create-company'
import {
  LAUNCHER_BODY,
  LAUNCHER_HEAD,
  LAUNCHER_MARK,
  LAUNCHER_TAGLINE,
  LAUNCHER_WORDMARK,
  LauncherFrame,
} from './LauncherFrame'
import {
  companyTone,
  filterSummaries,
  launcherKey,
  noMatch,
  SHORTCUT_ROWS,
  startsSearch,
  VISIBLE_ROWS,
  versionLabel,
} from './launcher-model'
import { companyMeta, SETUP_UNFINISHED, setupUnfinished, unavailable, unavailableMessage } from './summary-text'

/** The two states of the no-Company window. */
export type LauncherStep = 'list' | 'create'

/*
 * The Launcher's own classes (T210c), off frame `jPSiE`. Two things to know when reading them:
 * every size carries `/[normal]`, because the window draws on the font's own line box and a bare
 * `text-13` would bring the scale's 16px leading with it; and the ink that is not a theme colour —
 * the headings, the chips, the highlighted row's border — is a `launcher-*` token, added in T210c
 * for the five hexes this stylesheet used to declare on itself.
 */
const HEAD = cx(LAUNCHER_HEAD, 'pb-26')
const LIST_HEAD = 'flex w-full shrink-0 items-center gap-8 px-2 pb-8 text-muted-foreground text-11/[normal]'
const LIST_LABEL = 'flex-1 font-bold tracking-[0.6px]'
const COUNT = 'whitespace-nowrap font-code font-normal'
/*
 * The list scrolls past four rows (T267): 4 × 60 + 3 × 8 = 264, the frame's own `Companies` box,
 * plus the 3px either side that keeps a focus ring inside the scroller. Held only by the window, it
 * used to grow until the column reached the footer and slid under it. Once the search is there the
 * box keeps that height whatever matches, so the column does not jump as the boss types.
 */
const COMPANIES = 'flex min-h-0 w-[calc(100%+6px)] flex-initial flex-col gap-8 -m-3 overflow-y-auto p-3'
const COMPANIES_CAPPED = 'max-h-270'
const COMPANIES_SEARCHING = 'h-270'
/* Frames `yIGme`, `sM1IQ` and `grF2I`: the kit's filled filter, 32 tall, 8 above the rows. */
const SEARCH_ROW = 'w-full shrink-0 pb-8'
const NO_MATCH = 'm-0 px-2 py-10 text-muted-foreground text-13/[normal] font-normal'
const ACTIONS = 'flex w-full shrink-0 gap-10 pt-22'
const ACTION = 'flex-1 px-18 py-11 text-13-5/[normal]'
const ACTION_OUTLINE = 'flex-1 px-17 py-10 text-heading-ink text-13-5/[normal] [&_svg]:text-soft-ink'
/*
 * 646 from the top at the designed 680×740, which is 50 above the body's bottom. The window can be
 * made taller, so past that height the footer stays 50 above the bottom rather than 646 from the
 * top, where it would sit halfway up and under the column.
 */
const FOOTER = 'absolute top-[max(646px,calc(100%_-_50px))] right-44 left-44 flex items-center gap-10'
const VERSION =
  'm-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-code text-muted-foreground text-11/[normal] font-normal'
/* The error takes the window's own face rather than the version's mono, and its own ink. */
const VERSION_ERROR =
  'm-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-sans text-status-error-foreground text-11/[normal] font-normal'
const HINT = 'flex shrink-0 items-center gap-6 whitespace-nowrap text-muted-foreground text-11/[normal] font-normal'
const KEY = 'rounded-[6px] border border-launcher-key-border px-6 py-2 font-code text-11/[normal] font-semibold'

/*
 * A row is a button in a wrapper, and `data-row` on the wrapper is what the ⋯ reads. Not Tailwind's
 * `group`: that class compiles to no rule at all, which `tailwind.test.ts` fails on, and
 * `group-hover` wraps itself in `@media (hover: hover)` — a guard this stylesheet never had.
 */
const ROW_WRAP = 'relative shrink-0'
const ROW =
  'm-0 flex w-full shrink-0 cursor-pointer items-center gap-12 rounded-sm border border-border bg-card p-10 text-left font-sans text-[length:inherit] text-inherit'
const ROW_HIGHLIGHTED = 'border-launcher-selected bg-secondary'
/* A Company whose folder is gone (T57): muted, and Forget is its only action. */
const ROW_MISSING = 'cursor-default opacity-55'
const AVATAR =
  'flex h-38 w-38 shrink-0 items-center justify-center rounded-sm whitespace-nowrap text-13/[normal] font-bold'
const AVATAR_TONE: Record<string, string> = {
  info: 'bg-primary-subtle text-status-info-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  success: 'bg-status-success text-status-success-foreground',
  error: 'bg-status-error text-status-error-foreground',
}
const ROW_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const ROW_LINE = 'flex w-full min-w-0 items-center gap-8'
const ROW_NAME =
  'max-w-[70%] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground text-14/[normal] font-bold'
const ROW_PATH =
  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-code text-muted-foreground text-11/[normal] font-normal'
const ROW_META = 'overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-11/[normal] font-normal'
/* The badge is the kit's; the frame draws this one smaller, dot and all. */
const SETUP_BADGE = 'px-8 py-2 text-10/[normal] [&_[data-slot=badge-dot]]:h-5 [&_[data-slot=badge-dot]]:w-5'
const ENTER =
  'flex shrink-0 items-center gap-6 rounded-[6px] border border-launcher-key-border bg-launcher-key-fill px-8 py-4 whitespace-nowrap text-soft-ink text-11/[normal] font-semibold'
const GO = 'shrink-0 text-muted-foreground'
const FORGET = 'absolute top-1/2 right-8 -translate-y-1/2 px-10 py-5 text-muted-foreground text-11-5/[normal]'
/* Out until the row is hovered, focused or highlighted — the wrapper is the `group`. */
const MORE =
  'absolute top-1/2 right-8 -translate-y-1/2 opacity-0 [[data-row]:hover_&]:opacity-100 [[data-row]:focus-within_&]:opacity-100 [[data-row]:has([data-highlighted])_&]:opacity-100'

export interface LauncherViewProps {
  /** Known Companies, in the Launcher's order. */
  summaries: CompanySummary[]
  now: Date
  highlight: number
  version: string
  error: string | null
  onHighlight(index: number): void
  onOpen(summary: CompanySummary): void
  onCreate(): void
  onOpenFolder(): void
  /** Opens a row's Company actions (Remove from launcher, Delete company…) at `anchor`. */
  onMenu?: ((summary: CompanySummary, anchor: MenuAnchor) => void) | undefined
  /** Forget on a row whose folder is gone: it leaves the Launcher (T57); no button without it. */
  onForget?: ((summary: CompanySummary) => void) | undefined
  /** Move… under the row of a Company in a temporary folder (decision 45); no warning without it. */
  move?: Pick<CompanyMove, 'isTemporary' | 'moving' | 'error' | 'move'>
  /** What the search holds; the rows are the Companies it matches, and `highlight` counts in them. */
  query?: string
  /** The search is drawn past four Companies (T267), and only when something takes what is typed. */
  onQuery?: ((query: string) => void) | undefined
}

/** The Launcher (design/html/launcher.html, frame `jPSiE`): the window with no Company open. */
export function LauncherView(props: LauncherViewProps) {
  const { summaries, onMenu, onForget, move, onQuery } = props
  const query = props.query ?? ''
  const latest = summaries[0]
  const searchable = Boolean(onQuery) && summaries.length > VISIBLE_ROWS
  const rows = searchable ? filterSummaries(summaries, query) : summaries
  return (
    <LauncherFrame name="Desktop App / Launcher">
      <div className={LAUNCHER_BODY}>
        <div className={HEAD}>
          <LogoMark size={78} className={LAUNCHER_MARK} />
          <h1 className={LAUNCHER_WORDMARK}>{latest?.name ?? 'tinycorp'}</h1>
          <p className={LAUNCHER_TAGLINE}>
            {latest ? 'Open a company to put its office back to work.' : 'Create a company to put an office to work.'}
          </p>
        </div>

        {summaries.length > 0 && (
          <>
            <div className={LIST_HEAD}>
              <span className={LIST_LABEL} id="launcher-companies">
                YOUR COMPANIES
              </span>
              <span className={COUNT}>{summaries.length}</span>
            </div>
            {searchable && (
              <div className={SEARCH_ROW}>
                <Search
                  tone="filled"
                  placeholder="Search companies"
                  value={query}
                  autoComplete="off"
                  spellCheck={false}
                  data-launcher-search
                  onChange={(event) => onQuery?.(event.target.value)}
                />
              </div>
            )}
            <fieldset
              className={cx(COMPANIES, searchable ? COMPANIES_SEARCHING : COMPANIES_CAPPED)}
              aria-labelledby="launcher-companies"
            >
              {rows.length === 0 && <p className={NO_MATCH}>{noMatch(query)}</p>}
              {rows.map((summary, index) => (
                <Fragment key={summary.id}>
                  <CompanyRow
                    summary={summary}
                    now={props.now}
                    highlighted={index === props.highlight}
                    shortcut={index < SHORTCUT_ROWS ? index + 1 : null}
                    onHighlight={() => props.onHighlight(index)}
                    onOpen={() => props.onOpen(summary)}
                    onMenu={onMenu && ((anchor) => onMenu(summary, anchor))}
                    onForget={onForget && (() => onForget(summary))}
                  />
                  {move?.isTemporary(summary) && (
                    <TemporaryFolderWarning
                      compact
                      busy={move.moving === summary.id}
                      error={move.error?.companyId === summary.id ? move.error.message : null}
                      onMove={() => move.move(summary)}
                    />
                  )}
                </Fragment>
              ))}
            </fieldset>
          </>
        )}

        <div className={ACTIONS}>
          <Button size="toolbar" icon={Plus} className={ACTION} onClick={props.onCreate}>
            Create a company
          </Button>
          <Button
            size="toolbar"
            variant="outline"
            icon={FolderOpen}
            className={ACTION_OUTLINE}
            onClick={props.onOpenFolder}
          >
            Open an existing folder…
          </Button>
        </div>

        <footer className={FOOTER}>
          {props.error ? (
            <p className={VERSION_ERROR} role="alert">
              {props.error}
            </p>
          ) : (
            <p className={VERSION}>{versionLabel(props.version)}</p>
          )}
          <span className={HINT}>
            <kbd className={KEY}>{modifierLabel()}</kbd>
            <kbd className={KEY}>1–{SHORTCUT_ROWS}</kbd>
            <span>opens a company</span>
          </span>
        </footer>
      </div>
    </LauncherFrame>
  )
}

function CompanyRow(props: {
  summary: CompanySummary
  now: Date
  highlighted: boolean
  shortcut: number | null
  onHighlight(): void
  onOpen(): void
  onMenu?: ((anchor: MenuAnchor) => void) | undefined
  onForget?: (() => void) | undefined
}) {
  const { summary, onMenu, onForget } = props
  // A Company with nothing to open — its folder gone, or its database on another PC — is an
  // unavailable row whose one action is Forget (T57, T256).
  const missing = unavailable(summary)
  const menu = missing ? undefined : onMenu
  const forget = missing ? onForget : undefined
  return (
    // The row itself is the button inside this wrapper; right-click only opens the menu that the
    // ⋯ button beside it opens too.
    // biome-ignore lint/a11y/noStaticElementInteractions: the keyboard path is the row and its ⋯ button.
    <div
      className={ROW_WRAP}
      data-row
      onContextMenu={
        menu &&
        ((event) => {
          event.preventDefault()
          props.onHighlight()
          menu(pointerAnchor(event))
        })
      }
    >
      <button
        type="button"
        className={rowClass(missing, props.highlighted, Boolean(menu), Boolean(forget))}
        disabled={missing}
        // The ⋯ reads this off the wrapper: `group-has-data-highlighted` is what the row being
        // highlighted used to say through `:has(.is-highlighted)`.
        data-highlighted={props.highlighted || undefined}
        aria-current={summary.current || undefined}
        aria-keyshortcuts={missing || !props.shortcut ? undefined : `Meta+${props.shortcut}`}
        title={summary.folder}
        onMouseMove={props.highlighted ? undefined : props.onHighlight}
        onFocus={props.onHighlight}
        onClick={props.onOpen}
      >
        <span
          className={cx(AVATAR, AVATAR_TONE[companyTone(summary.key)])}
          // The tone used to be legible in the class name; on utilities it is a set of colours, so
          // the band the Company was given is said here instead.
          data-tone={companyTone(summary.key)}
          aria-hidden
        >
          {summary.logo ? (
            <img src={summary.logo} alt="" className="size-full rounded-[inherit] object-cover" draggable={false} />
          ) : (
            initialsOf(summary.name)
          )}
        </span>
        <span className={ROW_TEXT}>
          <span className={ROW_LINE}>
            <span className={ROW_NAME}>{summary.name}</span>
            {setupUnfinished(summary) && (
              <Badge variant="warning" className={SETUP_BADGE}>
                {SETUP_UNFINISHED}
              </Badge>
            )}
            <span className={ROW_PATH}>{tildePath(summary.folder)}</span>
          </span>
          <span className={ROW_META}>{companyMeta(summary, props.now)}</span>
        </span>
        {missing ? null : props.highlighted ? (
          <span className={ENTER} aria-hidden>
            <span className="font-code">↵</span>
            <span>Open</span>
          </span>
        ) : (
          <ChevronRight size={16} aria-hidden className={GO} />
        )}
      </button>
      {forget && (
        <Button
          size="sm"
          variant="outline"
          icon={FolderX}
          className={FORGET}
          title={`Remove ${summary.name} from the launcher`}
          onFocus={props.onHighlight}
          onClick={forget}
        >
          Forget
        </Button>
      )}
      {menu && (
        <IconButton
          size="sm"
          icon={Ellipsis}
          label={`${summary.name} actions`}
          aria-haspopup="menu"
          className={MORE}
          onFocus={props.onHighlight}
          onClick={(event) => menu(elementAnchor(event.currentTarget))}
        />
      )}
    </div>
  )
}

/**
 * The row's classes: a missing folder mutes it, the highlight only lands on one that can open, and
 * the right padding is whatever the buttons parked over the row need.
 */
function rowClass(missing: boolean, highlighted: boolean, menu: boolean, forget: boolean): string {
  const room = forget ? 'pr-96' : menu ? 'pr-44' : ''
  if (missing) return cx(ROW, ROW_MISSING, room)
  return highlighted ? cx(ROW, ROW_HIGHLIGHTED, room) : cx(ROW, room)
}

export interface LauncherProps {
  current: Company | null
  step: LauncherStep
  onStep(step: LauncherStep): void
  /** Cancel on the Create step: back to the list, or to the Company it was opened from. */
  onCancelCreate(): void
  /** Leaves the Launcher for the current Company; `switched` when it is another one than before. */
  onClose(switched: boolean): void
  /** A Company was created from the Create step and is now current. */
  onCreated(company: Company): void
}

/** The Launcher bound to the engine: known Companies, opening a folder and the Create step. */
export function Launcher({ current, step, onStep, onCancelCreate, onClose, onCreated }: LauncherProps) {
  const api = window.tinyCorp
  const [summaries, setSummaries] = useState<CompanySummary[]>([])
  const [now, setNow] = useState(() => new Date())
  const [highlight, setHighlight] = useState(0)
  // The search's text (T267): the rows, the highlight and the shortcuts all count in what it matches.
  const [query, setQuery] = useState('')
  const queryNow = useRef('')
  const [draft, setDraft] = useState<CompanyDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const highlighted = useRef<string | null>(null)
  // Where a new Company's folder is suggested, and which folders OneDrive syncs (T252).
  const folderHints = useIpcResource(resources.folderHints)

  const refresh = useCallback(async () => {
    const ordered = byRecency(await api.launcher.summaries())
    setSummaries(ordered)
    setNow(new Date())
    // Keep the highlight on the same Company across refreshes; start on the most recent one.
    const kept = visibleRows(ordered, queryNow.current).findIndex((summary) => summary.id === highlighted.current)
    setHighlight(kept === -1 ? 0 : kept)
  }, [])

  const removal = useCompanyRemoval(useCallback(() => void refresh(), [refresh]))
  const move = useCompanyMove(useCallback(() => void refresh(), [refresh]))

  const rows = useMemo(() => visibleRows(summaries, query), [summaries, query])
  const searchable = summaries.length > VISIBLE_ROWS
  const search = useCallback((next: string) => {
    queryNow.current = next
    setQuery(next)
    setHighlight(0)
  }, [])

  useEffect(() => {
    highlighted.current = rows[highlight]?.id ?? null
  }, [rows, highlight])

  useEffect(() => {
    void refresh()
    const stops = [api.company.onChanged(() => void refresh()), api.sessions.onChanged(() => void refresh())]
    const timer = setInterval(() => void refresh(), 60_000)
    return () => {
      for (const stop of stops) stop()
      clearInterval(timer)
    }
  }, [refresh])

  const settle = useCallback(
    async (action: Promise<{ ok: boolean; error?: string }>) => {
      const result = await action
      setError(result.ok ? null : (result.error ?? null))
      if (result.ok) onClose(true)
    },
    [onClose],
  )

  const open = useCallback(
    (summary: CompanySummary) => {
      // A folder that is gone, or a database this PC does not hold, has nothing to open: the row
      // says so instead of failing (T57, T256).
      const refusal = unavailableMessage(summary)
      if (refusal) return setError(refusal)
      if (summary.current) onClose(false)
      else void settle(api.company.switchTo(summary.id))
    },
    [onClose, settle],
  )

  const cancelCreate = useCallback(() => {
    setDraft(EMPTY_DRAFT)
    setError(null)
    onCancelCreate()
  }, [onCancelCreate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      const inSearch = Boolean(target?.closest('[data-launcher-search]'))
      if (event.key === 'Escape') {
        // A search with something in it is cleared first; the next Esc does what Esc always did.
        if (step === 'list' && queryNow.current) return search('')
        if (step === 'create') cancelCreate()
        else if (current) onClose(false)
        return
      }
      if (step !== 'list') return
      // Typing anywhere in the window starts the search, and the character lands in it.
      if (searchable && !inSearch && startsSearch(event) && !target?.closest('input, textarea, select')) {
        document.querySelector<HTMLInputElement>('[data-launcher-search]')?.focus()
        return
      }
      // A focused button handles its own Enter; the search's Enter opens the highlighted row.
      if (event.key === 'Enter' && !inSearch && target?.closest('button, input, textarea, select')) return
      // Home and End move the caret in the search, not the highlight.
      if (inSearch && (event.key === 'Home' || event.key === 'End')) return
      const action = launcherKey(event, highlight, rows.length)
      if (!action) return
      event.preventDefault()
      if (action.kind === 'highlight') setHighlight(action.index)
      else open(rows[action.index]!)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, current, highlight, rows, searchable, search, open, cancelCreate, onClose])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the highlight moving is what scrolls; the effect reads the row out of the document.
  useEffect(() => {
    // `data-highlighted` and not a class: on utilities the row's highlight is a set of colours
    // with no name of its own, and the attribute is what the ⋯ reads too.
    document.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  async function detectRepo(path: string) {
    const detected = await api.launcher.detectRepo(path)
    if (!detected.ok) return setError(detected.error)
    setError(null)
    setDraft((before) => ({ ...before, repo: detected.value }))
  }

  if (step === 'create') {
    return (
      <CreateCompanyView
        draft={draft}
        hints={folderHints}
        busy={busy}
        error={error}
        onDraft={(patch) => setDraft((before) => ({ ...before, ...patch }))}
        onBrowseFolder={async () => {
          const folder = await api.company.pickFolder()
          if (!folder) return
          const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? ''
          setDraft((before) => ({ ...before, folder, name: before.name.trim() ? before.name : name }))
        }}
        onBrowseRepo={async () => {
          const path = await api.repos.pickFolder()
          if (path) await detectRepo(path)
        }}
        onRepoInitialised={(path) => void detectRepo(path)}
        onBack={() => {
          setError(null)
          onStep('list')
        }}
        onCancel={cancelCreate}
        onCreate={async () => {
          setBusy(true)
          try {
            const result = await createCompany(api, draft, folderHints)
            setError(result.ok ? null : result.error)
            if (result.ok) {
              setDraft(EMPTY_DRAFT)
              onCreated(result.value)
            }
          } finally {
            setBusy(false)
          }
        }}
      />
    )
  }

  return (
    <>
      <LauncherView
        summaries={summaries}
        now={now}
        highlight={highlight}
        version={__APP_VERSION__}
        error={error}
        onHighlight={setHighlight}
        onOpen={open}
        onCreate={() => {
          setError(null)
          onStep('create')
        }}
        onOpenFolder={async () => {
          const folder = await api.company.pickFolder()
          if (folder) await settle(api.company.open(folder))
        }}
        onMenu={removal.openMenu}
        onForget={removal.forget}
        move={move}
        query={query}
        onQuery={search}
      />
      {removal.overlay}
    </>
  )
}

/** The rows the Launcher shows: every Company, or past four of them the ones the search matches. */
function visibleRows(summaries: CompanySummary[], query: string): CompanySummary[] {
  return summaries.length > VISIBLE_ROWS ? filterSummaries(summaries, query) : summaries
}
