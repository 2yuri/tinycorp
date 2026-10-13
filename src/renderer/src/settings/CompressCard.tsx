import { Check, CircleCheck, CircleDashed, Copy, type LucideIcon, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RtkView } from '../../../shared/ipc'
import {
  type RtkCommand,
  type RtkSavings,
  type RtkStatus,
  rtkCompressWords,
  rtkFixCommands,
  rtkHookBadge,
  rtkStatusWords,
  rtkTokenCount,
  rtkUsable,
} from '../../../shared/rtk'
import { Alert, cx, IconButton, SettingsCard, Toggle } from '../ui'
import '../ui/tailwind.css'
import { CARD_SUB, DIVIDER, ERRORS, LABEL, LINE, LINE_TEXT, LINE_TITLE } from './settings-classes'

/*
 * Compress what Employees read (T179), and the states of frame `p4np9V`. The column and its
 * padding are the settings container's, like every other tab's (T181); these are the card's parts.
 */

/** The RTK status row: a tone-carrying strip inside the card, as the frames draw it. */
const STATUS = 'flex items-center gap-12 rounded-sm bg-secondary px-12 py-10'
const STATUS_TEXT = 'flex min-w-0 flex-[1_1_0] flex-col gap-2'
const STATUS_TITLE = 'text-13/16 font-semibold text-foreground'
const STATUS_BODY = 'text-11-5/17 text-muted-foreground'

/** The found row's second line is the binary's own path, so it is set in the mono face. */
const STATUS_PATH = 'font-code text-11/15 text-muted-foreground'

/*
 * The frame's own ghost button beside the status, at the padding its instance sets, and drawn as a
 * quiet action rather than the row's loudest text. `p-0` first, because this is a `<button>`.
 */
const STATUS_CHECK =
  'flex shrink-0 cursor-pointer items-center gap-8 rounded-sm border-0 bg-transparent p-0 px-10 py-6 font-sans text-12/[inherit] font-semibold text-muted-foreground hover:not-disabled:text-primary disabled:cursor-default disabled:text-border'

const SPIN = 'animate-check-spin motion-reduce:animate-none'

/** The install lines are card rows like any other in the frame, 14px apart. */
const FIX = 'flex flex-col gap-14'
const COMMAND = 'flex items-center gap-10'
const COMMAND_LABEL = 'flex-[0_0_64px] text-11-5/[inherit] font-semibold text-muted-foreground'

/** The frame's command box: a filled line with Copy inside it, and no stroke of its own. */
const COMMAND_LINE = 'flex min-w-0 flex-[1_1_0] items-center gap-8 rounded-sm bg-secondary px-10 py-7'

/** 29px of line: 7px of padding, the frame's 15px box, 7px. */
const COMMAND_CODE =
  'min-w-0 flex-[1_1_0] overflow-hidden text-ellipsis whitespace-nowrap font-code text-11-5/15 text-foreground'
const COMMAND_COPY = 'size-13 shrink-0 border-0 bg-transparent p-0 text-muted-foreground'

const HOOKS = 'flex flex-col gap-14'

/** One Provider's row: its name, how it hooks in, and the badge. */
const HOOK = 'flex items-center gap-10'
const HOOK_NAME = 'flex-[0_0_110px] text-13/[inherit] font-semibold text-foreground'
const HOOK_HOW =
  'min-w-0 flex-[1_1_0] overflow-hidden text-ellipsis whitespace-nowrap text-11-5/[inherit] text-muted-foreground'

/*
 * The kit's own neutral badge, which is what the frame instances here. Every badge carries the
 * dot; only its colour says which state the row is in, so the two are exclusive lists.
 */
const HOOK_BADGE =
  'flex h-25 shrink-0 items-center gap-6 rounded-full bg-secondary px-11 text-12/[inherit] font-semibold text-secondary-foreground before:size-6 before:rounded-full before:bg-muted-foreground before:content-[""]'
const HOOK_BADGE_ON =
  'flex h-25 shrink-0 items-center gap-6 rounded-full bg-status-success px-11 text-12/[inherit] font-semibold text-status-success-foreground before:size-6 before:rounded-full before:bg-brand-success before:content-[""]'

/** Saved this week: three tiles, the frame's own. Never beside the usage bars — it is an estimate. */
const STATS = 'grid grid-cols-3 gap-12'

/** The frame fills the tile in the card's own lighter tone, not in the page behind it. */
const STAT = 'flex flex-col gap-4 rounded-sm bg-secondary p-12'
const STAT_VALUE = 'text-20/24 font-bold tracking-[-0.01em] text-foreground'
const STAT_LABEL = 'text-11-5/14 text-muted-foreground'

/** A control that cannot be used until RTK is here reads as one: the frame halves the whole row. */
const LINE_OFF = 'flex items-center gap-16 opacity-50'

/** The frames colour the status glyph by state; the stylesheet did it with three modifiers. */
const STATUS_ICON: Partial<Record<string, string>> = {
  found: 'text-brand-success',
  'too-old': 'text-brand-warning',
  'missing-in-wsl': 'text-brand-warning',
}

const api = window.tinyCorp

/**
 * Tokens · **Compress what Employees read**, and **Saved this week** (frames `L0glbm`, `p4np9V`).
 *
 * Most of what an Employee reads is command output — `git status`, a diff, a test run, a log — and
 * RTK (see `shared/rtk.ts`) filters it before the Employee reads it. This is the whole of
 * the boss's side of that: where RTK is, whether this Company uses it, how each Provider is hooked,
 * whether RTK's own ping may go out, and what it says it saved (T179).
 *
 * Two things it never does. It never installs RTK: the boss runs one line in their own terminal and
 * presses `Check again`. And it never draws its numbers beside the usage bars — RTK counts bytes ÷ 4
 * and command output is one part of what a Session spends, so every number here says it is an
 * estimate.
 *
 * It saves control by control, like Integrations and Usage & routing: a toggle the boss set and a
 * Save they forgot would be a week of Employees reading everything.
 */
export function CompressCard({
  companyName,
  platform = api.shell.platform,
}: {
  /** Whose Employees this compresses for: the frame writes `Every Employee in Tiny Corp.` */
  companyName: string
  platform?: string
}) {
  const [view, setView] = useState<RtkView | null>(null)
  const [savings, setSavings] = useState<RtkSavings | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const read = async () => {
      const result = await api.rtk.read()
      if (!live) return
      if (result.ok) setView(result.value)
      else setError(result.error)
      const saved = await api.rtk.savings()
      if (live && saved.ok) setSavings(saved.value)
    }
    void read()
    const stop = api.rtk.onChanged(() => void read())
    return () => {
      live = false
      stop()
    }
  }, [])

  if (!view) return <div aria-busy="true" />

  const run = async (action: Promise<{ ok: boolean; error?: string }>) => {
    const result = await action
    if (!result.ok) setError(result.error ?? 'That did not work')
  }

  const usable = rtkUsable(view.status)
  const on = usable && view.settings.enabled
  const commands = rtkFixCommands(view.status, platform)

  return (
    <>
      {error && (
        <div className={ERRORS}>
          <Alert variant="error" title={error} onClose={() => setError(null)} />
        </div>
      )}
      <SettingsCard
        title="Compress what Employees read"
        sub="Command output passes through RTK before an Employee reads it: git, tests, ls, grep and logs arrive filtered. Code, paths and error lines stay exact."
        sub12
      >
        <StatusRow
          status={view.status}
          checking={checking}
          onCheck={async () => {
            setChecking(true)
            const result = await api.rtk.recheck()
            setChecking(false)
            if (result.ok) setView(result.value)
            else setError(result.error)
          }}
        />

        {commands.length > 0 && (
          <div className={FIX}>
            {commands.map((command) => (
              <CommandRow key={`${command.label}:${command.command}`} command={command} />
            ))}
          </div>
        )}

        <div className={usable ? LINE : LINE_OFF}>
          <div className={LINE_TEXT}>
            <div className={LINE_TITLE}>Compress command output</div>
            <div className={CARD_SUB}>{rtkCompressWords(view.status, companyName)}</div>
          </div>
          <Toggle
            label={null}
            aria-label="Compress command output"
            checked={on}
            disabled={!usable}
            onChange={(event) => void run(api.rtk.setEnabled(event.target.checked))}
          />
        </div>

        <div className={DIVIDER} />
        <p className={LABEL}>How it hooks in</p>
        <div className={HOOKS}>
          {view.hooks.map((row) => (
            <div className={HOOK} key={row.provider}>
              <span className={HOOK_NAME}>{row.name}</span>
              <span className={HOOK_HOW}>{row.how ?? 'This product rewrites no commands'}</span>
              {/* Nothing is hooked while RTK is not on this computer, whatever the toggle says
                  — the frames draw `Not hooked` on all three rows (`Pzs8W`). */}
              <span className={row.how && on && usable ? HOOK_BADGE_ON : HOOK_BADGE}>
                {usable ? rtkHookBadge(row, on) : 'Not hooked'}
              </span>
            </div>
          ))}
        </div>

        <div className={DIVIDER} />
        <div className={LINE}>
          <div className={LINE_TEXT}>
            <div className={LINE_TITLE}>Send RTK’s anonymous daily ping</div>
            <div className={CARD_SUB}>RTK’s own usage ping. Off for Employees unless you turn it on.</div>
          </div>
          <Toggle
            label={null}
            aria-label="Send RTK’s anonymous daily ping"
            checked={view.settings.ping}
            onChange={(event) => void run(api.rtk.setPing(event.target.checked))}
          />
        </div>
      </SettingsCard>

      <SavedThisWeek savings={savings} />
    </>
  )
}

/** The RTK status row: what is here, where, and the one button that asks the machine again. */
function StatusRow({
  status,
  checking,
  onCheck,
}: {
  status: RtkStatus
  checking: boolean
  onCheck(): void | Promise<void>
}) {
  const words = rtkStatusWords(status)
  const Icon: LucideIcon =
    status.state === 'found' ? CircleCheck : status.state === 'missing' ? CircleDashed : TriangleAlert
  return (
    <div className={STATUS} role="status">
      <Icon size={16} className={cx('shrink-0', STATUS_ICON[status.state] ?? 'text-muted-foreground')} aria-hidden />
      <div className={STATUS_TEXT}>
        <div className={STATUS_TITLE}>{words.title}</div>
        {words.body && <div className={status.state === 'found' ? STATUS_PATH : STATUS_BODY}>{words.body}</div>}
      </div>
      <button type="button" className={STATUS_CHECK} onClick={() => void onCheck()} disabled={checking}>
        <RefreshCw size={14} className={cx(checking && SPIN)} aria-hidden /> Check again
      </button>
    </div>
  )
}

/** One install line, with the button that copies it. TinyCorp runs none of them. */
function CommandRow({ command }: { command: RtkCommand }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={COMMAND}>
      <span className={COMMAND_LABEL}>{command.label}</span>
      {/* The frame keeps Copy inside the line's own box, at its right edge. */}
      <span className={COMMAND_LINE}>
        {/* The row prints what fits; Copy puts the whole line on the clipboard. */}
        <code className={COMMAND_CODE}>{command.shown ?? command.command}</code>
        <IconButton
          size="sm"
          iconSize={13}
          icon={copied ? Check : Copy}
          label={copied ? `${command.command} copied` : `Copy ${command.command}`}
          className={COMMAND_COPY}
          onClick={() => {
            void copyText(command.command).then((done) => {
              if (!done) return
              setCopied(true)
              setTimeout(() => setCopied(false), COPIED_MS)
            })
          }}
        />
      </span>
    </div>
  )
}

const COPIED_MS = 1500

/** The clipboard, which a window without one simply does not have; the line is still readable. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Saved this week — RTK's own history, for this Company alone.
 *
 * Labelled an estimate on its face: RTK ships no tokenizer and counts bytes ÷ 4, and command output
 * is one part of what a Session spends. A Company RTK has filtered nothing for is told so, rather
 * than shown three zeroes it would have to interpret.
 */
function SavedThisWeek({ savings }: { savings: RtkSavings | null }) {
  return (
    <SettingsCard
      title="Saved this week"
      sub12
      /* Nothing read yet is the whole of what the card has to say, so it says it once: the
         estimate is about numbers, and there are none (frames `Pzs8W`, `VHnp1`, `q3YiCf`). */
      sub={
        savings
          ? 'Read from RTK’s own history. An estimate: RTK counts bytes ÷ 4, and output is only part of what a session spends.'
          : 'Nothing to read yet. Savings appear here once RTK has filtered a command.'
      }
    >
      {savings && (
        <div className={STATS}>
          <Stat value={`${savings.cutPercent}%`} label="Command output cut" />
          <Stat value={`≈ ${rtkTokenCount(savings.tokensNotRead)}`} label="Tokens not read" />
          <Stat value={savings.commandsFiltered.toLocaleString('en-US')} label="Commands filtered" />
        </div>
      )}
    </SettingsCard>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={STAT}>
      <div className={STAT_VALUE}>{value}</div>
      <div className={STAT_LABEL}>{label}</div>
    </div>
  )
}
