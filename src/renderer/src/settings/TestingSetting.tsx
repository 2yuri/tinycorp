import {
  ChevronDown,
  CircleSlash,
  FlaskConical,
  FolderGit2,
  type LucideIcon,
  Plus,
  TerminalSquare,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import {
  type RepoTestSettings,
  TEST_MODE_HELP,
  TEST_MODE_LABEL,
  TEST_MODES,
  type TestMode,
  type TestSettings,
} from '../../../shared/testing'
import { resources, useIpcResource } from '../ipc'
import { SegmentedControl, SettingsCard } from '../ui'
import '../ui/tailwind.css'
import { DIVIDER, LABEL } from './settings-classes'

/*
 * Testing before merge (frame `YatUW`, card c): the WHO TESTS track, then one boxed line per repo
 * that differs from the Company's own, with its run command and its port.
 */

/** Who tests: its label, its track and its help, on a field's 6 rather than the card's 14. */
export const FIELD = 'flex flex-col gap-6'

/** Per repo: its label and one box per repo, 8 apart, as `QgXdU` stacks them. */
export const REPOS = 'flex flex-col gap-8'

/** 32px of track: the stroke, 2px of padding, the frame's 26px option, 2px, the stroke. */
const MODES = 'flex gap-3 rounded-sm border border-border bg-muted p-2'

/*
 * One mode. `p-0` first because this is a `<button>` and `ui/tailwind.css` leaves the UA's padding
 * alone; `font: inherit` is already the base's, so only the size is here. The colours are two
 * exclusive lists — both set a background and an ink, and the sheet's order, not the attribute's,
 * would otherwise decide.
 */
export const MODE =
  'flex h-26 flex-[1_1_0] cursor-pointer items-center justify-center gap-6 rounded-sm border-0 p-0 px-10 text-12/[inherit] font-semibold has-[>[data-slot=choice-input]:focus-visible]:shadow-focus has-[>[data-slot=choice-input]:focus-visible]:outline-none'
const MODE_OFF = 'bg-transparent text-muted-foreground'
const MODE_ON = 'bg-primary text-primary-foreground'

const HELP = 'm-0 text-11-5/17 text-muted-foreground'

/** The line inside a repo box is one 14px box, not the 17 the card's own help is set on. */
const HELP_IN_REPO = 'm-0 text-11-5/14 text-muted-foreground'

/** The frame's 10/12 is measured from the box's outer edge, so the stroke comes out of it. */
const REPO = 'flex flex-col gap-8 rounded-sm border border-input bg-muted px-11 py-9'
const REPO_HEAD =
  'flex items-center gap-8 [&_select]:min-w-0 [&_select]:flex-[1_1_0] [&_select]:cursor-pointer [&_select]:border-0 [&_select]:bg-transparent [&_select]:text-12/[inherit] [&_select]:font-normal [&_select]:text-muted-foreground'

/** The repo, as the frame's own outlined pill. */
const REPO_NAME =
  'inline-flex items-center gap-5 rounded-full border border-border bg-card px-7 py-2 font-code text-11/15 text-canvas-foreground'

const REPO_PICK =
  'relative ml-auto inline-flex items-center gap-8 text-muted-foreground [&_select]:absolute [&_select]:inset-0 [&_select]:w-full [&_select]:cursor-pointer [&_select]:opacity-0'

/**
 * The mode, as the kit's neutral badge: its dot is the frame's indigo, the agent's pink and
 * nobody's grey, one per `data-mode`.
 */
const REPO_MODE =
  'inline-flex items-center gap-6 rounded-full bg-secondary px-9 py-3 text-11/13 font-semibold text-canvas-foreground before:size-6 before:rounded-full before:bg-brand-primary before:content-[""] data-[mode=agent]:before:bg-brand-pink data-[mode=nobody]:before:bg-muted-foreground'

const REPO_RUN = 'flex gap-8'

/** The run command and the port: the same box, one filling the row and one at the frame's width. */
const RUN =
  'flex h-32 min-w-0 flex-[1_1_0] items-center gap-8 rounded-sm border border-input bg-card px-9 text-11/[inherit] font-semibold text-muted-foreground [&_input]:min-w-0 [&_input]:flex-[1_1_0] [&_input]:border-0 [&_input]:bg-transparent [&_input]:font-code [&_input]:text-12/[inherit] [&_input]:font-normal [&_input]:text-foreground'
const PORT =
  'flex h-32 w-128 items-center gap-8 rounded-sm border border-input bg-card px-9 text-11/[inherit] font-semibold text-muted-foreground [&_input]:min-w-0 [&_input]:flex-[1_1_0] [&_input]:border-0 [&_input]:bg-transparent [&_input]:font-code [&_input]:text-12/[inherit] [&_input]:font-normal [&_input]:text-foreground'

/** The frame insets this row 8px from the card's content edge and sets its label at 600. */
const ADD =
  'flex items-center gap-8 px-8 py-4 text-12/15 font-semibold text-muted-foreground [&_select]:min-w-0 [&_select]:flex-[1_1_0] [&_select]:cursor-pointer [&_select]:border-0 [&_select]:bg-transparent [&_select]:text-12/[inherit] [&_select]:font-normal [&_select]:text-muted-foreground'

const ERROR_LINE = 'm-0 text-11-5/[inherit] text-brand-danger'

const api = window.tinyCorp

/** The glyph the frame puts on each WHO TESTS chip: you, the flask, both of you, nobody. */
const MODE_ICON: Record<TestMode, LucideIcon> = {
  you: UserRound,
  agent: FlaskConical,
  both: UsersRound,
  nobody: CircleSlash,
}

/** What a repo's row says on its right: its own mode, or that it follows the Company's. */
export function repoModeLabel(repo: Pick<RepoTestSettings, 'mode'>, company: TestMode): string {
  return repo.mode === null ? `${TEST_MODE_LABEL[company]} · company default` : TEST_MODE_LABEL[repo.mode]
}

/**
 * Testing before merge, in Company settings (frame `YatUW`, card c): one Company default, one line
 * per repo that differs from it, and the run command and port `Run it` uses in the ticket's
 * worktree. It saves as it changes, like the digest card, so it is its own card.
 */
export function TestingSetting() {
  const [settings, setSettings] = useState<TestSettings | null>(null)
  const repos = useIpcResource(resources.repos)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { runCommand: string; port: string }>>({})
  const modeName = useId()

  const refresh = useCallback(async () => {
    const result = await api.tests.settings()
    if (!result.ok) return setError(result.error)
    setSettings(result.value)
    setDrafts((current) => {
      const next = { ...current }
      for (const repo of result.value.repos) {
        if (next[repo.repoId] === undefined) {
          next[repo.repoId] = { runCommand: repo.runCommand, port: repo.port === null ? '' : String(repo.port) }
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    void refresh()
    return api.tests.onChanged(() => void refresh())
  }, [refresh])

  async function save(action: () => Promise<{ ok: true; value: TestSettings } | { ok: false; error: string }>) {
    const result = await action()
    setError(result.ok ? null : result.error)
    if (result.ok) setSettings(result.value)
  }

  if (!settings) return null
  const named = (id: string) => repos.find((repo) => repo.id === id)?.name ?? 'removed repo'
  const overridden = settings.repos.filter(
    (repo) => repo.mode !== null || repo.runCommand !== '' || repo.port !== null || open === repo.repoId,
  )
  const rest = settings.repos.filter((repo) => !overridden.includes(repo))

  return (
    <SettingsCard
      title="Testing before merge"
      sub="After review, the ticket waits in Testing. The script comes from the plan’s acceptance criteria."
    >
      {/* `QgXdU` keeps the label, the track and the help as one block on a field's 6, then a
          divider, then the per-repo block on its own 8 — not five card rows 14 apart. */}
      <div className={FIELD}>
        <h3 className={LABEL}>Who tests</h3>
        <SegmentedControl
          label="Who tests"
          name={modeName}
          value={settings.mode}
          classes={{ track: MODES, option: MODE, on: MODE_ON, off: MODE_OFF }}
          options={TEST_MODES.map((mode) => ({
            value: mode,
            label: TEST_MODE_LABEL[mode],
            icon: MODE_ICON[mode],
          }))}
          onChange={(mode) => void save(() => api.tests.setMode(mode))}
        />
        <p className={HELP}>{TEST_MODE_HELP[settings.mode]}</p>
      </div>
      <div className={DIVIDER} />
      <div className={REPOS}>
        <h3 className={LABEL}>Per repo</h3>
        {settings.repos.length === 0 && (
          <p className={HELP}>
            This Company has no repos yet. Add one in Repositories and it shows here with its own run command.
          </p>
        )}
        {overridden.map((repo) => (
          <div key={repo.repoId} className={REPO}>
            <div className={REPO_HEAD}>
              <span className={REPO_NAME}>
                <FolderGit2 size={12} aria-hidden /> {named(repo.repoId)}
              </span>
              {/* The chip is the control: the picker sits over it, so the row reads as the frame draws it. */}
              <span className={REPO_PICK}>
                {/* The frame keeps the chevron outside the pill, as its own mark beside it. */}
                <span className={REPO_MODE} data-mode={repo.mode ?? settings.mode}>
                  {repoModeLabel(repo, settings.mode)}
                </span>
                <ChevronDown size={14} aria-hidden />
                <select
                  aria-label={`Who tests ${named(repo.repoId)}`}
                  value={repo.mode ?? ''}
                  onChange={(event) =>
                    void save(() =>
                      api.tests.setRepo(repo.repoId, {
                        mode: event.target.value === '' ? null : (event.target.value as TestMode),
                      }),
                    )
                  }
                >
                  <option value="">Company default</option>
                  {TEST_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {TEST_MODE_LABEL[mode]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {repo.mode !== 'nobody' && (
              <div className={REPO_RUN}>
                <label className={RUN}>
                  <TerminalSquare size={12} aria-hidden />
                  <span>Run</span>
                  <input
                    aria-label={`Run command for ${named(repo.repoId)}`}
                    placeholder="pnpm dev"
                    value={drafts[repo.repoId]?.runCommand ?? ''}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [repo.repoId]: { port: current[repo.repoId]?.port ?? '', runCommand: event.target.value },
                      }))
                    }
                    onBlur={(event) =>
                      void save(() => api.tests.setRepo(repo.repoId, { runCommand: event.target.value }))
                    }
                  />
                </label>
                <label className={PORT}>
                  <span>Port</span>
                  <input
                    aria-label={`Port for ${named(repo.repoId)}`}
                    placeholder="—"
                    inputMode="numeric"
                    value={drafts[repo.repoId]?.port ?? ''}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [repo.repoId]: { runCommand: current[repo.repoId]?.runCommand ?? '', port: event.target.value },
                      }))
                    }
                    onBlur={(event) => {
                      const typed = event.target.value.trim()
                      void save(() => api.tests.setRepo(repo.repoId, { port: typed === '' ? null : Number(typed) }))
                    }}
                  />
                </label>
              </div>
            )}
            {repo.mode === 'nobody' && (
              <p className={HELP_IN_REPO}>Merges straight after review. Nothing here is tested.</p>
            )}
          </div>
        ))}
        {rest.length > 0 && (
          <label className={ADD}>
            <Plus size={13} aria-hidden />
            <span>Override for another repo</span>
            <select
              aria-label="Override for another repo"
              value=""
              onChange={(event) => event.target.value && setOpen(event.target.value)}
            >
              <option value="">Pick a repo…</option>
              {rest.map((repo) => (
                <option key={repo.repoId} value={repo.repoId}>
                  {named(repo.repoId)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && <p className={ERROR_LINE}>{error}</p>}
    </SettingsCard>
  )
}
