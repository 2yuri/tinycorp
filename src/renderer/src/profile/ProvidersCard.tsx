import {
  CircleUserRound,
  LogIn,
  Monitor,
  MoonStar,
  MoreHorizontal,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'

import { clockTime } from '../../../shared/platform/clock-time'
import { RUNS_IN_LABEL, WINDOWS_LABEL } from '../../../shared/platform/wsl'
import { ACCOUNT_LABEL_MAX, type AccountRow } from '../../../shared/usage/provider-accounts'
import { type UsageLevel, usageLevel } from '../../../shared/usage/provider-usage'
import { useEveryProvider } from '../preflight'
import { useRoutingSettings } from '../routing'
import { CARD_HEAD, CARD_SUB, CARD_TITLE, IDENTITY, SIDE_CARD } from './profile-style'
import '../ui/tailwind.css'
import { accountMeter } from '../settings'
import { openSignIn } from '../sign-in'
import { Button, cx, DropdownMenu, InputGroup, MenuItem, Progress, ProviderMark, useDismiss } from '../ui'
import { useProviderUsage } from '../usage'
import {
  PROVIDERS_CARD_SUB,
  PROVIDERS_CARD_TITLE,
  type ProviderRowView,
  type ProviderTone,
  providerRows,
  type RunsInView,
} from './providers-card'

/**
 * Your profile's Providers card (frames `Oykzs` and `A2lOk0`, T203a): one bordered box per
 * Provider the catalogue knows — the mark, the product, what it is signed in as, a badge and the
 * place it runs in — and, under a CLI that holds more than one sign-in, a row per account with its
 * own bar and `Add another account`.
 *
 * It sits here rather than in Company settings because it is a fact about this machine and this
 * person: every Company on the machine gets the same answer, and nothing about it can be set per
 * Company. No read here costs a subprocess — the preflight was asked before the window drew and
 * the numbers come from the same cached query the drawer's Usage button uses (T80).
 */
export function ProvidersCard() {
  const preflight = useEveryProvider()
  const { snapshot } = useProviderUsage(true)
  const routing = useRoutingSettings()
  return (
    <ProvidersCardBody
      rows={providerRows(preflight, snapshot, routing)}
      onPick={(provider, runtime) => void window.tinyCorp.profile.update({ providerRuntimes: { [provider]: runtime } })}
    />
  )
}

export interface ProvidersCardBodyProps {
  rows: ProviderRowView[]
  /**
   * The boss moved a Provider between Windows and WSL. It saves at once rather than into Your
   * profile's draft: it is not text being edited, it is where the next Session starts, and the
   * row redraws from the answer the engine sends back.
   */
  onPick?: ((provider: string, runtime: string) => void) | undefined
}

/** The card over its boxes: pure, so every state of it renders without the engine. */
export function ProvidersCardBody({ rows, onPick }: ProvidersCardBodyProps) {
  return (
    <section className={SIDE_CARD} aria-label={PROVIDERS_CARD_TITLE} data-ui="Providers">
      <div className={CARD_HEAD}>
        <h3 className={CARD_TITLE}>{PROVIDERS_CARD_TITLE}</h3>
        <p className={CARD_SUB}>{PROVIDERS_CARD_SUB}</p>
      </div>
      {rows.map((row) => (
        <ProviderBox key={row.id} row={row} onPick={onPick} />
      ))}
    </section>
  )
}

/** One Provider: the row itself, and the sign-ins it holds under it. */
function ProviderBox({ row, onPick }: { row: ProviderRowView; onPick?: ProvidersCardBodyProps['onPick'] }) {
  return (
    <div
      className={BOX}
      data-provider={row.id}
      data-idle={row.idle || undefined}
      data-accounts={row.accounts ? '' : undefined}
    >
      {/* The Provider's own line: mark, name, state. Everything else stacks under it. */}
      <div className="flex items-center gap-10">
        <span className={PROVIDER_ICON} aria-hidden>
          <ProviderMark provider={row.id} size={17} />
        </span>
        <span className="flex min-w-0 flex-1 basis-0 flex-col">
          <span data-ui="Provider Name" className={PROVIDER_NAME}>
            {row.title}
          </span>
          {row.detail && (
            <span
              data-ui="Provider Detail"
              className={PROVIDER_DETAIL}
              data-address={row.detailIsAddress || undefined}
              title={row.detailNote || undefined}
            >
              {row.detail}
            </span>
          )}
        </span>
        {/* The badge, and under it the chip naming where this CLI runs. The pair is taller than
            the mark beside it and is what sets the row's height: `Oykzs` draws a box of one row
            58px tall, which is the 42px pair inside 8px of padding, the 34px mark centred on it. */}
        <span className="flex shrink-0 flex-col items-end gap-4">
          <span data-ui="Provider Badge" className={cx(BADGE, BADGE_TONE[row.tone])}>
            <span className={cx(BADGE_DOT, BADGE_DOT_TONE[row.tone])} aria-hidden />
            {row.badge}
          </span>
          {row.runsIn && <RuntimeChip row={row} runsIn={row.runsIn} onPick={onPick} />}
        </span>
      </div>
      {row.runsIn?.note && (
        <p className={RUNS_NOTE}>
          <MoonStar size={13} aria-hidden />
          {row.runsIn.note}
        </p>
      )}
      {row.accounts && <AccountList provider={row.id} accounts={row.accounts} />}
    </div>
  )
}

/**
 * One Provider's sign-ins (frame `A2lOk0`): each with its label, plan, address, bar and reset, the
 * `Default` mark on the one Employees take, and `Add another account` under them.
 *
 * `Add another account` asks for the account's name first, then makes the directory and opens the
 * sign-in modal on it (T263): **the product's own login**, in a terminal inside TinyCorp. TinyCorp
 * never sees, types or stores the credential; the CLI asks for it and keeps it in that directory
 * (decision 3).
 */
function AccountList({ provider, accounts }: { provider: string; accounts: AccountRow[] }) {
  // The name being typed for a new account, or null while nobody is adding one.
  const [naming, setNaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async () => {
    const label = naming?.trim()
    if (!label) return
    setBusy(true)
    const created = await window.tinyCorp.routing.addAccount(provider, label)
    setBusy(false)
    if (!created.ok) return setError(created.error)
    setNaming(null)
    setError(null)
    const account = created.value.accounts.find((entry) => !accounts.some((known) => known.id === entry.id))
    if (account) openSignIn({ provider, accountId: account.id })
  }
  return (
    <div className="flex flex-col gap-10">
      {accounts.map((row) => (
        <AccountLine key={row.id} row={row} />
      ))}
      {naming === null ? (
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          className={ADD_BUTTON}
          onClick={() => setNaming(nextLabel(accounts.length))}
        >
          {ADD_ACCOUNT}
        </Button>
      ) : (
        <form
          className={cx('flex items-end gap-8', IDENTITY)}
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          <InputGroup
            className="min-w-0 flex-1 basis-0"
            label={ACCOUNT_NAME}
            value={naming}
            maxLength={ACCOUNT_LABEL_MAX}
            autoFocus
            onChange={(event) => setNaming(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNaming(null)
            }}
          />
          <Button type="submit" size="sm" icon={LogIn} disabled={busy || naming.trim() === ''}>
            {SIGN_IN}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNaming(null)}>
            Cancel
          </Button>
        </form>
      )}
      {error && <p className={cx(CARD_SUB, 'm-0')}>{error}</p>}
    </div>
  )
}

/** What the button under the sign-ins says. */
export const ADD_ACCOUNT = 'Add another account'

/** The label of the name a new account is asked for, before its sign-in. */
export const ACCOUNT_NAME = 'Account name'

/** The button that opens the sign-in modal on it. */
export const SIGN_IN = 'Sign in'

/** One sign-in: who it is over what it has spent, with what can be done to it behind the menu. */
function AccountLine({ row }: { row: AccountRow }) {
  const [menu, setMenu] = useState(false)
  // The name being typed over the label, or null while it is not being renamed.
  const [renaming, setRenaming] = useState<string | null>(null)
  const dismiss = useDismiss<HTMLDivElement, HTMLElement>(menu, () => setMenu(false))
  const percent = row.window?.percent ?? null
  const act = (run: () => unknown) => {
    setMenu(false)
    void run()
  }
  const rename = () => {
    const label = renaming?.trim()
    setRenaming(null)
    if (label && label !== row.label) void window.tinyCorp.routing.renameAccount(row.id, label)
  }
  return (
    <div data-ui="Account" className={ACCOUNT}>
      <div className="flex items-center gap-10">
        <span className="flex min-w-0 flex-1 basis-0 flex-col">
          {renaming === null ? (
            <span data-ui="Account Label" className={ACCOUNT_LABEL}>
              {row.label}
              {row.plan ? ` · ${row.plan}` : ''}
            </span>
          ) : (
            <input
              aria-label={`Rename ${row.label}`}
              className={RENAME}
              value={renaming}
              maxLength={ACCOUNT_LABEL_MAX}
              // biome-ignore lint/a11y/noAutofocus: the boss just asked to rename this one.
              autoFocus
              onChange={(event) => setRenaming(event.target.value)}
              onBlur={rename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') rename()
                if (event.key === 'Escape') setRenaming(null)
              }}
            />
          )}
          <span data-ui="Account Email" className={ACCOUNT_EMAIL}>
            {row.email ?? row.configDir}
          </span>
        </span>
        {row.isDefault && (
          <span data-ui="Account Default" className={ACCOUNT_DEFAULT}>
            {DEFAULT_ACCOUNT}
          </span>
        )}
        <div ref={dismiss.popover} className="relative flex shrink-0">
          <button
            type="button"
            className={MORE}
            aria-label={`More for ${row.label}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {menu && (
            <DropdownMenu className={DROPDOWN}>
              {!row.isDefault && (
                <MenuItem
                  icon={CircleUserRound}
                  label="Make default"
                  onClick={() => act(() => window.tinyCorp.routing.setDefaultAccount(row.id))}
                />
              )}
              <MenuItem icon={Pencil} label="Rename…" onClick={() => act(() => setRenaming(row.label))} />
              <MenuItem
                icon={LogIn}
                label="Sign in again…"
                onClick={() => act(() => openSignIn({ provider: row.provider, accountId: row.id }))}
              />
              {!row.primary && (
                <MenuItem
                  icon={Trash2}
                  label="Remove…"
                  destructive
                  onClick={() => act(() => window.tinyCorp.routing.removeAccount(row.id))}
                />
              )}
            </DropdownMenu>
          )}
        </div>
      </div>
      {/*
       * Every sign-in carries the frame's meter, not only the one TinyCorp reads with. The track
       * is drawn empty and the line says why when the numbers would have to come from that
       * sign-in's own credential, which TinyCorp never reads (decision 3) — an empty track is a
       * fact, a percentage nobody measured would be a lie.
       */}
      {/* The bar and the line beside it: the track takes what the line leaves (`Oykzs`), and the
          bar warms as the window fills, on the thresholds every other meter reads. */}
      <span
        data-ui="Account Meter"
        className={cx(METER, BAR_LEVEL[usageLevel(percent ?? 0)])}
        data-level={usageLevel(percent ?? 0)}
        title={row.reason ?? undefined}
      >
        <Progress value={percent ?? 0} />
        <span data-ui="Account Value" className={ACCOUNT_VALUE}>
          {accountMeter(row, (at) => clockTime(at, new Date()))}
        </span>
      </span>
    </div>
  )
}

/** The mark on the sign-in Employees take when nothing pins them to another. */
export const DEFAULT_ACCOUNT = 'Default'

/** The label a freshly added account carries until the boss renames it. */
export function nextLabel(existing: number): string {
  return existing === 1 ? 'Work' : `Account ${existing + 1}`
}

/**
 * `WSL · Ubuntu` (frames `Oykzs`, `I1i1Uo`): the place this CLI runs in, beside its badge.
 *
 * On a machine that really has two places it opens the others (T167) — a menu rather than the
 * segmented switch the card used to draw, because `Oykzs` gives the head one chip whether the
 * boss can change it or not, and a control nobody can see is worse than one that opens.
 */
function RuntimeChip({
  row,
  runsIn,
  onPick,
}: {
  row: ProviderRowView
  runsIn: RunsInView
  onPick?: ProvidersCardBodyProps['onPick']
}) {
  const [menu, setMenu] = useState(false)
  const dismiss = useDismiss<HTMLDivElement, HTMLElement>(menu, () => setMenu(false))
  const chosen = runsIn.options[0]
  if (!chosen) return null
  const label = `${RUNS_IN_LABEL} — ${row.title}`
  if (!runsIn.choosable) {
    return (
      <span data-ui="Runtime Chip" className={RUNTIME_CHIP} title={label}>
        <RuntimeMark label={chosen.label} />
        {chosen.label}
      </span>
    )
  }
  return (
    <div ref={dismiss.popover} className="relative flex">
      <button
        type="button"
        data-ui="Runtime Chip"
        className={cx(RUNTIME_CHIP, RUNTIME_OPEN)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu}
        title={runsIn.help || undefined}
        onClick={() => setMenu((open) => !open)}
      >
        <RuntimeMark label={chosen.label} />
        {chosen.label}
      </button>
      {menu && (
        <DropdownMenu className={DROPDOWN}>
          {runsIn.options.map((option) => (
            <MenuItem
              key={option.key}
              label={option.label}
              icon={option.label === WINDOWS_LABEL ? Monitor : SquareTerminal}
              highlighted={option.selected}
              onClick={() => {
                setMenu(false)
                onPick?.(row.id, option.key)
              }}
            />
          ))}
        </DropdownMenu>
      )}
    </div>
  )
}

/** The mark beside a place: a display for Windows, a terminal for a distro. */
function RuntimeMark({ label }: { label: string }) {
  const Icon = label === WINDOWS_LABEL ? Monitor : SquareTerminal
  return <Icon size={12} aria-hidden />
}

/*
 * The Providers card's own boxes (frames `Oykzs`, `A2lOk0`), as utilities (T210f). `#cbd5e1` is
 * the design's Slate 300, which the badge and the `Default` mark read; no token names it.
 *
 * Each Provider is its own outlined surface inside the card, the stroke drawn inside so it costs no
 * padding. A box that is only its row sits tight around it; one with sign-ins under it breathes.
 */
const BOX = 'inset-ring-1 inset-ring-border flex flex-col gap-10 rounded-sm bg-card px-12 py-8 data-accounts:p-12'

const PROVIDER_ICON =
  'flex h-34 w-34 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground'

/** A CLI nothing can run on is still listed, and drawn quieter than the ones that can. */
const PROVIDER_NAME = 'font-bold text-13 text-foreground in-data-idle:text-muted-foreground'

/** How many sign-ins the CLI holds, or what it reports of the one it has. An address is a machine's
    line, and is set in the machine's font. */
const PROVIDER_DETAIL = 'truncate text-11-5 text-muted-foreground data-address:font-code'

const BADGE = 'inline-flex shrink-0 items-center gap-6 rounded-full px-9 py-3 font-semibold text-10-5 text-[#cbd5e1]'

/** The badge's three tones: connected, something that will be billed, a CLI that cannot run at all. */
const BADGE_TONE: Record<ProviderTone, string> = {
  ok: 'bg-status-success',
  warn: 'bg-status-warning',
  off: 'bg-status-error',
}

const BADGE_DOT = 'h-6 w-6 rounded-full'

const BADGE_DOT_TONE: Record<ProviderTone, string> = {
  ok: 'bg-brand-success',
  warn: 'bg-brand-warning',
  off: 'bg-brand-danger',
}

/** The line a sleeping distro or a blocked network adds (`GacEW`). */
const RUNS_NOTE = 'm-0 flex items-center gap-6 text-12/[1.45] text-muted-foreground'

const ACCOUNT = 'inset-ring-1 inset-ring-border flex flex-col gap-6 rounded-sm px-10 py-8'

const ACCOUNT_LABEL = 'font-bold text-13/17 text-foreground'

const ACCOUNT_EMAIL = 'truncate font-code text-11-5 text-muted-foreground'

/** The label, as it is typed over: the same type, in a field that says it can be. */
const RENAME =
  'm-0 min-w-0 rounded-sm border border-border bg-transparent px-6 py-0 font-bold font-sans text-13/17 text-foreground focus-visible:shadow-focus focus-visible:outline-none'

const ACCOUNT_DEFAULT = 'shrink-0 rounded-full bg-secondary px-9 py-3 text-11 text-[#cbd5e1]'

const MORE =
  'flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

const DROPDOWN = 'absolute top-[calc(100%+6px)] right-0 z-20'

const METER =
  'flex items-center gap-12 [&_[data-slot=progress]]:w-auto [&_[data-slot=progress]]:flex-1 [&_[data-slot=progress-track]]:h-6'

/** The bar warms as the window fills, on the thresholds every other meter reads (`usageLevel`). */
const BAR_LEVEL: Record<UsageLevel, string> = {
  low: '[&_[data-slot=progress-bar]]:bg-brand-primary',
  high: '[&_[data-slot=progress-bar]]:bg-brand-warning',
  full: '[&_[data-slot=progress-bar]]:bg-brand-danger',
}

const ACCOUNT_VALUE = 'shrink-0 whitespace-nowrap font-code text-11-5 text-muted-foreground'

/** `Add another account` sits on the sign-ins' own left edge, with no button around it. */
const ADD_BUTTON =
  'gap-9 self-start px-0 py-4 font-normal text-12-5/normal text-muted-foreground hover:bg-transparent hover:text-foreground'

/**
 * `WSL · Ubuntu`: the place this CLI runs in, beside its badge. The stroke is drawn inside, as
 * every box on this card draws it.
 */
const RUNTIME_CHIP =
  'inset-ring-1 inset-ring-border m-0 inline-flex items-center gap-5 whitespace-nowrap rounded-sm border-0 bg-secondary px-8 py-3 font-sans font-semibold text-10-5 text-muted-foreground'

const RUNTIME_OPEN = 'cursor-pointer hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'
