import {
  Building2,
  ChevronLeft,
  Circle,
  CircleCheck,
  Ellipsis,
  Folder,
  Info,
  Minus,
  Plus,
  Sparkles,
} from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { AUTONOMY_LABEL, type AutonomyLevel, DEFAULT_AUTONOMY } from '../../../shared/approvals'
import {
  type CompanyFolderHints,
  companyFolderNote,
  companyFolderRefusal,
  NO_FOLDER_HINTS,
} from '../../../shared/platform/company-folder'
import { type DetectedRepo, EMPTY_STACK } from '../../../shared/repos/repo'
import { LogoMark } from '../brand'
import { tildePath } from '../paths'
import { BriefField, ChecksSection, InitialiseRepoAlert } from '../repositories'
import { Button, CHOICE_INPUT, cx, focusOnMount, Toggle } from '../ui'
import { type CompanyDraft, draftFolder } from './create-company'
import { LAUNCHER_BODY, LauncherFrame } from './LauncherFrame'
import { RepoMarkIcon } from './RepoMarkIcon'

/** Sessions a new Company runs at once unless the boss picks another number (decision 18). */
export const DEFAULT_CAP = 5

const AUTONOMY_CHOICES: { level: AutonomyLevel; description: string }[] = [
  { level: 'supervised', description: 'Asks before every step' },
  { level: 'managed', description: 'Asks for merges and hires' },
  { level: 'autonomous', description: 'Reports when work is done' },
]

export const EMPTY_DRAFT: CompanyDraft = {
  name: '',
  folder: null,
  repo: null,
  repoBrief: '',
  autonomy: DEFAULT_AUTONOMY,
  concurrencyCap: DEFAULT_CAP,
  notifications: true,
}

export interface CreateCompanyViewProps {
  draft: CompanyDraft
  busy: boolean
  error: string | null
  /** Where a folder is suggested and what is synced; nothing is suggested without it (T252). */
  hints?: CompanyFolderHints
  onDraft(patch: Partial<CompanyDraft>): void
  onBrowseFolder(): void
  onBrowseRepo(): void
  /** The chosen first repository was just made a git repo: detect it again. */
  onRepoInitialised(path: string): void
  onBack(): void
  onCancel(): void
  onCreate(): void
}

/*
 * The Create step's classes (T210c), off frame `PX9QF`. Sizes carry `/[normal]` because the window
 * draws on the font's own line box — except the two the stylesheet measured, the option's
 * description on 16px and the setting's helper on 15px.
 *
 * `font: inherit` on the elements that are really buttons becomes `font-sans
 * text-[length:inherit]`: there is no `font-inherit` utility, and writing one compiles to nothing
 * at all.
 */
const FORM = cx(LAUNCHER_BODY, 'm-0 pt-28 pb-24')
const HEAD = 'flex w-full shrink-0 items-center gap-12 pb-22'
const BACK =
  'm-0 flex h-32 w-32 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border bg-card p-0 text-left font-sans text-[length:inherit] text-muted-foreground hover:text-foreground'
const HEAD_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const TITLE = 'm-0 whitespace-nowrap text-heading-ink text-20/[normal] font-bold tracking-[-0.4px]'
const SUB = 'm-0 text-muted-foreground text-12-5/[normal] font-normal'
const MARK = 'shrink-0'
const FORM_BODY = 'flex w-full shrink-0 flex-col gap-16'
const ROW = 'flex w-full shrink-0 gap-14'
const FIELD = 'flex min-w-0 flex-1 flex-col gap-6'
const FIELD_WIDE = 'flex w-full flex-none flex-col gap-6'
const LABEL = 'whitespace-nowrap text-muted-foreground text-11/[normal] font-bold tracking-[0.5px]'
/* The field is a box around a bare input: the ring is the box's, the input brings none of its own. */
const INPUT =
  'flex w-full shrink-0 items-center gap-9 rounded-sm border border-border bg-card px-11 py-9 text-muted-foreground focus-within:shadow-focus focus-within:outline-none [&_input]:m-0 [&_input]:min-w-0 [&_input]:flex-1 [&_input]:border-0 [&_input]:bg-transparent [&_input]:p-0 [&_input]:font-sans [&_input]:text-foreground [&_input]:text-13-5/[normal] [&_input]:leading-[normal] [&_input]:font-normal [&_input]:outline-none [&_input::placeholder]:text-muted-foreground'
const PATH_BUTTON = cx(INPUT, 'm-0 cursor-pointer text-left font-sans text-[length:inherit] [&_svg]:shrink-0')
const PATH =
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-code text-foreground text-12-5/[normal] font-normal'
/* No path yet: the placeholder is the window's own face, not the mono a real path is drawn in. */
const PATH_EMPTY =
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-sans text-muted-foreground text-13-5/[normal] font-normal'
const DIVIDER = 'h-1 w-full shrink-0 bg-border'
const ABOUT = 'flex w-full flex-col gap-10'
const STACK = 'flex w-full flex-wrap items-center gap-6 text-soft-ink'
const STACK_LABEL = 'whitespace-nowrap text-11/[normal] font-semibold'
const STACK_HINT = 'm-0 flex w-full flex-wrap items-center gap-6 text-muted-foreground text-11/[normal] font-semibold'
const CHIP = 'rounded-full bg-secondary px-8 py-3 whitespace-nowrap font-code text-10-5/[normal] font-normal'
const OPTIONS = 'flex w-full shrink-0 gap-10'
/* The autonomy options are labels over a real radio (T190), so the ring comes from the control. */
const OPTION =
  'm-0 flex min-w-0 flex-1 cursor-pointer flex-col gap-5 rounded-sm border border-border bg-card px-11 py-10 text-left font-sans text-[length:inherit] text-inherit has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none'
const OPTION_SELECTED =
  'm-0 flex min-w-0 flex-1 cursor-pointer flex-col gap-5 rounded-sm border border-launcher-selected bg-secondary px-11 py-10 text-left font-sans text-[length:inherit] text-inherit has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none'
const OPTION_ROW = 'flex w-full items-center gap-8'
const RADIO = 'shrink-0 text-muted-foreground'
const RADIO_SELECTED = 'shrink-0 text-foreground'
const OPTION_NAME = 'whitespace-nowrap text-foreground text-13/[normal] font-bold'
const OPTION_DESC = 'w-full text-muted-foreground text-11-5/16 font-normal'
const SETTINGS = 'flex w-full shrink-0 items-center gap-14'
const SETTING = 'flex min-w-0 flex-1 items-center gap-10 rounded-sm border border-border bg-card px-11 py-9'
const SETTING_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const SETTING_LABEL = 'whitespace-nowrap text-foreground text-13/[normal] font-semibold'
/* The helper line under a control: the setting rows' own, and the folder field's note (T252). */
const HELPER = 'text-muted-foreground text-11/15 font-normal'
/* The same line with an `info` mark beside it, off frame `iNGDQ`: the mark sits on the first line. */
const HELPER_INFO = 'flex w-full items-start gap-6 text-muted-foreground'
const HELPER_MARK = 'mt-2 shrink-0'
const STEPPER =
  'flex shrink-0 items-center gap-10 rounded-full bg-secondary px-10 py-5 [&_button]:m-0 [&_button]:flex [&_button]:cursor-pointer [&_button]:rounded-full [&_button]:border-0 [&_button]:bg-transparent [&_button]:p-0 [&_button]:text-left [&_button]:font-sans [&_button]:text-[length:inherit] [&_button]:text-muted-foreground [&_button:hover:not(:disabled)]:text-foreground [&_button:disabled]:cursor-default [&_button:disabled]:opacity-40'
const STEPPER_VALUE = 'font-code text-foreground text-13/[normal] font-bold'
/* The frame draws the switch alone: the kit's own label is the one thing taken off it. */
const TOGGLE = '[&_[data-slot=choice-label]]:hidden'
const FOOTER = 'flex w-full shrink-0 items-center gap-12 pt-24'
const NOTE = 'm-0 min-w-0 flex-1 text-muted-foreground text-11-5/[normal] font-normal'
const NOTE_ERROR = 'm-0 min-w-0 flex-1 text-status-error-foreground text-11-5/[normal] font-normal'
const CREATE_BUTTON = 'px-16 py-9 text-13-5/[normal]'

/** The Launcher's Create step (design/html/create-company.html, frame `PX9QF`). */
export function CreateCompanyView(props: CreateCompanyViewProps) {
  const { draft, hints = NO_FOLDER_HINTS } = props
  const autonomyName = useId()
  // The folder as it stands: the boss's pick, or `<home>/TinyCorp/<name>` until they make one.
  const folder = draftFolder(draft, hints)
  // A share SQLite cannot lock is refused here and again in the engine; Create waits for another
  // folder rather than failing on the one that is chosen (T252).
  const refusal = folder ? companyFolderRefusal(folder) : null
  // A folder in WSL is accepted and says where its database goes; one OneDrive syncs is a warning
  // about the same field (T252, T256). Neither stops Create.
  const note = folder && !refusal ? companyFolderNote(folder, hints) : null
  return (
    <LauncherFrame name="Desktop App / Launcher / Create Company">
      <form
        className={FORM}
        aria-label="Create a company"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCreate()
        }}
      >
        <div className={HEAD}>
          <button type="button" className={BACK} aria-label="Back" title="Back" onClick={props.onBack}>
            <ChevronLeft size={16} aria-hidden />
          </button>
          <div className={HEAD_TEXT}>
            <h1 className={TITLE}>Create a company</h1>
            <p className={SUB}>Point it at a folder. The staff, the board and the chat live inside it.</p>
          </div>
          <LogoMark size={30} className={MARK} />
        </div>

        <div className={FORM_BODY}>
          <div className={ROW}>
            <label className={FIELD}>
              <span className={LABEL}>COMPANY NAME</span>
              <span className={INPUT}>
                <input
                  value={draft.name}
                  placeholder="Name your company"
                  ref={focusOnMount}
                  onChange={(event) => props.onDraft({ name: event.target.value })}
                />
              </span>
            </label>
            <div className={FIELD}>
              <span className={LABEL} id="create-folder">
                FOLDER
              </span>
              <PathButton
                labelledBy="create-folder"
                icon={<Folder size={14} aria-hidden />}
                path={folder}
                placeholder="Choose a folder…"
                onClick={props.onBrowseFolder}
              />
              {note &&
                (note.info ? (
                  <span className={HELPER_INFO}>
                    <Info size={12} aria-hidden className={HELPER_MARK} />
                    <span className={HELPER}>{note.text}</span>
                  </span>
                ) : (
                  <span className={HELPER}>{note.text}</span>
                ))}
            </div>
          </div>

          <div className={DIVIDER} />

          <div className={FIELD_WIDE}>
            <span className={LABEL} id="create-repo">
              FIRST REPOSITORY
            </span>
            <PathButton
              labelledBy="create-repo"
              icon={<RepoMarkIcon />}
              path={draft.repo?.path ?? null}
              placeholder="Choose a git repository…"
              onClick={props.onBrowseRepo}
            />
            {draft.repo && <StackLine repo={draft.repo} onInitialised={props.onRepoInitialised} />}
            {draft.repo?.gitRepo && (
              <div className={ABOUT}>
                <BriefField
                  compact
                  label="About this repo"
                  value={draft.repoBrief ?? ''}
                  onChange={(repoBrief) => props.onDraft({ repoBrief })}
                />
                <ChecksSection
                  key={draft.repo.path}
                  defaultOpen={false}
                  stack={{ ...EMPTY_STACK, ...draft.repo.stack }}
                  onChange={(changes) =>
                    draft.repo && props.onDraft({ repo: { ...draft.repo, stack: { ...draft.repo.stack, ...changes } } })
                  }
                />
              </div>
            )}
          </div>

          <div className={FIELD_WIDE}>
            <span className={LABEL} id="create-autonomy">
              AUTONOMY
            </span>
            <div className={OPTIONS} role="radiogroup" aria-labelledby="create-autonomy">
              {AUTONOMY_CHOICES.map(({ level, description }) => {
                const selected = draft.autonomy === level
                const Radio = selected ? CircleCheck : Circle
                return (
                  <label key={level} className={selected ? OPTION_SELECTED : OPTION}>
                    <input
                      type="radio"
                      className={CHOICE_INPUT}
                      name={autonomyName}
                      checked={selected}
                      onChange={() => props.onDraft({ autonomy: level })}
                    />
                    <span className={OPTION_ROW}>
                      <Radio size={15} aria-hidden className={selected ? RADIO_SELECTED : RADIO} />
                      <span className={OPTION_NAME}>{AUTONOMY_LABEL[level]}</span>
                    </span>
                    <span className={OPTION_DESC}>{description}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className={SETTINGS}>
            <div className={SETTING}>
              <span className={SETTING_TEXT}>
                <span className={SETTING_LABEL}>Concurrency cap</span>
                <span className={HELPER}>Extra Employees wait for a desk</span>
              </span>
              <fieldset className={STEPPER} aria-label="Concurrency cap">
                <button
                  type="button"
                  aria-label="Fewer Sessions"
                  disabled={draft.concurrencyCap <= 1}
                  onClick={() => props.onDraft({ concurrencyCap: draft.concurrencyCap - 1 })}
                >
                  <Minus size={14} aria-hidden />
                </button>
                <output className={STEPPER_VALUE}>{draft.concurrencyCap}</output>
                <button
                  type="button"
                  aria-label="More Sessions"
                  disabled={draft.concurrencyCap >= 99}
                  onClick={() => props.onDraft({ concurrencyCap: draft.concurrencyCap + 1 })}
                >
                  <Plus size={14} aria-hidden />
                </button>
              </fieldset>
            </div>
            <div className={SETTING}>
              <span className={SETTING_TEXT}>
                <span className={SETTING_LABEL}>Notifications</span>
                <span className={HELPER}>Approvals, mentions, PRs, budget</span>
              </span>
              <Toggle
                label="Notifications"
                className={TOGGLE}
                checked={draft.notifications}
                onChange={(event) => props.onDraft({ notifications: event.target.checked })}
              />
            </div>
          </div>
        </div>

        <div className={FOOTER}>
          {(props.error ?? refusal) ? (
            <p className={NOTE_ERROR} role="alert">
              {props.error ?? refusal}
            </p>
          ) : (
            <p className={NOTE}>You can change all of this later in Company settings.</p>
          )}
          <Button size="toolbar" variant="ghost" className={CREATE_BUTTON} onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            size="toolbar"
            type="submit"
            icon={Building2}
            className={CREATE_BUTTON}
            disabled={props.busy || refusal !== null}
          >
            Create company
          </Button>
        </div>
      </form>
    </LauncherFrame>
  )
}

function PathButton(props: {
  labelledBy: string
  icon: ReactNode
  path: string | null
  placeholder: string
  onClick(): void
}) {
  return (
    <button
      type="button"
      className={PATH_BUTTON}
      aria-labelledby={props.labelledBy}
      title={props.path ?? undefined}
      onClick={props.onClick}
    >
      {props.icon}
      <span className={props.path ? PATH : PATH_EMPTY}>{props.path ? tildePath(props.path) : props.placeholder}</span>
      <Ellipsis size={14} aria-hidden />
    </button>
  )
}

function StackLine({ repo, onInitialised }: { repo: DetectedRepo; onInitialised(path: string): void }) {
  if (!repo.gitRepo) {
    return <InitialiseRepoAlert path={repo.path} onInitialised={() => onInitialised(repo.path)} />
  }
  if (!repo.stack) {
    return <p className={STACK_HINT}>No checks detected — optional; whoever sets it up records them</p>
  }
  const { language, framework, packageManager } = repo.stack
  const chips = repo.commands.length > 0 ? repo.commands : [language, framework, packageManager]
  return (
    <div className={STACK} title={`${language} · ${framework} · ${packageManager}`}>
      <Sparkles size={12} aria-hidden />
      <span className={STACK_LABEL}>Checks detected</span>
      {chips.map((chip, index) => (
        <span key={`${index}-${chip}`} className={CHIP}>
          {chip}
        </span>
      ))}
    </div>
  )
}
