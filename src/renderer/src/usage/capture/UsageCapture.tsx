// A dev-only capture of the Usage button and its popover against the design's own fixture, so they
// can be compared with `design/screens/AAI0w.png` and `TMviL.png`. Nothing here ships.
import type { ReactNode } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import type { ProviderAccount } from '../../../../shared/usage/provider-accounts'
import type { AccountUsage, ProviderUsage, UsageSnapshot } from '../../../../shared/usage/provider-usage'
import { notConnected } from '../../../../shared/usage/provider-usage'
import { SHELL } from '../../chrome'
import { SIDEBAR } from '../../shell'
import '../../ui/tailwind.css'

/** Frame `TMviL`'s numbers, with the reset times its `Resets in 4h 10m` counts down to. */
const READ_AT = new Date('2026-09-18T08:40:00Z')
const claude: ProviderUsage = {
  id: 'claude',
  name: 'Claude',
  problem: null,
  reason: null,
  accounts: [],
  windows: [
    { key: 'five_hour', label: '5h', percent: 6, resetsAt: '2026-09-18T12:50:00Z' },
    { key: 'seven_day', label: 'wk', percent: 15, resetsAt: '2026-09-20T22:00:00Z' },
    { key: 'seven_day_opus', label: 'Opus', percent: 6, resetsAt: '2026-09-20T22:00:00Z' },
  ],
}

/**
 * The frame's own Codex, drawn so the capture can be laid over `TMviL.png` row for row. These are
 * now the two windows the app really reads (T220) — `5h` and `wk`, from the ChatGPT login `codex
 * login` wrote — and a 5-hour window at 0% is a window that has just reset, not an invented zero:
 * a Provider TinyCorp cannot read carries no window at all, which is the row below.
 */
const codex: ProviderUsage = {
  id: 'codex',
  name: 'Codex',
  problem: null,
  reason: null,
  accounts: [],
  windows: [
    { key: 'five_hour', label: '5h', percent: 0, resetsAt: '2026-09-18T13:37:00Z' },
    { key: 'seven_day', label: 'wk', percent: 0, resetsAt: '2026-09-20T22:00:00Z' },
  ],
}

/** The three Providers the frame draws: the two TinyCorp reads, and one with no source. */
const SNAPSHOT: UsageSnapshot = {
  providers: [claude, codex, notConnected('opencode', 'TinyCorp has no usage source for OpenCode yet')],
  readAt: READ_AT.toISOString(),
}

/** The same card with Claude's numbers unreadable, so the third row kind has a capture too. */
const UNAVAILABLE: UsageSnapshot = {
  providers: [
    {
      ...claude,
      windows: [],
      problem: 'unavailable',
      reason: 'No Claude Code login found — sign in by running `claude`',
    },
    ...SNAPSHOT.providers.slice(1),
  ],
  readAt: READ_AT.toISOString(),
}

/**
 * Frame `nV8jR`: the same card with two sign-ins under Claude, each read from its own config
 * folder (T257). `Personal` is the default one and has the Opus window its plan tracks; `Work` is
 * a week and a session of its own — two accounts, two reads, two sets of numbers.
 */
const PERSONAL = 'primary:claude'
const WORK = 'work'

const personalUsage: AccountUsage = { id: PERSONAL, windows: claude.windows, problem: null, reason: null }

const workUsage: AccountUsage = {
  id: WORK,
  problem: null,
  reason: null,
  windows: [
    { key: 'five_hour', label: '5h', percent: 41, resetsAt: '2026-09-18T09:42:00Z' },
    { key: 'seven_day', label: 'wk', percent: 22, resetsAt: '2026-09-20T22:00:00Z' },
  ],
}

const ACCOUNTS: ProviderAccount[] = [
  {
    id: PERSONAL,
    provider: 'claude',
    label: 'Personal',
    plan: 'Max 20×',
    email: null,
    configDir: '/Users/boss/.claude',
    isDefault: true,
    primary: true,
  },
  {
    id: WORK,
    provider: 'claude',
    label: 'Work',
    plan: 'Team',
    email: null,
    configDir: '/Users/boss/Library/Application Support/TinyCorp/accounts/claude/work',
    isDefault: false,
    primary: false,
  },
]

const SEVERAL: UsageSnapshot = {
  providers: [{ ...claude, accounts: [personalUsage, workUsage] }, ...SNAPSHOT.providers.slice(1)],
  readAt: READ_AT.toISOString(),
}

const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

function stub(snapshot: UsageSnapshot): TinyCorpApi {
  return {
    usage: { read: () => ok(snapshot), refresh: () => ok(snapshot), onChanged: never },
  } as unknown as TinyCorpApi
}

/**
 * `?capture=button` is the 276-wide drawer row (`AAI0w`); `?capture=popover` is the card (`TMviL`),
 * `?capture=unavailable` the same card with a Provider that could not be read, and
 * `?capture=accounts` the card with two sign-ins under one Provider (`nV8jR`). `?capture=sign-in`
 * and `?capture=signed-in` are the sign-in modal's card (T263, `Tmldc` and `iA8Wm`).
 */
export async function usageCapture(which: string): Promise<ReactNode> {
  if (which === 'sign-in' || which === 'signed-in') return signInCapture(which === 'signed-in')
  const snapshot = which === 'unavailable' ? UNAVAILABLE : which === 'accounts' ? SEVERAL : SNAPSHOT
  const accounts = which === 'accounts' ? ACCOUNTS : []
  // The stub goes in before the view modules load: they read the preload API at import time.
  window.tinyCorp = stub(snapshot)
  const { UsageCard, UsageRow, USAGE_POPOVER } = await import('../UsageButton')
  const { usageView } = await import('../usage-model')
  const view = usageView(snapshot, READ_AT, accounts)
  if (which === 'button') {
    // Inside the drawer, so the row reads the drawer's own background and 276px width.
    return (
      <div className={SHELL}>
        <aside className={SIDEBAR} style={{ height: 'auto' }}>
          <UsageRow view={view} />
        </aside>
      </div>
    )
  }
  return (
    <div className={SHELL}>
      <div className={USAGE_POPOVER} style={{ position: 'static', width: 360 }}>
        <UsageCard view={view} refreshing={false} onRefresh={() => {}} />
      </div>
    </div>
  )
}

/**
 * One line of the modal's terminal as the frames draw it: 12px mono, 16px lines 4px apart. The
 * harness draws the product's own screens as text, because a PTY is the one thing a capture has not.
 */
type Line = { text: string; ink?: string; bold?: boolean }

const PICKING: Line[] = [
  { text: 'Select login method:', ink: 'text-foreground', bold: true },
  { text: ' ' },
  { text: '❯ 1. Claude account with subscription', ink: 'text-[#a5b4fc]' },
  { text: '     Pro, Max, Team or Enterprise', ink: 'text-muted-foreground' },
  { text: '  2. Anthropic Console account' },
  { text: '     API usage billing', ink: 'text-muted-foreground' },
  { text: ' ' },
  { text: '▍', ink: 'text-[#a5b4fc]' },
]

const SIGNED_IN: Line[] = [
  { text: 'Login successful.', ink: 'text-[#86efac]', bold: true },
  { text: 'Logged in as boss@example.com' },
  { text: ' ' },
  { text: 'TinyCorp saw the sign-in. This closes by itself.', ink: 'text-muted-foreground' },
]

async function signInCapture(done: boolean): Promise<ReactNode> {
  window.tinyCorp = {} as TinyCorpApi
  const { SignInModalBody } = await import('../../sign-in')
  const { cx } = await import('../../ui')
  const { PROVIDER_CATALOGUE } = await import('../../../../shared/domain/providers')
  const lines = done ? SIGNED_IN : PICKING
  return (
    <div className="flex">
      <SignInModalBody
        entry={PROVIDER_CATALOGUE[0]}
        sub="Personal · runs in WSL · archlinux"
        state={done ? { phase: 'signed-in', who: 'boss@example.com · Max 20×' } : { phase: 'waiting', step: 1 }}
        lastStep={1}
        terminal={
          <div className="flex flex-col gap-4 whitespace-pre font-code text-12/16">
            {lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed screen, drawn once.
              <span key={index} className={cx(line.ink, line.bold && 'font-bold')}>
                {line.text}
              </span>
            ))}
          </div>
        }
        onCancel={() => {}}
        onDone={() => {}}
      />
    </div>
  )
}
