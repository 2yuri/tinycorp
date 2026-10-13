import {
  Code,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  FlaskConical,
  FolderGit2,
  KeyRound,
  Lock,
  type LucideIcon,
  Pencil,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CLIPBOARD_CLEAR_MS,
  type EnvironmentId,
  type EnvironmentSettings,
  type EnvVariable,
  howItWorks,
  type ImportPreview,
  MASKED_VALUE,
  NOT_A_SANDBOX,
  REVEAL_MS,
  UNPROTECTED_REVEAL,
} from '../../../shared/environments'
import { secretStoreShort } from '../../../shared/platform/machine-words'
import { hostPlatform } from '../chrome'
import { useEnvironmentSettings } from '../environments'
import { resources, useIpcResource } from '../ipc'
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  cx,
  EmptyState,
  IconButton,
  InputGroup,
  SegmentedControl,
  Toggle,
} from '../ui'
import {
  askDefaultsLine,
  draftOf,
  draftProblem,
  draftRepoIds,
  emptyDraft,
  lastUsedLine,
  type RepoScope,
  repoChips,
  repoDefaultNote,
  switchChips,
  type VariableDraft,
} from './environments-model'
import '../ui/tailwind.css'
import {
  CARD,
  CARD_HEAD,
  CARD_SUB,
  DIVIDER,
  ERRORS,
  FULL_ROW,
  LABEL,
  LINE,
  LINE_TEXT,
  LINE_TITLE,
} from './settings-classes'

/*
 * Environments (design frame `zpvHQ`): the variables table, its explainer, and a side panel. The
 * padding is the settings container's and this tab adds none of its own (T181).
 */
const CONTENT =
  'grid grid-cols-[minmax(0,1fr)_320px] items-start gap-16 [@media(max-width:1100px)]:grid-cols-[minmax(0,1fr)]'
const MAIN = 'flex min-w-0 flex-col gap-14'

/** The switch, the chip that follows it, and the two buttons on the right. */
/*
 * Wraps rather than runs on: where the fonts are wider than the Mac's (Linux), the environment
 * picker, the notice and the two buttons overflowed the column into the side panel, which is drawn
 * after it and took every click meant for Add variable (T293).
 */
const BAR = 'flex flex-wrap items-center gap-10'
const BAR_ACTIONS = 'ml-auto flex gap-8'

/** Three equal chips inside one 258px control; 3px from the outer edge, the stroke inside it. */
const SWITCH = 'flex w-258 gap-3 rounded-sm border border-border bg-muted p-2'

/** 34px of control: the stroke, 2px of padding, the frame's 28px chip, 2px, the stroke. */
export const CHIP_BASE =
  'flex h-28 min-w-0 flex-[1_1_0] cursor-pointer items-center justify-center gap-6 rounded-sm border-0 p-0 px-10 text-12/[inherit]'
const CHIP_OFF = 'bg-transparent text-muted-foreground'
const CHIP_ON = 'bg-primary text-primary-foreground'
const CHIP_NAME = 'font-code'
const CHIP_COUNT = 'font-code text-10-5/[inherit] text-inherit opacity-80'

const ASKS =
  'flex items-center gap-5 rounded-full border border-status-warning-foreground bg-status-warning px-9 py-3 text-11/13 whitespace-nowrap text-status-warning-foreground'

/**
 * The table. A grid rather than a `<table>`: the last column is buttons, not data. Its stroke is
 * an `::after` inside and on top, so a row's 16px is measured from the table's own edge.
 */
const TABLE =
  'relative flex flex-col overflow-hidden rounded-md bg-card after:pointer-events-none after:absolute after:inset-0 after:z-1 after:rounded-[inherit] after:border after:border-border after:content-[""]'

/*
 * The five tracks the frame measures, at its own 788px table: 176, 104, 140, 128 and what is left
 * for the buttons, 12px apart inside 16px of padding.
 */
const ROW_LINE =
  'grid min-h-46 grid-cols-[176px_104px_140px_128px_minmax(160px,1fr)] items-center gap-12 border-t border-border px-16 text-13/[inherit]'

/*
 * `zpvHQ` measures its head row's own tracks, 16px wider under REPOS and 16 narrower at the end
 * than the rows beneath it. Its labels are where they are because of it, so it keeps them.
 */
const ROW_HEAD =
  'grid min-h-33 grid-cols-[176px_104px_156px_128px_minmax(144px,1fr)] items-center gap-12 border-t-0 bg-muted/70 px-16 text-11/13 font-bold tracking-[0.5px] uppercase text-muted-foreground'

const NAME =
  'flex min-w-0 items-center gap-7 overflow-hidden font-code text-12/[inherit] font-semibold overflow-ellipsis whitespace-nowrap text-code-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground'

const VALUE = 'overflow-hidden font-code text-12/[inherit] tracking-[0.5px] text-muted-foreground'

/** A revealed value is the one thing on this screen that is a value; it reads as one. */
const VALUE_SHOWN = 'overflow-hidden font-code text-12/[inherit] tracking-[0] [overflow-wrap:anywhere] text-foreground'

/** The chips stay on one line: a `+1` under its repo reads as a second row. */
const REPOS = 'flex min-w-0 flex-nowrap items-center gap-5'

/** A repo chip carries the folder mark the frame gives it, and reads as a pill, not a box. */
const CHIP =
  'flex items-center gap-5 overflow-hidden rounded-full bg-secondary px-8 py-3 font-code text-10-5/[inherit] whitespace-nowrap text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground'
const CHIP_ALL =
  'flex items-center gap-5 overflow-hidden rounded-full bg-secondary px-8 py-3 font-sans text-10-5/[inherit] whitespace-nowrap text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground'

/** `+1` never shrinks: the repo name gives up its characters first. */
const CHIP_MORE =
  'flex flex-none items-center gap-5 overflow-hidden rounded-full bg-secondary px-8 py-3 font-code text-10-5/[inherit] whitespace-nowrap text-foreground'
const CHIP_NAME_TEXT = 'overflow-hidden text-ellipsis'

const USED = 'flex min-w-0 items-center gap-6 overflow-hidden text-12/[inherit] whitespace-nowrap text-foreground'
const USED_TEXT = 'min-w-0 overflow-hidden text-ellipsis'
const USED_NEVER = 'text-muted-foreground'

/**
 * Reveal is the frame's small button, not the toolbar one: the row is 46px, not 56 — 5/8 around an
 * 11.5px label, with its stroke inside that padding. `IconButton` draws `ui-button--icon`.
 */
const ACTIONS =
  'flex items-center justify-end gap-2 [&_[data-slot=button]]:gap-5 [&_[data-slot=button]]:px-7 [&_[data-slot=button]]:py-4 [&_[data-slot=button]]:text-11-5/[inherit] [&_[data-slot=button]_svg]:size-13 [&_[data-slot=button][data-variant=icon]]:size-26'

/** The frame draws the bin in the destructive red, not the grey the other two share. */
const DELETE = 'text-destructive'

const FOOT = 'flex items-center gap-8 border-t border-border bg-muted/70 px-16 py-10 text-11-5/14 text-muted-foreground'

/**
 * "Employees never see these values", the three steps, and the honesty line the frame puts inside
 * the same card (T181) rather than under it. The stroke is an `::after`, as the table's is.
 *
 * Its heading and its paragraphs are styled from here rather than on the elements, because that is
 * what the stylesheet did: `.environments-explainer h2` and `… p`, so the modal that reuses this
 * shape keeps the same type without repeating it.
 */
const EXPLAINER =
  'relative flex flex-col gap-12 rounded-md bg-card p-18 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border after:content-[""] [&_h2]:mt-0 [&_h2]:mr-0 [&_h2]:mb-3 [&_h2]:ml-0 [&_h2]:text-14/[inherit] [&_h2]:font-bold [&_h2]:text-foreground [&_p]:m-0 [&_p]:text-11-5/17 [&_p]:text-muted-foreground'
const EXPLAINER_HEAD = 'flex items-start gap-12'
const EXPLAINER_MARK =
  'flex size-32 flex-none items-center justify-center rounded-full bg-primary-subtle text-[var(--accent-soft,var(--primary-foreground))]'

const STEPS = 'grid grid-cols-3 gap-8 [@media(max-width:900px)]:grid-cols-[minmax(0,1fr)]'

/** 10/12 of padding, and the stroke gives back its own pixel, as the frame measures `fvWh3`. */
const STEP = 'rounded-sm border border-input bg-muted px-11 py-9'
const STEP_TITLE =
  'mb-4 flex items-center gap-6 font-code text-12/[inherit] font-semibold text-code-foreground [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const STEP_BODY = 'text-11/15 text-muted-foreground'

/** The kit's Alert at the padding and type this instance sets, as on Usage & routing. */
const WARNING =
  'py-10 pr-12 pl-9 [&_[data-slot=alert-icon]]:size-16 [&_[data-slot=alert-title]]:text-13/[inherit] [&_[data-slot=alert-body]]:text-12/18'

/** The side panel, at the frame's 320. */
export const SIDE = 'flex flex-col gap-16'
const SIDE_HEAD = 'flex items-center gap-8 text-foreground'
const SIDE_NAME = 'font-code text-14/[inherit] font-bold'
const SIDE_SUB = 'm-0 text-11-5/17 text-muted-foreground'

/** `DEFAULT FOR` and its repos are one block in the frame, 8px apart — not two card rows. */
const SIDE_GROUP = 'flex flex-col gap-8'
const DEFAULTS = 'flex flex-col gap-8'
const DEFAULT_ROW = 'flex items-center gap-8 text-13/[inherit]'
const DEFAULT_NAME = 'font-code text-12-5/[inherit] text-foreground'
const DEFAULT_NOTE = 'ml-auto text-12/[inherit] text-muted-foreground'

/** The frame's `pS5BQ`: a filled note with no stroke of its own, at 10/12 and 11px. */
const STORED = 'flex items-center gap-8 rounded-sm bg-muted px-12 py-10 text-11/16 text-muted-foreground'

/** Add, Edit, Delete and Import, in the shape Integrations gave a modal. */
const OVERLAY = 'fixed inset-0 z-60 flex items-center justify-center bg-black/55 p-24'
const MODAL = 'flex max-h-full w-520 max-w-full flex-col rounded-md border border-border bg-card font-sans'
const MODAL_HEAD = 'flex items-start gap-10 border-b border-border px-18 py-16 text-primary'
const MODAL_TITLE = 'text-14/[inherit] font-bold text-foreground'
const MODAL_SUB = 'text-12-5/[inherit] text-muted-foreground'
const MODAL_BODY = 'flex flex-col gap-14 overflow-auto p-18'
const MODAL_FOOT = 'flex justify-end gap-8 border-t border-border px-18 py-14'

const SCOPE = 'flex flex-col gap-8'

/**
 * The repo list, bounded and scrolling inside itself (T218). A Company with twenty repos grew the
 * modal until its own footer left the window, and a boss with no footer cannot press Add variable.
 */
const REPO_LIST = 'flex max-h-196 flex-col gap-8 overflow-y-auto rounded-sm border border-border bg-muted px-12 py-10'

/** The two answers to *which repos may use it*, in the order the modal asks them. */
const ALL_REPOS = 'All repos'
const REPO_SCOPES: readonly { value: RepoScope; label: string }[] = [
  { value: 'all', label: ALL_REPOS },
  { value: 'only', label: 'Only these' },
]
const IMPORT = 'flex flex-col gap-6'
const IMPORT_KEY = 'flex items-center gap-10 rounded-[8px] border border-border bg-muted px-10 py-8'
const IMPORT_KEY_OFF = 'flex items-center gap-10 rounded-[8px] border border-border bg-muted px-10 py-8 opacity-60'
const IMPORT_NAME = 'font-code text-12-5/[inherit] text-foreground'
const IMPORT_NOTE = 'ml-auto text-12/[inherit] text-muted-foreground'
const IMPORT_NOTE_REPLACES = 'ml-auto text-12/[inherit] text-status-warning-foreground'

const api = window.tinyCorp

/** `the keychain` here, `the keyring` on a Linux desktop. The screen never promises the wrong one. */
const store = (): string => secretStoreShort(hostPlatform())

/**
 * The mark each environment's chip carries in frame `zpvHQ`: the code a dev runs, the flask a
 * staging run is, the lock on the one that asks. An environment the frame does not draw falls to
 * the terminal, the way a Provider with no mark does.
 */
const SWITCH_ICON: Record<string, LucideIcon> = { dev: Code, staging: FlaskConical, prod: Lock }

/**
 * Company settings → Environments (frame `zpvHQ`): the secrets the Company's Employees use without
 * ever seeing them.
 *
 * Like Integrations and Usage & routing, every control here saves itself — a value in the secret
 * store is not a draft, and a Save the boss forgot would be a team locked out of the database all
 * night.
 *
 * Where that store is depends on the machine, and the screen says so rather than promising a
 * keychain to a Linux desktop that has a keyring instead (T177, `shared/platform/machine-words.ts`).
 *
 * The screen says three things that are not decoration: what happens (`env_run` → the store →
 * ‹NAME›), what protects Reveal and Copy, and what none of it protects against — the *Not a
 * sandbox* line, which stays on the screen because code an Employee writes could still send a
 * value somewhere.
 *
 * It says one thing less than it should: an Employee that goes looking can act as *another*
 * Employee and reach the environments that one's repos are scoped to (T199, finding H5), and that
 * belongs beside this line. The sentence does not fit the frame's single-line alert — it wraps,
 * everything under it moves, and both of this screen's states go two points over the fidelity
 * floor — so it is a Pen change first (frames `zpvHQ` and `JmtHi`) and lives in `SECURITY.md`
 * until then.
 */
/** The mark the frame draws over each step of `Employees never see these values.` (`zpvHQ`). */
const STEP_MARKS: LucideIcon[] = [Terminal, KeyRound, EyeOff]

export function EnvironmentsTab({
  now = () => new Date(),
}: {
  /** The clock, so a capture and a test draw a fixed screen. */
  now?: () => Date
} = {}) {
  const settings = useEnvironmentSettings()
  // Everyone on staff, for the LAST USED column; an Employee no longer here shows as its id.
  const employees = useIpcResource(resources.employees)
  const [chosen, setChosen] = useState<EnvironmentId>('prod')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null)
  const [editing, setEditing] = useState<{ variable: EnvVariable | null; draft: VariableDraft } | null>(null)
  const [removing, setRemoving] = useState<EnvVariable | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  // A revealed value goes back behind the dots on its own: it is on the screen, and the screen is
  // in the room (frame `aD50i`, d).
  useEffect(() => {
    if (!revealed) return
    const timer = setTimeout(() => setRevealed(null), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [revealed])

  if (!settings) return <div className={cx(CONTENT, FULL_ROW)} aria-busy="true" />

  const environment = settings.environments.find((row) => row.id === chosen)
  const variables = settings.variables.filter((variable) => variable.environment === chosen)
  const nameOf = (employeeId: string) => employees.find((employee) => employee.id === employeeId)?.name ?? employeeId

  async function run(action: Promise<{ ok: boolean; error?: string }>) {
    const result = await action
    setError(result.ok ? null : (result.error ?? 'That did not work'))
    return result.ok
  }

  async function reveal(variable: EnvVariable) {
    if (revealed?.id === variable.id) return void setRevealed(null)
    const result = await api.environments.reveal(variable.id)
    if (!result.ok) return void setError(result.error)
    setError(null)
    setRevealed({ id: variable.id, value: result.value.value })
    setNote(result.value.protection === 'confirmation' ? UNPROTECTED_REVEAL : null)
  }

  async function copy(variable: EnvVariable) {
    const result = await api.environments.copy(variable.id)
    if (!result.ok) return void setError(result.error)
    setError(null)
    setNote(
      `${variable.name} is on the clipboard. It clears in ${Math.round(CLIPBOARD_CLEAR_MS / 1000)} seconds.` +
        (result.value.protection === 'confirmation' ? ` ${UNPROTECTED_REVEAL}` : ''),
    )
  }

  async function save() {
    if (!editing) return
    const { variable, draft } = editing
    const ok = variable
      ? await run(
          api.environments.update(variable.id, {
            name: draft.name.trim(),
            repoIds: draftRepoIds(draft),
            ...(draft.value !== '' && { value: draft.value }),
          }),
        )
      : await run(
          api.environments.add({
            environment: chosen,
            name: draft.name.trim(),
            value: draft.value,
            repoIds: draftRepoIds(draft),
          }),
        )
    if (ok) setEditing(null)
  }

  async function importEnv() {
    const result = await api.environments.pickEnvFile(chosen)
    if (!result.ok) return void setError(result.error)
    setError(null)
    if (result.value) setPreview(result.value)
  }

  return (
    <div className={cx(CONTENT, FULL_ROW)} data-ui="Environments">
      <div className={MAIN}>
        {error && (
          <div className={ERRORS}>
            <Alert variant="error" title={error} onClose={() => setError(null)} />
          </div>
        )}
        {note && (
          <div className={ERRORS}>
            <Alert variant="info" title={note} onClose={() => setNote(null)} />
          </div>
        )}

        {settings.storageProblem && (
          <Alert variant="error" title="This machine cannot keep a secret">
            {settings.storageProblem}
          </Alert>
        )}

        <div className={BAR}>
          <div className={SWITCH} role="tablist" aria-label="Environment">
            {switchChips(settings).map((chip) => (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={chip.id === chosen}
                className={cx(CHIP_BASE, chip.id === chosen ? CHIP_ON : CHIP_OFF)}
                onClick={() => {
                  setChosen(chip.id)
                  setRevealed(null)
                }}
              >
                {switchIcon(chip.id)}
                <span className={CHIP_NAME}>{chip.id}</span>
                <span className={CHIP_COUNT}>{chip.count}</span>
              </button>
            ))}
          </div>
          {environment?.askEveryUse && (
            <span className={ASKS}>
              <ShieldCheck size={12} aria-hidden /> asks before every use
            </span>
          )}
          <div className={BAR_ACTIONS}>
            <Button
              variant="outline"
              size="sm"
              icon={Upload}
              disabled={settings.storageProblem !== null}
              onClick={() => void importEnv()}
            >
              Import .env
            </Button>
            <Button
              size="sm"
              icon={Plus}
              disabled={settings.storageProblem !== null}
              onClick={() => setEditing({ variable: null, draft: emptyDraft() })}
            >
              Add variable
            </Button>
          </div>
        </div>

        {/* An environment with nothing in it draws the frame's card, not a table of no rows: a
            head row over one grey line is a table that failed, not an invitation (`JmtHi`). */}
        {variables.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={`No variables in ${chosen} yet`}
            body={`Import a .env or add one. Values go straight to this machine's secret store, and Employees use them without ever seeing them.`}
            action={
              <Button icon={Plus} disabled={settings.storageProblem !== null} onClick={() => void importEnv()}>
                Import .env
              </Button>
            }
          />
        ) : (
          <section className={TABLE} aria-label={`${chosen} variables`}>
            <div className={ROW_HEAD}>
              <span>Name</span>
              <span>Value</span>
              <span>Repos</span>
              <span>Last used</span>
              <span />
            </div>
            {variables.map((variable) => {
              const chips = repoChips(variable, settings.repos)
              const used = lastUsedLine(variable, nameOf, now())
              const shown = revealed?.id === variable.id ? revealed.value : null
              return (
                <div className={ROW_LINE} key={variable.id}>
                  <span className={NAME}>
                    <KeyRound size={13} aria-hidden />
                    {variable.name}
                  </span>
                  <span className={shown ? VALUE_SHOWN : VALUE}>{shown ?? MASKED_VALUE}</span>
                  <span className={REPOS}>
                    <span className={chips.all ? CHIP_ALL : CHIP}>
                      {!chips.all && <FolderGit2 size={11} aria-hidden />}
                      <span className={CHIP_NAME_TEXT}>{chips.first}</span>
                    </span>
                    {chips.more > 0 && <span className={CHIP_MORE}>+{chips.more}</span>}
                  </span>
                  <span className={USED}>
                    {used.who ? (
                      <>
                        {/* `zpvHQ` draws this tile on the primary subtle, not the neutral: it
                            stands for who last ran the variable, not for an Employee's own desk. */}
                        <Avatar name={used.who} size={20} tone="primary" />
                        <span className={USED_TEXT}>
                          {used.who} · {used.when}
                        </span>
                      </>
                    ) : (
                      <span className={USED_NEVER}>{used.when}</span>
                    )}
                  </span>
                  <span className={ACTIONS}>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={shown ? Eye : Fingerprint}
                      onClick={() => void reveal(variable)}
                    >
                      {shown ? 'Hide' : 'Reveal'}
                    </Button>
                    <IconButton
                      size="sm"
                      iconSize={13}
                      label={`Copy ${variable.name}`}
                      icon={Copy}
                      onClick={() => void copy(variable)}
                    />
                    <IconButton
                      size="sm"
                      label={`Edit ${variable.name}`}
                      iconSize={13}
                      icon={Pencil}
                      onClick={() => setEditing({ variable, draft: draftOf(variable) })}
                    />
                    <IconButton
                      size="sm"
                      iconSize={13}
                      label={`Delete ${variable.name}`}
                      icon={Trash2}
                      className={DELETE}
                      onClick={() => setRemoving(variable)}
                    />
                  </span>
                </div>
              )
            })}
            <footer className={FOOT}>
              <Fingerprint size={14} aria-hidden />
              {settings.revealFooter}
            </footer>
          </section>
        )}

        <section className={EXPLAINER} aria-label="Employees never see these values">
          <div className={EXPLAINER_HEAD}>
            <span className={EXPLAINER_MARK}>
              <EyeOff size={16} aria-hidden />
            </span>
            <div>
              <h2>Employees never see these values.</h2>
              <p>
                They run commands with them through TinyCorp, and anything printed back is redacted. Testing’s Run it
                and repo checks get them the same way.
              </p>
            </div>
          </div>
          <div className={STEPS}>
            {howItWorks(hostPlatform()).map((step, index) => {
              const Mark = STEP_MARKS[index] ?? Terminal
              return (
                <div className={STEP} key={step.title}>
                  <div className={STEP_TITLE}>
                    <Mark size={12} aria-hidden />
                    {step.title}
                  </div>
                  <div className={STEP_BODY}>{step.body}</div>
                </div>
              )
            })}
          </div>
          {/* Inside the card, as frame `zpvHQ` draws it: it is the last thing the card says. */}
          <Alert className={WARNING} variant="warning" title={NOT_A_SANDBOX.title}>
            {NOT_A_SANDBOX.body}
          </Alert>
        </section>
      </div>

      <aside className={SIDE} aria-label={`${chosen} settings`}>
        <section className={CARD}>
          <div className={CARD_HEAD}>
            <div className={SIDE_HEAD}>
              <span className={SIDE_NAME}>{chosen}</span>
              {environment?.askEveryUse && <Lock size={13} aria-hidden />}
            </div>
            <p className={SIDE_SUB}>Which repos use this environment, and when you are asked.</p>
          </div>
          <div className={SIDE_GROUP}>
            <div className={LABEL}>Default for</div>
            <div className={DEFAULTS}>
              {settings.repos.length === 0 && <span className={SIDE_SUB}>No repos yet.</span>}
              {settings.repos.map((repo) => (
                <div className={DEFAULT_ROW} key={repo.id}>
                  <Checkbox
                    label={null}
                    aria-label={`${repo.name} uses ${chosen} by default`}
                    checked={repo.defaultEnvironment === chosen}
                    onChange={(event) =>
                      void run(api.environments.setRepoDefault(repo.id, event.target.checked ? chosen : null))
                    }
                  />
                  <span className={DEFAULT_NAME}>{repo.name}</span>
                  <span className={DEFAULT_NOTE}>{repoDefaultNote(repo, chosen)}</span>
                </div>
              ))}
            </div>
          </div>
          <Line
            title="Ask me before every use"
            sub={`Each env_run with ${chosen} waits in chat for Approve once. ${askDefaultsLine()}`}
          >
            <Toggle
              label={null}
              aria-label="Ask me before every use"
              checked={environment?.askEveryUse ?? false}
              onChange={(event) => void run(api.environments.setAskEveryUse(chosen, event.target.checked))}
            />
          </Line>
          <Line
            title="Available to Testing and checks"
            sub="Run it and repo checks get these values too — still behind approval."
          >
            <Toggle
              label={null}
              aria-label="Available to Testing and checks"
              checked={environment?.availableToChecks ?? false}
              onChange={(event) => void run(api.environments.setAvailableToChecks(chosen, event.target.checked))}
            />
          </Line>
        </section>
        <div className={STORED} role="note">
          <KeyRound size={14} aria-hidden />
          <span>{settings.storedAt}</span>
        </div>
      </aside>

      {editing && (
        <VariableModal
          environment={chosen}
          repos={settings.repos}
          editing={editing.variable}
          draft={editing.draft}
          onChange={(draft) => setEditing({ variable: editing.variable, draft })}
          onCancel={() => setEditing(null)}
          onSave={() => void save()}
        />
      )}

      {removing && (
        <ConfirmModal
          title={`Delete ${removing.name}?`}
          sub={`Its value is forgotten from ${store()}. Anything running with ${removing.environment} stops getting it.`}
          submit="Delete"
          onCancel={() => setRemoving(null)}
          onSubmit={() => {
            void run(api.environments.remove(removing.id))
            setRemoving(null)
          }}
        />
      )}

      {preview && (
        <ImportModal
          preview={preview}
          onCancel={() => setPreview(null)}
          onImport={(names) => {
            void run(api.environments.importKeys(preview.environment, names))
            setPreview(null)
          }}
        />
      )}
    </div>
  )
}

/** One environment's mark, from {@link SWITCH_ICON}. */
function switchIcon(id: string) {
  const Icon = SWITCH_ICON[id] ?? Terminal
  return <Icon size={12} aria-hidden />
}

/** Add and Edit, which are the same form: the value is write-only, on both. */
function VariableModal({
  environment,
  repos,
  editing,
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  environment: EnvironmentId
  repos: EnvironmentSettings['repos']
  editing: EnvVariable | null
  draft: VariableDraft
  onChange(draft: VariableDraft): void
  onCancel(): void
  onSave(): void
}) {
  const problem = draftProblem(draft, editing !== null)
  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : `Add a variable to ${environment}`}
      sub={
        editing
          ? `Leave the value empty to keep the one already in ${store()}.`
          : `The value goes straight to ${store()}. It is never written to the Company database.`
      }
      submit={editing ? 'Save' : 'Add variable'}
      ready={problem === null}
      onCancel={onCancel}
      onSubmit={onSave}
    >
      <InputGroup
        label="Name"
        value={draft.name}
        placeholder="DATABASE_URL"
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
      />
      <InputGroup
        label="Value"
        type="password"
        value={draft.value}
        placeholder={editing ? 'Unchanged' : 'postgres://…'}
        helper={problem ?? 'Shown to nobody, including the Employees that use it.'}
        error={problem !== null && draft.value !== ''}
        onChange={(event) => onChange({ ...draft, value: event.target.value })}
      />
      <div className={SCOPE}>
        <div className={LABEL}>Repos allowed to use it</div>
        {/* Every repo unless the boss says otherwise (T218). The list used to start with nothing
            ticked, which meant the same thing and read as *none of them*. */}
        <SegmentedControl
          label="Repos allowed to use it"
          name="env-repo-scope"
          value={draft.scope}
          options={REPO_SCOPES}
          onChange={(scope) => onChange({ ...draft, scope })}
        />
        {draft.scope === 'all' ? (
          <p className={SIDE_SUB}>Every repo of this Company may use it, including repos added later.</p>
        ) : (
          <div className={REPO_LIST}>
            {repos.length === 0 && <span className={SIDE_SUB}>This Company has no repos yet.</span>}
            {repos.map((repo) => (
              <div className={DEFAULT_ROW} key={repo.id}>
                <Checkbox
                  label={null}
                  aria-label={`${repo.name} may use it`}
                  checked={draft.repoIds.includes(repo.id)}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      repoIds: event.target.checked
                        ? [...draft.repoIds, repo.id]
                        : draft.repoIds.filter((id) => id !== repo.id),
                    })
                  }
                />
                <span className={DEFAULT_NAME}>{repo.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** The Import .env preview (frame `aD50i`, c): keys with checkboxes, and not one value. */
function ImportModal({
  preview,
  onCancel,
  onImport,
}: {
  preview: ImportPreview
  onCancel(): void
  onImport(names: string[]): void
}) {
  const [ticked, setTicked] = useState(() => preview.keys.filter((key) => key.chosen).map((key) => key.name))
  return (
    <Modal
      title={`Import .env into ${preview.environment}`}
      sub={`${preview.file} · ${preview.keys.length} keys found`}
      submit={`Import ${ticked.length} ${ticked.length === 1 ? 'key' : 'keys'}`}
      ready={ticked.length > 0}
      onCancel={onCancel}
      onSubmit={() => onImport(ticked)}
    >
      <div className={IMPORT}>
        {preview.keys.map((key) => (
          <div className={key.problem ? IMPORT_KEY_OFF : IMPORT_KEY} key={key.name}>
            <Checkbox
              label={null}
              aria-label={key.name}
              checked={ticked.includes(key.name)}
              disabled={key.problem !== null}
              onChange={(event) =>
                setTicked((names) =>
                  event.target.checked ? [...names, key.name] : names.filter((name) => name !== key.name),
                )
              }
            />
            <span className={IMPORT_NAME}>{key.name}</span>
            <span className={key.note.startsWith('replaces') ? IMPORT_NOTE_REPLACES : IMPORT_NOTE}>
              {key.problem ?? key.skipReason ?? key.note}
            </span>
          </div>
        ))}
      </div>
      <div className={STORED} role="note">
        <KeyRound size={14} aria-hidden />
        <span>Values go straight to {store()}. They are never shown here, and the file is left as it is.</span>
      </div>
    </Modal>
  )
}

function ConfirmModal(props: { title: string; sub: string; submit: string; onCancel(): void; onSubmit(): void }) {
  return (
    <Modal {...props} ready destructive>
      <span />
    </Modal>
  )
}

/**
 * Why the overlay is a portal, and not a `div` where it is written (T218).
 *
 * Company settings draws every tab inside a `<form>` of its own — Save changes is that form's
 * submit — so a modal written in place is a `<form>` inside a `<form>`. Chromium associates the
 * controls correctly, but it does **not** propagate the inner form's `submit` event past the
 * outer form: it stops at the ancestor `<form>`, below the root container React delegates from.
 * React therefore never runs `onSubmit`, nothing calls `preventDefault`, and Chromium submits the
 * form to the page's own URL — which reloads the renderer, so the boss loses what they typed and
 * lands back on the Office. `document.body` puts the dialog outside every form, which is where a
 * dialog belongs anyway; React listens on a portal's container, so the handler below runs.
 */
/** The centred modal, in the shape Integrations and New ticket gave it. */
function Modal(props: {
  title: string
  sub: string
  submit: string
  ready: boolean
  destructive?: boolean
  onSubmit(): void
  onCancel(): void
  children: ReactNode
}) {
  const { onCancel } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className={OVERLAY} onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form
        className={MODAL}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (props.ready) props.onSubmit()
        }}
      >
        <header className={MODAL_HEAD}>
          <KeyRound size={16} aria-hidden />
          <div>
            <div className={MODAL_TITLE}>{props.title}</div>
            <div className={MODAL_SUB}>{props.sub}</div>
          </div>
        </header>
        <div className={MODAL_BODY}>{props.children}</div>
        <footer className={MODAL_FOOT}>
          <Button variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant={props.destructive ? 'destructive' : 'primary'} disabled={!props.ready}>
            {props.submit}
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

function Line(props: { title: string; sub: string; children?: ReactNode }) {
  return (
    <>
      <div className={DIVIDER} />
      <div className={LINE}>
        <div className={LINE_TEXT}>
          <div className={LINE_TITLE}>{props.title}</div>
          <div className={CARD_SUB}>{props.sub}</div>
        </div>
        {props.children}
      </div>
    </>
  )
}

/** The tab's own subtitle, in the header (frame `zpvHQ`). */
export function environmentsSubtitle(): string {
  return 'Secrets your Employees can use without ever seeing them. Values live in this machine’s own secret store.'
}
