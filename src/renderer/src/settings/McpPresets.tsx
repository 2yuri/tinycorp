import { ExternalLink, KeySquare } from 'lucide-react'
import { useState } from 'react'
import {
  isPresetSecret,
  MCP_PRESETS,
  MCP_PRESETS_SUB,
  type McpPreset,
  type McpPresetField,
  presetCheckedLine,
  presetDefaults,
  presetLinks,
  presetMatches,
  presetNeedLine,
  presetProblems,
  presetTarget,
} from '../../../shared/catalogue/mcp-presets'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { Result } from '../../../shared/domain/result'
import { inMachineWords } from '../../../shared/platform/machine-words'
import { hostPlatform } from '../chrome'
import { Alert, Badge, InputGroup, PresetMark, Select, SettingsCard } from '../ui'
import { Modal, NONE, ROW_TARGET } from './mcp-parts'
import { FIELD_MONO } from './settings-classes'

/*
 * Company settings › Integrations › Popular (T242, frames `mPqN9`, `gue8i`).
 *
 * Typing a server in by hand means knowing its package name, its arguments and which of its
 * environment variables is the secret one — which is why the boss asked for this. A preset knows
 * all three; the boss fills only what the server genuinely cannot be given, in a masked field
 * whose value goes from the main process to the OS store and is never read back.
 *
 * Nothing about a preset is written here: the table is `shared/catalogue/mcp-presets.ts`, and
 * adding one is an entry there.
 */

/**
 * Three tiles to a row, because the card sits in one of Company settings' two columns. A grid and
 * not rows of flex items: with `flex-basis: 0` a tile still counts its own padding and border and
 * an empty filler does not, so a short last row came out wider than the rows above it.
 */
const GRID = 'grid grid-cols-3 gap-8'

/** One preset: a generic mark, the service's own name, and what it will ask for. */
const TILE =
  'flex min-w-0 cursor-pointer items-center gap-9 rounded-sm border border-border bg-muted px-10 py-8 text-left hover:border-primary'
const TILE_MARK = 'flex size-26 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground'
const TILE_TEXT = 'flex min-w-0 flex-col gap-1'
const TILE_NAME = 'overflow-hidden text-ellipsis whitespace-nowrap text-12-5/[inherit] font-semibold text-foreground'
const TILE_NEED = 'overflow-hidden text-ellipsis whitespace-nowrap text-10-5/13 text-muted-foreground'

/** The dialog: where the server is, where to get what it asks for, and what is kept where. */
const DIALOG_TARGET = 'flex items-center gap-10 rounded-sm border border-border bg-muted px-11 py-9'
const DIALOG_LINK = 'flex items-center gap-6 self-start text-11-5/[inherit] font-semibold text-primary'
const DIALOG_NOTE = 'flex items-center gap-8 rounded-sm bg-muted px-12 py-10'
const DIALOG_NOTE_TEXT = 'm-0 text-11-5/[1.45] text-muted-foreground'

const api = () => window.tinyCorp
const addPresetServer = (presetId: string, name: string, values: Record<string, string>) =>
  api().mcp.addPreset(presetId, name, values)

export function McpPresetsCard({
  query,
  taken,
  addPreset = addPresetServer,
}: {
  /** The tab's search. */
  query: string
  /** The names the catalogue already holds, so a preset's default name is checked before it opens. */
  taken: readonly string[]
  /** The add. Injected in the tests and the capture, which have no main process. */
  addPreset?(presetId: string, name: string, values: Record<string, string>): Promise<Result<McpServerRow>>
}) {
  const [setting, setSetting] = useState<McpPreset | null>(null)
  const shown = MCP_PRESETS.filter((preset) => presetMatches(preset, query, hostPlatform()))

  return (
    <>
      <SettingsCard
        title="Popular"
        sub={inMachineWords(MCP_PRESETS_SUB, hostPlatform())}
        control={<span className={TILE_NEED}>{countLine(MCP_PRESETS.length)}</span>}
      >
        {shown.length === 0 && <p className={NONE}>No preset matches that.</p>}
        {shown.length > 0 && (
          <div className={GRID}>
            {shown.map((preset) => (
              <PresetTile key={preset.id} preset={preset} onOpen={() => setSetting(preset)} />
            ))}
          </div>
        )}
      </SettingsCard>
      {setting && (
        <PresetDialog preset={setting} taken={taken} addPreset={addPreset} onClose={() => setSetting(null)} />
      )}
    </>
  )
}

function countLine(presets: number): string {
  return presets === 1 ? '1 preset' : `${presets} presets`
}

function PresetTile({ preset, onOpen }: { preset: McpPreset; onOpen(): void }) {
  return (
    <button type="button" className={TILE} data-ui="Preset" onClick={onOpen}>
      <span className={TILE_MARK} aria-hidden>
        <PresetMark preset={preset} size={14} />
      </span>
      <span className={TILE_TEXT}>
        <span className={TILE_NAME}>{preset.name}</span>
        <span className={TILE_NEED}>{presetNeedLine(preset)}</span>
      </span>
    </button>
  )
}

/**
 * Setting one up (frame `gue8i`): the target TinyCorp already knows, the name it will take, and
 * one field per thing the boss has to supply.
 *
 * A `secret` field is a password box and its value goes over IPC once, to the main process, which
 * hands it to the OS store. Nothing reads it back — not this screen, not the next time the dialog
 * opens, not the catalogue row, which says only that there is one.
 */
export function PresetDialog({
  preset,
  taken,
  onClose,
  addPreset = addPresetServer,
}: {
  preset: McpPreset
  taken: readonly string[]
  onClose(): void
  addPreset?(presetId: string, name: string, values: Record<string, string>): Promise<Result<McpServerRow>>
}) {
  const [name, setName] = useState(preset.server)
  /*
   * A field the boss picks from opens on its first choice (T245), so the endpoint in the mono line
   * above is a real one before anything has been touched — and a boss on US1 who never opens the
   * site control still adds a server that resolves.
   */
  const [values, setValues] = useState<Record<string, string>>(() => presetDefaults(preset))
  const [error, setError] = useState<string | null>(null)
  const problems = presetProblems(preset, name, values, taken)
  const ready = Object.keys(problems).length === 0
  /*
   * A field the boss has not reached yet is not wrong, it is empty — and an empty box outlined in
   * red the moment a dialog opens reads as something already having gone wrong. So a field's own
   * problem waits until it has been typed in; the disabled button is what says it is not done. The
   * name is the exception: it arrives filled in, so a name this Company already has is wrong from
   * the start and the boss would otherwise be looking at a button that will not press.
   */
  const shownFor = (key: string) => (values[key] === undefined ? undefined : problems[key])

  const target = presetTarget(preset, values)

  async function run() {
    const result = await addPreset(preset.id, name.trim(), values)
    if (result.ok) onClose()
    else setError(result.error)
  }

  return (
    <Modal
      title={`Set up ${preset.name}`}
      sub={inMachineWords(preset.summary, hostPlatform())}
      submit={`Add ${preset.name}`}
      mark={<PresetMark preset={preset} size={16} />}
      ready={ready}
      onCancel={onClose}
      onSubmit={() => void run()}
    >
      {error && <Alert variant="error" title={error} onClose={() => setError(null)} />}
      <div className={DIALOG_TARGET}>
        <Badge variant="neutral">{preset.transport}</Badge>
        <span className={ROW_TARGET} title={target}>
          {target}
        </span>
      </div>
      {preset.caveat && (
        <Alert variant="warning" title="Before it will work">
          {inMachineWords(preset.caveat, hostPlatform())}
        </Alert>
      )}
      <InputGroup
        label="Name"
        className={FIELD_MONO}
        spellCheck={false}
        value={name}
        error={problems['name'] !== undefined}
        helper={problems['name'] ?? 'The name the Employee sees its tools under.'}
        onChange={(event) => setName(event.target.value)}
      />
      {preset.fields.map((field) => (
        <PresetField
          key={field.key}
          field={field}
          value={values[field.key] ?? ''}
          problem={shownFor(field.key)}
          onChange={(value) => setValues((held) => ({ ...held, [field.key]: value }))}
        />
      ))}
      {presetLinks(preset, values).map((link) => (
        // `target` and `rel` because `window-policy.ts` opens an outside link in the boss's own
        // browser and never in a window of this app's.
        <a key={link.url} className={DIALOG_LINK} href={link.url} target="_blank" rel="noreferrer">
          <ExternalLink size={13} aria-hidden />
          {link.label}
        </a>
      ))}
      <div className={DIALOG_NOTE}>
        <KeySquare size={13} className="shrink-0 text-muted-foreground" aria-hidden />
        <p className={DIALOG_NOTE_TEXT}>{presetCheckedLine(preset)}</p>
      </div>
    </Modal>
  )
}

/**
 * One thing the boss supplies: a select when the preset names the choices, a password box for
 * anything that goes to the OS store — a `secret` or a `header-secret`, since a key in a header is
 * as secret as a key in a bearer token — and a plain box otherwise.
 */
function PresetField({
  field,
  value,
  problem,
  onChange,
}: {
  field: McpPresetField
  value: string
  problem: string | undefined
  onChange(value: string): void
}) {
  const frame = {
    label: field.label,
    error: problem !== undefined,
    helper: problem ?? inMachineWords(field.helper, hostPlatform()),
  }
  if (field.options) {
    return (
      <Select
        {...frame}
        className={FIELD_MONO}
        options={field.options.map((option) => ({ ...option }))}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  return (
    <InputGroup
      {...frame}
      type={isPresetSecret(field) ? 'password' : 'text'}
      className={isPresetSecret(field) ? undefined : FIELD_MONO}
      autoComplete="off"
      spellCheck={false}
      {...(field.placeholder !== undefined && { placeholder: field.placeholder })}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
