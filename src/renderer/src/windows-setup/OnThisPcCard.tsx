import { Copy } from 'lucide-react'
import type { Boss } from '../../../shared/boss-profile'
import {
  GIT_BASH_COMMAND,
  GIT_BASH_FOUND,
  GIT_BASH_MISSING,
  GIT_BASH_TITLE,
  gitBashHint,
} from '../../../shared/platform/git-bash'
import {
  RIGHT_CLICK_SHORT,
  RIGHT_CLICK_TITLE,
  rightClickHint,
  TERMINAL_RIGHT_CLICKS,
  type TerminalRightClick,
} from '../../../shared/platform/terminal-right-click'
import {
  DISTRO_TITLE,
  ON_THIS_MACHINE_SUB,
  ON_THIS_MACHINE_TITLE,
  ON_THIS_PC_SUB,
  ON_THIS_PC_TITLE,
  TEAM_RUNTIME_TITLE,
  WINDOWS_OPTION_TITLE,
  type WindowsMachine,
  WSL_OPTION_TITLE,
} from '../../../shared/platform/windows-machine'
import { hostPlatform } from '../chrome'
import { Badge, Button, SegmentedControl, Select } from '../ui'
import {
  canPickWsl,
  distroOptions,
  draftRuntimeKey,
  needsGitBash,
  type TeamRuntimeKind,
  windowsSetupDraft,
} from './windows-setup-model'
import '../ui/tailwind.css'

/**
 * Your profile → **On this PC** (T249, frame `t1VDYQ`): the same two answers the first launch
 * asked for, where they are changed afterwards, and what this machine has to say about them.
 *
 * On a Mac or a Linux desktop it draws the right-click row and nothing else, under its own title:
 * there is one place a CLI can be there and no Git for Windows to look for, so two thirds of this
 * card would be rows about questions that machine does not have — but the right button is a real
 * question on every desktop, and a boss who wants the menu on Windows or paste on a Mac says so
 * here. The frame is the Windows one; this is the same card with what does not apply left out.
 *
 * Every control here saves on the spot rather than into Your profile's draft, the way the Providers
 * card's runtime chip does: none of it is text being edited, all of it is where the next Session
 * starts and what the next click does.
 */
export interface OnThisPcCardProps {
  machine: WindowsMachine
  boss: Boss | null
  onSave(update: { defaultRuntime?: string | null; rightClick?: TerminalRightClick }): void
}

export function OnThisPcCard({ machine, boss, onSave }: OnThisPcCardProps) {
  const platform = hostPlatform()
  const draft = windowsSetupDraft(machine, boss, platform)
  const found = machine.gitBash.path !== null

  const pick = (kind: TeamRuntimeKind) => onSave({ defaultRuntime: draftRuntimeKey({ ...draft, kind }) })

  const title = machine.windows ? ON_THIS_PC_TITLE : ON_THIS_MACHINE_TITLE
  return (
    <section className={CARD} aria-label={title} data-ui="On this PC">
      <div className="flex w-full flex-col gap-4">
        <h3 className={TITLE}>{title}</h3>
        <p className={SUB}>{machine.windows ? ON_THIS_PC_SUB : ON_THIS_MACHINE_SUB}</p>
      </div>

      {machine.windows && (
        <div className={FIELD}>
          <span className={LABEL}>{TEAM_RUNTIME_TITLE}</span>
          <SegmentedControl
            label={TEAM_RUNTIME_TITLE}
            name="team-runtime"
            value={draft.kind}
            options={[
              { value: 'windows' as const, label: WINDOWS_OPTION_TITLE },
              { value: 'wsl' as const, label: WSL_OPTION_TITLE },
            ].filter((option) => option.value === 'windows' || canPickWsl(machine))}
            classes={SEGMENT}
            onChange={pick}
          />
        </div>
      )}

      {machine.windows && draft.kind === 'wsl' && canPickWsl(machine) && (
        <div className={FIELD}>
          <span className={LABEL}>{DISTRO_TITLE}</span>
          <Select
            label={null}
            aria-label={DISTRO_TITLE}
            value={draft.distro}
            options={distroOptions(machine)}
            onChange={(event) => onSave({ defaultRuntime: `wsl:${event.target.value}` })}
          />
        </div>
      )}

      {machine.windows && (
        <div className={FIELD}>
          <div className="flex w-full items-center gap-10">
            <span className={LABEL}>{GIT_BASH_TITLE}</span>
            <span className="min-w-0 flex-1 basis-0" />
            <Badge size="sm" variant={found ? 'success' : 'warning'}>
              {found ? GIT_BASH_FOUND : GIT_BASH_MISSING}
            </Badge>
          </div>
          {found ? (
            <span className={PATH}>{machine.gitBash.path}</span>
          ) : (
            <>
              <p className={COMMAND}>
                <span className="text-muted-foreground">&gt;</span>
                <span className="min-w-0 flex-1 basis-0 truncate text-foreground">{GIT_BASH_COMMAND}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Copy}
                  className="p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                  aria-label={`Copy ${GIT_BASH_COMMAND}`}
                  onClick={() => void navigator.clipboard?.writeText(GIT_BASH_COMMAND)}
                />
              </p>
              <p className={HINT}>{gitBashHint(needsGitBash())}</p>
            </>
          )}
        </div>
      )}

      <div className={FIELD}>
        <span className={LABEL}>{RIGHT_CLICK_TITLE}</span>
        <SegmentedControl
          label={RIGHT_CLICK_TITLE}
          name="right-click"
          value={draft.rightClick}
          options={TERMINAL_RIGHT_CLICKS.map((value) => ({ value, label: RIGHT_CLICK_SHORT[value] }))}
          classes={SEGMENT}
          onChange={(rightClick) => onSave({ rightClick })}
        />
        <p className={HINT}>{rightClickHint(draft.rightClick, platform)}</p>
      </div>
    </section>
  )
}

/* The frame's own measurements (`t1VDYQ`), as utilities. */

const CARD = 'flex w-full flex-col gap-14 rounded-md border border-border bg-card p-14'

const TITLE = 'm-0 font-bold text-14/normal text-foreground'

const SUB = 'm-0 text-11-5/[1.45] text-muted-foreground'

const FIELD = 'flex w-full flex-col gap-6'

/** `#CBD5E1` is the design's Slate 300, which every label on this card reads; no token names it. */
const LABEL = 'text-12-5/normal text-[#cbd5e1]'

const PATH = 'font-code text-11 text-muted-foreground'

const COMMAND =
  'm-0 flex w-full items-center gap-8 rounded-sm border border-border bg-background px-10 py-8 font-code text-12'

const HINT = 'm-0 text-11-5/[1.45] text-muted-foreground'

/** The frame's track is the kit's own height with a filled ground and 12.5px labels. */
const SEGMENT = {
  track: 'flex h-32 w-full items-center gap-3 rounded-sm border border-border bg-muted p-3',
  option:
    'inline-flex h-24 flex-[1_1_0] cursor-pointer items-center justify-center gap-6 rounded-sm border-0 text-12-5/[inherit]',
  on: 'bg-primary font-bold text-primary-foreground',
  off: 'bg-transparent font-medium text-muted-foreground hover:text-foreground',
}
