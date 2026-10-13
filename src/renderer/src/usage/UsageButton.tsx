import { ChevronUp, Gauge, RefreshCw } from 'lucide-react'
import { type Ref, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nameList } from '../../../shared/domain/providers'
import {
  EMPTY_USAGE_SNAPSHOT,
  PROVIDER_NAME,
  USAGE_PROVIDERS,
  type UsageSnapshot,
} from '../../../shared/usage/provider-usage'
import { useRoutingSettings } from '../routing'
import { openSignIn } from '../sign-in'
import { Badge, cx, ProviderMark, SHELL_BUTTON } from '../ui'
import {
  type AccountMeterRow,
  type MeterView,
  type ProviderRow,
  shortReason,
  USAGE_FOOTER,
  USAGE_SCOPE,
  USAGE_UNAVAILABLE,
  type UsageView,
  usageView,
} from './usage-model'
import '../ui/tailwind.css'

/** How often the popover's `Resets in …` countdowns redraw while it is open. */
const TICK_MS = 30_000

/** What the inert `Providers` link names in its title: every Provider the popover lists. */
export const PROVIDERS_LINK_TITLE = nameList(USAGE_PROVIDERS.map((id) => PROVIDER_NAME[id]))

/** What the Providers report, kept live, with a clock for the reset countdowns. */
/** How often the usage is asked again while the app is open: the main process's cache lifetime. */
export const USAGE_AUTO_REFRESH_MS = 60_000

export function useProviderUsage(ticking: boolean): {
  view: UsageView
  /** The answer itself, for a card that reads a window per account rather than per Provider. */
  snapshot: UsageSnapshot
  refreshing: boolean
  refresh(): void
} {
  const [snapshot, setSnapshot] = useState<UsageSnapshot>(EMPTY_USAGE_SNAPSHOT)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => new Date())
  // The boss's sign-ins, so a Provider with more than one draws a row for each (T173, frame `nV8jR`).
  const routing = useRoutingSettings()

  useEffect(() => {
    const api = window.tinyCorp.usage
    let live = true
    const read = async () => {
      const result = await api.read()
      if (live && result.ok) setSnapshot(result.value)
    }
    void read()
    // A fresh read in the main process — ours or a Session's limit — lands here as the cached answer.
    const stop = api.onChanged(() => void read())
    // Kept current on its own (T279): asked again every minute and whenever the window comes back.
    // The main process answers from its cache until that is a minute old, so no Provider is asked
    // more than once a minute however many of these are mounted.
    const timer = setInterval(() => void read(), USAGE_AUTO_REFRESH_MS)
    const onFocus = () => void read()
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      stop()
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // The countdowns only move while the boss is looking at them.
  useEffect(() => {
    if (!ticking) return
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void window.tinyCorp.usage.refresh().then((result) => {
      setRefreshing(false)
      if (result.ok) setSnapshot(result.value)
    })
  }, [])

  return { view: usageView(snapshot, now, routing?.accounts ?? []), snapshot, refreshing, refresh }
}

/**
 * The Usage row at the foot of the Company drawer, above the boss (frame `AAI0w`): a gauge, the
 * word `Usage`, a mini meter with the current percentage, and a chevron that opens the popover.
 */
export function UsageButton() {
  const [open, setOpen] = useState(false)
  const { view, refreshing, refresh } = useProviderUsage(open)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <UsageRow view={view} ref={anchor} open={open} onToggle={() => setOpen((was) => !was)} />
      {open &&
        createPortal(
          <UsagePopover
            view={view}
            refreshing={refreshing}
            onRefresh={refresh}
            anchor={anchor.current?.getBoundingClientRect() ?? null}
            onClose={close}
          />,
          document.body,
        )}
    </>
  )
}

/** The 276x36 row itself. */
export function UsageRow({
  view,
  open,
  onToggle,
  ref,
}: {
  view: UsageView
  open?: boolean
  onToggle?(): void
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(SHELL_BUTTON, BUTTON)}
      data-ui="Usage Button"
      aria-label={view.label}
      aria-expanded={open ?? false}
      aria-haspopup="dialog"
      title={view.label}
      onClick={onToggle}
    >
      <Gauge size={16} aria-hidden />
      <span className="font-semibold text-(--usage-ink) text-12-5/normal">Usage</span>
      <span className="flex-1" aria-hidden />
      {/* `Mini Meter`: the track and its readout sit closer to each other than to the chevron. */}
      <span className="flex shrink-0 items-center gap-7">
        {/* The drawer's own meter is 42 wide and draws its bar a shade softer than the card's: the
            bar reads `--usage-ink`, so softening it is one property, not a second rule. */}
        <Meter percent={view.percent} className="w-42 [--usage-ink:var(--muted-foreground)]" />
        <span data-ui="Usage Value" className="font-bold text-11-5/normal text-foreground">
          {view.value}
        </span>
      </span>
      <ChevronUp className="shrink-0 text-muted-foreground" size={14} aria-hidden />
    </button>
  )
}

export interface UsagePopoverProps {
  view: UsageView
  refreshing: boolean
  onRefresh(): void
  /** Where the button sits, so the card opens over it; null puts it at the drawer's foot. */
  anchor: ButtonAnchor | null
  onClose(): void
}

/** The 360-wide card above the Usage button, closed by a click outside or Escape. */
export function UsagePopover({ view, refreshing, onRefresh, anchor, onClose }: UsagePopoverProps) {
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element
      // The button that opened the card closes it itself.
      if (!card.current?.contains(target) && !target.closest('[aria-haspopup="dialog"]')) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointer, true)
    // Capture, so a view's own Escape waits until the popover is gone.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={card} role="dialog" aria-label="Usage" className={USAGE_POPOVER} style={popoverPosition(anchor)}>
      <UsageCard view={view} refreshing={refreshing} onRefresh={onRefresh} />
    </div>
  )
}

/** The card's contents; static, so it renders without a DOM. */
export function UsageCard({
  view,
  refreshing,
  onRefresh,
}: {
  view: UsageView
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-10 px-16 pt-14 pb-10">
        <p className="m-0 font-bold text-15/normal text-foreground tracking-[-0.2px]">Usage</p>
        <span className="flex-1" aria-hidden />
        <span className="text-11-5/normal text-muted-foreground">{USAGE_SCOPE}</span>
        <button
          type="button"
          className={cx(SHELL_BUTTON, REFRESH)}
          aria-label="Refresh"
          title="Refresh"
          data-refreshing={refreshing || undefined}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>

      {view.rows.map((row) => (
        <ProviderCard key={row.id} row={row} onRetry={onRefresh} />
      ))}

      <div className="flex shrink-0 items-center gap-10 border-t border-t-border px-16 pt-11 pb-13">
        <p className="m-0 flex-1 text-11-5/16 text-muted-foreground">{USAGE_FOOTER}</p>
        {/* Inert: Providers have no page of their own yet, so the frame's link only names them. */}
        <span
          data-ui="Providers Link"
          className="shrink-0 whitespace-nowrap font-bold text-(--usage-ink) text-11-5/normal"
          title={PROVIDERS_LINK_TITLE}
        >
          Providers
        </span>
      </div>
    </>
  )
}

/** One Provider: its mark and name, the note beside it, and its meters or what stands in for them. */
export function ProviderCard({ row, onRetry }: { row: ProviderRow; onRetry(): void }) {
  const accounts = row.accounts
  return (
    <div className={ROW} data-provider={row.id} data-kind={row.kind} data-accounts={accounts.length > 0 || undefined}>
      {/* A Provider with no source yet reads as the frame draws it: its contents dimmed. The frame's
          dividers are the rows' own top edge, so the dimming must not reach it. */}
      <div className={HEAD}>
        <span className={MARK} aria-hidden>
          <ProviderMark provider={row.id} size={15} />
        </span>
        <span data-ui="Provider Name" className={NAME}>
          {row.name}
        </span>
        {/* An unreadable Provider carries its reason on the line below, not beside its name. A
            Provider with sign-ins says how many, where the one with a single sign-in says when it
            resets — each of its accounts carries its own reset time (frame `nV8jR`). */}
        {row.note && row.kind !== 'unavailable' && (
          <span data-ui="Provider Note" className="whitespace-nowrap text-12/normal text-muted-foreground">
            {row.note}
          </span>
        )}
        <span className="flex-1" aria-hidden />
        {/* A row is not a link: only a Provider that needs something carries a control. */}
        {row.kind === 'not-connected' && (
          // Inert: TinyCorp has no source for this Provider yet, as the frame draws it.
          <span className={CONNECT} title={row.reason ?? row.note}>
            Connect
          </span>
        )}
        {row.kind === 'unavailable' &&
          (row.signIn ? (
            // What is missing is the login, and signing in is what fixes it (T263).
            <button
              type="button"
              className={cx(SHELL_BUTTON, RETRY)}
              onClick={() => openSignIn({ provider: row.id, accountId: null })}
            >
              {SIGN_IN}
            </button>
          ) : (
            <button type="button" className={cx(SHELL_BUTTON, RETRY)} onClick={onRetry}>
              Retry
            </button>
          ))}
      </div>
      {/* `Usage unavailable` and the sentence behind it: a reason, never a zero. */}
      {row.kind === 'unavailable' && accounts.length === 0 && (
        <p className="m-0 flex flex-col gap-2">
          <span className="font-semibold text-12/normal text-status-warning-foreground">{USAGE_UNAVAILABLE}</span>
          <Reason ui="Provider Reason" text={row.note} />
        </p>
      )}
      {/* One block per sign-in, each with its own reset time and its own meters (frame `nV8jR`). */}
      {accounts.map((account) => (
        <AccountBlock key={account.id} provider={row.id} account={account} />
      ))}
      {row.kind === 'ready' && accounts.length === 0 && (
        <div className="flex items-center gap-10">
          {row.meters.map((meter) => (
            <Readout key={meter.label} meter={meter} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One sign-in (frame `nV8jR`): who it is, the `Default` mark on the one Employees take, its own
 * reset time, and its own meters under them.
 *
 * A sign-in whose login could not be read says `usage not read` where its reset time goes — the
 * words Your profile's own card uses (frame `Oykzs`) — and the sentence behind it, which names
 * where TinyCorp looked, in the muted line the unreadable Provider already has. The frames draw an
 * account no second line, so it is that line rather than one invented here.
 */
function AccountBlock({ provider, account }: { provider: string; account: AccountMeterRow }) {
  return (
    <div data-ui="Account" data-account={account.id} className="flex flex-col gap-6">
      <div className="flex items-center gap-8">
        <span data-ui="Account Label" className="font-semibold text-12-5/normal text-foreground">
          {account.label}
        </span>
        {account.isDefault && <Badge data-ui="Account Default">{DEFAULT_ACCOUNT}</Badge>}
        <span className="flex-1" aria-hidden />
        <span data-ui="Account Note" className="whitespace-nowrap text-12/normal text-muted-foreground">
          {account.note}
        </span>
        {account.signIn && (
          <button
            type="button"
            className={cx(SHELL_BUTTON, RETRY)}
            onClick={() => openSignIn({ provider, accountId: account.id })}
          >
            {SIGN_IN}
          </button>
        )}
      </div>
      {account.meters.length > 0 && (
        <div className="flex items-center gap-14">
          {account.meters.map((meter) => (
            <Readout key={meter.label} meter={meter} />
          ))}
        </div>
      )}
      {account.reason && <Reason ui="Account Reason" text={account.reason} />}
    </div>
  )
}

/**
 * The muted sentence under a row. It wraps anywhere rather than widening the popover: a path has
 * no spaces to break at, and the short form of it is still one word (T262).
 */
const REASON = 'min-w-0 text-11-5/16 text-muted-foreground [overflow-wrap:anywhere]'

/** A reason in its short form, and the whole of it on hover wherever the short form left some out. */
function Reason({ ui, text }: { ui: string; text: string }) {
  const short = shortReason(text)
  return (
    <span data-ui={ui} className={REASON} title={short === text ? undefined : text}>
      {short}
    </span>
  )
}

/** The mark on the sign-in an Employee takes when nothing pins another. */
export const DEFAULT_ACCOUNT = 'Default'

/** What a row whose login is missing offers: the sign-in modal (T263). */
export const SIGN_IN = 'Sign in'

/** One meter: its label, its track and its percentage. */
function Readout({ meter }: { meter: MeterView }) {
  return (
    <span className="flex shrink-0 items-center gap-6">
      <span data-ui="Meter Label" className="text-10-5/normal text-muted-foreground">
        {meter.label}
      </span>
      <Meter percent={meter.percent} className="w-38" />
      <span data-ui="Meter Value" className="font-bold text-11-5/normal text-foreground">
        {meter.value}
      </span>
    </span>
  )
}

/**
 * A meter track with its bar; an unknown percentage leaves the track empty rather than at zero.
 *
 * The width comes from the caller and never from here: two meters of different widths would be two
 * `w-*` utilities in one layer, and which one drew would be the order Tailwind happened to emit
 * them in rather than anything this file said.
 */
export function Meter({ percent, className }: { percent: number | null; className: string }) {
  return (
    <span data-ui="Meter" className={cx(TRACK, className)} aria-hidden>
      {percent !== null && <span className="rounded-full bg-(--usage-ink)" style={{ width: `${percent}%` }} />}
    </span>
  )
}

/*
 * The frame's measurements, as utilities (T210f). `--usage-ink`, `--usage-edge` and the card's
 * shadow are the frame's own and no `--elevation-*` or colour token carries them, so they stay as
 * they were written — set on the two roots, where everything inside reads them.
 *
 * A size is a step of the scale, with `/normal` where the frame gave the line no measurement of its
 * own: the scale's default leading is a paragraph's, and a meter's readout is not a paragraph.
 */
/** The drawer's Usage row (frame `AAI0w`), and the frame's rule above it. */
const BUTTON =
  '[--usage-ink:#cbd5e1] flex w-full shrink-0 items-center gap-10 border-t border-t-border bg-card px-14 pt-9 pb-10 text-muted-foreground hover:bg-secondary'

/**
 * The 360-wide card above it (frame `TMviL`). Pen draws strokes inside the box.
 *
 * Exported because the capture harness draws the same card standing still, and a harness with its
 * own copy of the frame is the drift `design:compare` exists to catch.
 */
export const USAGE_POPOVER =
  '[--usage-ink:#cbd5e1] [--usage-edge:#ffffff1f] fixed z-40 flex flex-col items-stretch overflow-hidden rounded-md border border-(--usage-edge) bg-popover font-sans text-popover-foreground leading-normal shadow-[0px_14px_36px_0px_#00000073]'

const REFRESH =
  'flex shrink-0 p-0 text-muted-foreground not-disabled:hover:text-foreground data-refreshing:[&_svg]:animate-spin data-refreshing:[&_svg]:[animation-duration:900ms]'

/** One Provider. The frame puts a divider between the rows, not above the first. */
const ROW =
  'flex shrink-0 flex-col gap-9 px-16 py-12 data-accounts:gap-10 [[data-provider]+&]:border-t [[data-provider]+&]:border-t-border'

const HEAD = 'flex items-center gap-11 [[data-kind=not-connected]_&]:opacity-70'

const MARK = 'flex h-30 w-30 shrink-0 items-center justify-center rounded-full bg-secondary text-(--usage-ink)'

const NAME = 'whitespace-nowrap font-bold text-14-5/normal text-foreground tracking-[-0.2px]'

const CONNECT = 'shrink-0 whitespace-nowrap rounded-sm px-10 py-5 font-semibold text-12/normal text-muted-foreground'

const RETRY =
  'shrink-0 whitespace-nowrap rounded-sm border border-border px-10 py-5 font-semibold text-12/normal text-(--usage-ink) hover:bg-secondary hover:text-foreground'

/** A meter: the track with its bar. An unknown percentage leaves the track empty. */
const TRACK = 'flex h-4 shrink-0 items-stretch overflow-hidden rounded-full bg-secondary'

/** The button's box, as far as the popover cares. */
export interface ButtonAnchor {
  left: number
  top: number
}

/** The card's width and the gap it keeps from the button and the window's edges. */
const POPOVER_WIDTH = 360
const GAP = 8
/** The Company rail the drawer sits beside (`.shell-rail`). */
const RAIL_WIDTH = 68
/** The drawer's own width, which the card may overhang. */
const DRAWER_WIDTH = 276

/** Above the Usage button, its left edge on the drawer's; without a measured button, at its foot. */
export function popoverPosition(
  anchor: ButtonAnchor | null,
  windowHeight = globalThis.window?.innerHeight ?? 0,
): { left: number; bottom: number; width: number } {
  const left = anchor ? anchor.left : RAIL_WIDTH + (DRAWER_WIDTH - POPOVER_WIDTH) / 2
  const bottom = anchor ? Math.max(GAP, windowHeight - anchor.top + GAP) : GAP
  return { left: Math.max(GAP, left), bottom, width: POPOVER_WIDTH }
}
