import { ArrowRight, Check, Monitor, RefreshCw, Search, SquareTerminal, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { APP_NAME } from '../../../shared/app/app-name'
import type { Boss } from '../../../shared/boss-profile'
import {
  GIT_BASH_BLOCKS,
  GIT_BASH_COMMAND,
  GIT_BASH_NOTICE_TITLE,
  GIT_BASH_RECHECK,
  gitBashLookedIn,
  gitBashNotice,
} from '../../../shared/platform/git-bash'
import {
  RIGHT_CLICK_LABEL,
  RIGHT_CLICK_SUB,
  RIGHT_CLICK_TITLE,
  rightClickHint,
  TERMINAL_RIGHT_CLICKS,
  type TerminalRightClick,
} from '../../../shared/platform/terminal-right-click'
import {
  DISTRO_SUB,
  DISTRO_TITLE,
  SETUP_CONTINUE,
  SETUP_SUB,
  SETUP_TITLE,
  TEAM_RUNTIME_SUB,
  TEAM_RUNTIME_TITLE,
  WINDOWS_OPTION_TITLE,
  type WindowsMachine,
  WSL_OPTION_DESC,
  WSL_OPTION_TITLE,
} from '../../../shared/platform/windows-machine'
import { LogoMark } from '../brand'
import { hostPlatform } from '../chrome'
import { LAUNCHER_MARK, LauncherFrame } from '../launcher'
import { Button, cx, SegmentedControl, Select } from '../ui'
import {
  blockedNote,
  canContinue,
  canPickWsl,
  distroOptions,
  draftRuntimeKey,
  needsGitBash,
  showsGitBashNotice,
  type TeamRuntimeKind,
  type WindowsSetupDraft,
  windowsOptionText,
  windowsSetupDraft,
} from './windows-setup-model'
import '../ui/tailwind.css'

/**
 * The first launch on Windows (T249, frames `laIUL` and `QFh5u`): where the team runs, and what
 * the right mouse button does. It is the Launcher's own 680px window, shown once, before anything
 * else this app would draw.
 *
 * **It is the one screen that holds.** Everything else in TinyCorp can be dismissed, because
 * everything else is about something the boss can come back to — but a team running on Windows
 * without Git for Windows has no `bash` and no `git`, which is not a thing to find out later, from
 * a Session that answered and then failed. So there is no *Skip for now* and `Escape` does nothing:
 * both answers come preselected, and `Continue` is one press for the machine that is already fine.
 *
 * Nothing here is a Company's business; the answers go in the boss's own profile, and Your profile
 * → On this PC is where they are changed afterwards.
 */
export interface WindowsSetupStepProps {
  machine: WindowsMachine
  boss: Boss | null
  /** Walks the machine again for Git for Windows — the boss has just installed it. */
  onRecheck(): void | Promise<void>
  /** `Continue`: saves both answers and marks the step done, so it is never shown again. */
  onDone(answers: { defaultRuntime: string | null; rightClick: TerminalRightClick }): void
}

export function WindowsSetupStep({ machine, boss, onRecheck, onDone }: WindowsSetupStepProps) {
  const platform = hostPlatform()
  const [draft, setDraft] = useState<WindowsSetupDraft>(() => windowsSetupDraft(machine, boss, platform))
  const [checking, setChecking] = useState(false)
  const allowed = canContinue(draft, machine)

  const recheck = async () => {
    setChecking(true)
    try {
      await onRecheck()
    } finally {
      setChecking(false)
    }
  }

  return (
    <LauncherFrame name="Desktop App / First Launch / Set up Windows" title={APP_NAME}>
      <div className={BODY}>
        <div className={HEAD}>
          <LogoMark size={52} className={LAUNCHER_MARK} />
          <h1 className={WORDMARK}>{SETUP_TITLE}</h1>
          <p className={TAGLINE}>{SETUP_SUB}</p>
        </div>

        <section className={CARD} aria-label={TEAM_RUNTIME_TITLE}>
          <div className={SECTION}>
            <h2 className={SECTION_TITLE}>{TEAM_RUNTIME_TITLE}</h2>
            <p className={SECTION_SUB}>{TEAM_RUNTIME_SUB}</p>
          </div>

          <div className="flex w-full gap-10" role="radiogroup" aria-label={TEAM_RUNTIME_TITLE}>
            <RuntimeOption
              kind="windows"
              title={WINDOWS_OPTION_TITLE}
              desc={windowsOptionText()}
              picked={draft.kind === 'windows'}
              onPick={() => setDraft((d) => ({ ...d, kind: 'windows' }))}
            />
            <RuntimeOption
              kind="wsl"
              title={WSL_OPTION_TITLE}
              desc={WSL_OPTION_DESC}
              picked={draft.kind === 'wsl'}
              disabled={!canPickWsl(machine)}
              onPick={() => setDraft((d) => ({ ...d, kind: 'wsl' }))}
            />
          </div>

          {/* The distro row and the Git Bash notice take the same place: whichever the pick needs. */}
          {draft.kind === 'wsl' && canPickWsl(machine) && (
            <div className={ROW}>
              <div className="flex min-w-0 flex-1 basis-0 flex-col gap-2">
                <span className={ROW_TITLE}>{DISTRO_TITLE}</span>
                <span className={ROW_SUB}>{DISTRO_SUB}</span>
              </div>
              <Select
                className="w-200 shrink-0 grow-0 basis-200"
                label={null}
                aria-label={DISTRO_TITLE}
                value={draft.distro}
                options={distroOptions(machine)}
                onChange={(event) => setDraft((d) => ({ ...d, distro: event.target.value }))}
              />
            </div>
          )}

          {showsGitBashNotice(draft, machine) && (
            <div className={NOTICE}>
              <div className="flex w-full items-center gap-10">
                <span className={WARN_CHIP} aria-hidden>
                  <TriangleAlert size={14} />
                </span>
                <h3 className={NOTICE_TITLE}>{GIT_BASH_NOTICE_TITLE}</h3>
              </div>
              <p className={NOTICE_BODY}>{gitBashNotice(needsGitBash())}</p>
              <p className={COMMAND}>
                <span className="text-muted-foreground">&gt;</span>
                <span className="min-w-0 flex-1 basis-0 text-foreground">{GIT_BASH_COMMAND}</span>
              </p>
              <div className="flex w-full items-center gap-6">
                <Search size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className={LOOKED_IN}>{gitBashLookedIn(machine.gitBash.lookedIn)}</span>
                <span className="min-w-0 flex-1 basis-0" />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  disabled={checking}
                  onClick={() => void recheck()}
                >
                  {GIT_BASH_RECHECK}
                </Button>
              </div>
            </div>
          )}

          <div className={DIVIDER} />

          <div className={SECTION}>
            <h2 className={SECTION_TITLE}>{RIGHT_CLICK_TITLE}</h2>
            <p className={SECTION_SUB}>{RIGHT_CLICK_SUB}</p>
          </div>
          <SegmentedControl
            label={RIGHT_CLICK_TITLE}
            name="right-click"
            value={draft.rightClick}
            options={TERMINAL_RIGHT_CLICKS.map((value) => ({ value, label: RIGHT_CLICK_LABEL[value] }))}
            classes={{ track: SEGMENT_TRACK, option: SEGMENT_OPTION, on: SEGMENT_ON, off: SEGMENT_OFF }}
            onChange={(value) => setDraft((d) => ({ ...d, rightClick: value }))}
          />
          <p className={HINT}>{rightClickHint(draft.rightClick, platform)}</p>
        </section>

        <div className={FOOTER}>
          <p className={FOOTER_NOTE}>{blockedNote(draft, machine, GIT_BASH_BLOCKS)}</p>
          <Button
            icon={ArrowRight}
            disabled={!allowed}
            onClick={() => onDone({ defaultRuntime: draftRuntimeKey(draft), rightClick: draft.rightClick })}
          >
            {SETUP_CONTINUE}
          </Button>
        </div>
      </div>
    </LauncherFrame>
  )
}

/** One of the two option cards (`laIUL`): the mark, the tick, the name and what it means. */
function RuntimeOption({
  kind,
  title,
  desc,
  picked,
  disabled,
  onPick,
}: {
  kind: TeamRuntimeKind
  title: string
  desc: string
  picked: boolean
  disabled?: boolean
  onPick(): void
}) {
  const Icon = kind === 'windows' ? Monitor : SquareTerminal
  return (
    <label className={cx(OPTION, picked ? OPTION_ON : OPTION_OFF, disabled && 'cursor-default opacity-40')}>
      <input
        type="radio"
        name="team-runtime"
        className="absolute h-1 w-1 opacity-0"
        checked={picked}
        disabled={disabled}
        onChange={onPick}
      />
      <span className="flex w-full items-center justify-between">
        <span
          className={cx(OPTION_CHIP, picked ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground')}
        >
          <Icon size={16} aria-hidden />
        </span>
        <span className={cx(TICK, picked ? 'border-primary bg-primary' : 'border-border bg-transparent')}>
          {picked && <Check size={12} className="text-primary-foreground" aria-hidden />}
        </span>
      </span>
      <span className={OPTION_TITLE}>{title}</span>
      <span className={OPTION_DESC}>{desc}</span>
    </label>
  )
}

/* The frame's own measurements (`laIUL`, `QFh5u`), as utilities. */

/* The 740px window is taller than the card needs; a machine with the notice open fills it, so the
   column scrolls rather than pushing `Continue` past the bottom edge. */
const BODY = 'flex min-h-0 w-full flex-1 flex-col items-center gap-20 overflow-y-auto px-44 pt-34 pb-32'

const HEAD = 'flex w-full flex-col items-center gap-8 pb-4'

const WORDMARK = 'm-0 font-bold text-24/normal text-[#E2E8F0] tracking-[-0.6px]'

const TAGLINE = 'm-0 w-460 text-center text-13 text-muted-foreground'

const CARD = 'flex w-592 flex-col gap-14 rounded-md border border-border bg-card p-20'

const SECTION = 'flex w-full flex-col gap-4'

const SECTION_TITLE = 'm-0 font-bold text-14-5/normal text-foreground'

const SECTION_SUB = 'm-0 text-12-5 text-muted-foreground'

/** An option card: the stroke is drawn inside, so picking one costs no pixel of layout. */
const OPTION =
  'relative flex min-w-0 flex-1 basis-0 cursor-pointer flex-col gap-8 rounded-md p-14 inset-ring-1 inset-ring-border'

const OPTION_ON = 'bg-primary-subtle inset-ring-[1.5px] inset-ring-primary'

const OPTION_OFF = 'bg-muted'

const OPTION_CHIP = 'flex h-30 w-30 shrink-0 items-center justify-center rounded-sm'

const TICK =
  'flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-[1.5px] [:focus-visible+&]:shadow-focus'

const OPTION_TITLE = 'font-bold text-14 text-foreground'

const OPTION_DESC = 'text-12 text-muted-foreground'

const ROW = 'flex w-full items-center gap-12 rounded-md border border-border bg-muted px-14 py-12'

const ROW_TITLE = 'font-bold text-13-5/normal text-foreground'

const ROW_SUB = 'text-12 text-muted-foreground'

const NOTICE = 'flex w-full flex-col gap-10 rounded-md border border-border bg-muted p-14'

const WARN_CHIP =
  'flex h-26 w-26 shrink-0 items-center justify-center rounded-sm bg-status-warning text-status-warning-foreground'

const NOTICE_TITLE = 'm-0 font-bold text-13-5/normal text-foreground'

const NOTICE_BODY = 'm-0 text-12-5 text-muted-foreground'

const COMMAND =
  'm-0 flex w-full items-center gap-8 rounded-sm border border-border bg-background px-12 py-10 font-code text-12'

const LOOKED_IN = 'truncate font-code text-11 text-muted-foreground'

const DIVIDER = 'h-1 w-full bg-border'

/* The frame's segmented control is taller and its labels larger than the kit's own (`laIUL`). */

const SEGMENT_TRACK = 'flex h-36 w-360 items-center gap-3 rounded-sm border border-border bg-muted p-3'

const SEGMENT_OPTION =
  'inline-flex h-28 flex-[1_1_0] cursor-pointer items-center justify-center gap-6 rounded-sm border-0 text-12-5/[inherit]'

const SEGMENT_ON = 'bg-primary font-bold text-primary-foreground'

const SEGMENT_OFF = 'bg-transparent font-medium text-muted-foreground hover:text-foreground'

const HINT = 'm-0 text-12 text-muted-foreground'

const FOOTER = 'flex w-592 items-center justify-between gap-16'

const FOOTER_NOTE = 'm-0 w-340 text-11-5/[1.3] text-muted-foreground'
