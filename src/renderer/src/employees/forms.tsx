import { Shuffle, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import { MISSING_FOLDER_LINE, type SkillRow } from '../../../shared/catalogue/skills'
import { pickDefaultProvider } from '../../../shared/domain/providers'
import {
  CAPABILITIES,
  type Capability,
  type Employee,
  type JobField,
  type Provider,
  type RoleTemplate,
} from '../../../shared/domain/staff'
import type { ProposalPatch, ProposedEmployee } from '../../../shared/hiring'
import type { ProviderPreflight } from '../../../shared/providers/preflight'
import { providerForModel } from '../../../shared/staff/models'
import { type ModelChoice, ModelPicker } from '../model-picker'
import { Button, Checkbox, cx, IconButton, InputGroup, Select, Textarea } from '../ui'
import { SidePanel } from './parts'

export interface RoleFields {
  name: string
  persona: string
  capabilities: Capability[]
  repoFilter: string[]
  /** The paths inside a repo everyone on the role works in; `[]` is all of them (T239). */
  areas: string[]
  mcpServers: string[]
  skills: string[]
}

/**
 * The Name input with a shuffle button that asks `suggest` (the engine's name generator) for a free
 * name. With `prefill`, an empty name is filled once on mount.
 */
export function NameField(props: {
  value: string
  onChange(name: string): void
  suggest(): Promise<string | null>
  prefill?: boolean
}) {
  const { value, onChange, suggest, prefill } = props
  const shuffle = async () => {
    const name = await suggest()
    if (name) onChange(name)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount, per the comment below: a name the boss cleared stays cleared.
  useEffect(() => {
    if (prefill && !value) void shuffle()
    // Only on mount: a name the boss cleared stays cleared.
  }, [])
  return (
    <div className="flex items-start gap-8 [&_[data-slot=field]]:min-w-0 [&_[data-slot=field]]:flex-1">
      <InputGroup label="Name" autoFocus value={value} onChange={(e) => onChange(e.target.value)} />
      <IconButton
        icon={Shuffle}
        label="Suggest another name"
        className="mt-22 shrink-0"
        onClick={() => void shuffle()}
      />
    </div>
  )
}

/** Edit the Employee a pending hire proposes, before approving it. */
export function ProposalForm(props: {
  proposal: ProposedEmployee
  roles: RoleTemplate[]
  error: string | null
  /** Every Provider's cached preflight answer, for the model picker; null until it is read. */
  preflight?: readonly ProviderPreflight[] | null
  suggestName(): Promise<string | null>
  onSave(patch: ProposalPatch): void
  onCancel(): void
}) {
  const { proposal, roles } = props
  const [name, setName] = useState(proposal.name)
  const [roleId, setRoleId] = useState(proposal.roleId)
  const [model, setModel] = useState<string | null>(proposal.model)
  // A proposal stores a model and no Provider: the Provider is the one that owns the model, and it
  // is written onto the Employee when they are hired. A proposal with no model at all — HR left it
  // out, so the hire runs on the product's own default — shows the Provider this Mac is ready for
  // (T169), which is the one the engine would hire them onto.
  const [provider, setProvider] = useState<Provider>(
    providerForModel(proposal.model) ?? pickDefaultProvider(props.preflight ?? null),
  )
  const [job, setJob] = useState(() => jobFields(proposal))

  function pickModel(choice: ModelChoice) {
    setProvider(choice.provider)
    setModel(choice.model)
  }

  function pickRole(id: string) {
    setRoleId(id)
    setJob(jobFields(roles.find((r) => r.id === id)))
  }

  return (
    <PanelForm
      title={`Edit ${proposal.name}`}
      sub="Approving hires the Employee as edited here"
      submit="Save proposal"
      error={props.error}
      onCancel={props.onCancel}
      onSubmit={() =>
        props.onSave({
          name,
          roleId,
          model,
          persona: job.persona,
          capabilities: job.capabilities,
          repoFilter: parseRepoFilter(job.repoFilter),
          areas: parseRepoFilter(job.areas),
        })
      }
    >
      <NameField value={name} onChange={setName} suggest={props.suggestName} />
      <Select
        label="Role"
        value={roleId}
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
        onChange={(e) => pickRole(e.target.value)}
      />
      <ModelPicker
        value={model}
        provider={provider}
        preflight={props.preflight ?? null}
        who={name}
        onChange={pickModel}
      />
      <JobFields value={job} onChange={setJob} />
    </PanelForm>
  )
}

/** Create or edit a role template. */
export function RoleForm(props: {
  title: string
  role?: RoleTemplate
  /** Prefills a new role from the template the New role dialog picked (T240). */
  initial?: RoleFields
  error: string | null
  onSave(fields: RoleFields): void
  onCancel(): void
  /** Opens the delete form. Left out while the role is being created. */
  onDelete?: (() => void) | undefined
  /** Who is on the role, as one line; null when nobody is (T240). */
  holders?: string | null
  /** The Company's MCP catalogue: a role hands its servers to everyone hired into it (T136). */
  servers?: McpServerRow[] | undefined
  /** The Company's skill catalogue: a role hands its skills the same way (T137). */
  skills?: SkillRow[] | undefined
}) {
  const [name, setName] = useState(props.initial?.name ?? props.role?.name ?? '')
  const [job, setJob] = useState(() => jobFields(props.initial ?? props.role))
  return (
    <PanelForm
      title={props.title}
      sub="Every Employee on this role follows these fields unless they override them"
      submit="Save"
      error={props.error}
      onCancel={props.onCancel}
      onSubmit={() =>
        props.onSave({
          name,
          ...parseJob(job),
        })
      }
    >
      <InputGroup label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <JobFields value={job} onChange={setJob} servers={props.servers} skills={props.skills} />
      {props.onDelete && (
        <div className={DANGER}>
          {/* The rule up front, so pressing Delete is never a surprise: a role Employees hold
              cannot simply go, and the form that opens is where they are moved (T240). */}
          <p className="m-0 font-normal text-11-5/17 text-status-error-foreground">
            {props.holders
              ? `${props.holders} Deleting this role asks you where they go first.`
              : 'Nobody is on this role, so deleting it takes nothing with it.'}
          </p>
          <Button variant="destructive" icon={Trash2} className="w-full" onClick={props.onDelete}>
            Delete role
          </Button>
        </div>
      )}
    </PanelForm>
  )
}

/**
 * Delete a role after the boss confirms, moving whoever is on it to another role first (T240).
 *
 * The engine refuses a delete that would leave an Employee pointing at nothing, so this form is
 * where that refusal is answered: with holders it will not submit until a role is picked, and the
 * move is a role change like any other — desks, characters, Sessions and overrides stay put.
 */
export function DeleteRoleForm(props: {
  role: RoleTemplate
  /** Who is on the role and why it cannot just go; null when nobody is. */
  blocker: string | null
  /** The Company's other roles, to move them to. */
  others: RoleTemplate[]
  error: string | null
  onDelete(options: { reassignTo?: string }): void
  onCancel(): void
}) {
  const [reassignTo, setReassignTo] = useState(props.others[0]?.id ?? '')
  const blocked = props.blocker !== null
  return (
    <PanelForm
      title={`Delete ${props.role.name}`}
      sub={props.role.seeded ? 'A built-in role' : 'A role you wrote'}
      submit={blocked ? `Move them and delete ${props.role.name}` : `Delete ${props.role.name}`}
      destructive
      error={props.error}
      onCancel={props.onCancel}
      onSubmit={() => props.onDelete(blocked && reassignTo ? { reassignTo } : {})}
    >
      <p className={EFFECT}>{props.blocker ?? 'Nobody is on this role. Deleting it takes nothing with it.'}</p>
      {blocked &&
        (props.others.length === 0 ? (
          <p className={ERROR} role="alert">
            There is no other role to move them to. Make one first.
          </p>
        ) : (
          <Select
            label="Move them to"
            autoFocus
            value={reassignTo}
            options={props.others.map((role) => ({ value: role.id, label: role.name }))}
            onChange={(event) => setReassignTo(event.target.value)}
          />
        ))}
    </PanelForm>
  )
}

/** Fire an Employee after the boss confirms, with an optional reason for #general. */
export function FireForm(props: {
  employee: Employee
  error: string | null
  onFire(reason: string): void
  onCancel(): void
}) {
  const [reason, setReason] = useState('')
  return (
    <PanelForm
      title={`Fire ${props.employee.name}`}
      sub={props.employee.title}
      submit={`Fire ${props.employee.name}`}
      destructive
      error={props.error}
      onCancel={props.onCancel}
      onSubmit={() => props.onFire(reason.trim())}
    >
      <p className={EFFECT}>
        Their Session stops and their desk is freed; their memory is kept, so they can be rehired.
      </p>
      <Textarea
        label="Reason (optional)"
        helper="Posted in #general."
        autoFocus
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </PanelForm>
  )
}

function PanelForm(props: {
  title: string
  sub: string
  submit: string
  destructive?: boolean
  error: string | null
  onSubmit(): void
  onCancel(): void
  children: ReactNode
}) {
  const formId = `emp-form-${props.title.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <SidePanel
      label={props.title}
      title={props.title}
      sub={props.sub}
      footer={
        <>
          <Button variant="outline" className="flex-1 basis-0" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={props.destructive ? 'destructive' : 'primary'}
            className="flex-1 basis-0"
          >
            {props.submit}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-8 [&_[data-slot=field]]:flex-none"
        onSubmit={(event) => {
          event.preventDefault()
          props.onSubmit()
        }}
      >
        {props.children}
        {props.error && (
          <p className={ERROR} role="alert">
            {props.error}
          </p>
        )}
      </form>
    </SidePanel>
  )
}

interface Job {
  persona: string
  capabilities: Capability[]
  /** Comma-separated, as typed. */
  repoFilter: string
  /** Comma-separated, as typed. */
  areas: string
  mcpServers: string[]
  skills: string[]
}

/** A proposal carries no MCP grants: no MCP tool gives one, so a hire takes the role's (T136). */
function jobFields(source?: Partial<Pick<RoleTemplate, JobField>>): Job {
  return {
    persona: source?.persona ?? '',
    capabilities: source?.capabilities ?? [],
    repoFilter: source?.repoFilter?.join(', ') ?? '',
    areas: source?.areas?.join(', ') ?? '',
    mcpServers: source?.mcpServers ?? [],
    skills: source?.skills ?? [],
  }
}

function parseJob(job: Job): Pick<RoleTemplate, JobField> {
  return {
    persona: job.persona,
    capabilities: job.capabilities,
    repoFilter: parseRepoFilter(job.repoFilter),
    areas: parseRepoFilter(job.areas),
    mcpServers: job.mcpServers,
    skills: job.skills,
  }
}

/** Comma-separated patterns or paths, as typed: trimmed, blanks dropped. */
function parseRepoFilter(text: string): string[] {
  return text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}

function JobFields({
  value,
  onChange,
  servers = [],
  skills = [],
}: {
  value: Job
  onChange(job: Job): void
  /** The Company's MCP catalogue; with none, the chip row says so and hands out nothing (T136). */
  servers?: McpServerRow[] | undefined
  /** The Company's skill catalogue; with none, the chip row says so and hands out nothing (T137). */
  skills?: SkillRow[] | undefined
}) {
  function toggle(capability: Capability, on: boolean) {
    const capabilities = on
      ? CAPABILITIES.filter((c) => c === capability || value.capabilities.includes(c))
      : value.capabilities.filter((c) => c !== capability)
    onChange({ ...value, capabilities })
  }

  return (
    <>
      <Textarea
        label="Persona"
        rows={4}
        value={value.persona}
        onChange={(e) => onChange({ ...value, persona: e.target.value })}
      />
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Capabilities</legend>
        <div className="flex flex-wrap gap-x-16 gap-y-10">
          {CAPABILITIES.map((capability) => (
            <Checkbox
              key={capability}
              label={capability}
              checked={value.capabilities.includes(capability)}
              onChange={(e) => toggle(capability, e.target.checked)}
            />
          ))}
        </div>
      </fieldset>
      <InputGroup
        label="Repo filter"
        helper="* for every repo, e.g. *web*, acme-api"
        value={value.repoFilter}
        onChange={(e) => onChange({ ...value, repoFilter: e.target.value })}
      />
      {/* AREAS (T239): the paths inside a repo, which is how a monorepo tells two engineers apart. */}
      <InputGroup
        label="Areas"
        helper="Paths inside a repo, e.g. src/renderer/**. Empty is the whole repo."
        value={value.areas}
        onChange={(e) => onChange({ ...value, areas: e.target.value })}
      />
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>MCP servers</legend>
        <McpGrantChips
          servers={servers}
          value={value.mcpServers}
          onChange={(mcpServers) => onChange({ ...value, mcpServers })}
        />
      </fieldset>
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Skills</legend>
        <SkillGrantChips
          skills={skills}
          value={value.skills}
          onChange={(granted) => onChange({ ...value, skills: granted })}
        />
      </fieldset>
    </>
  )
}

/**
 * The MCP servers of the Company's catalogue, as a chip row the boss turns on and off (T136,
 * frame `uApL8`). Nothing here can invent a server: the catalogue is Company settings' own, and an
 * Employee is handed exactly the chips that are on.
 */
export function McpGrantChips({
  servers,
  value,
  onChange,
}: {
  servers: McpServerRow[]
  value: string[]
  onChange(ids: string[]): void
}) {
  if (servers.length === 0) {
    return <p className={EFFECT}>No MCP servers yet — add them in Company settings → Integrations.</p>
  }
  return (
    <div className="flex flex-wrap gap-8">
      {servers.map((server) => {
        const on = value.includes(server.id)
        return (
          <button
            key={server.id}
            type="button"
            role="switch"
            aria-checked={on}
            className={cx(GRANT, on ? GRANT_ON : GRANT_OFF)}
            onClick={() =>
              onChange(servers.filter((s) => (s.id === server.id ? !on : value.includes(s.id))).map((s) => s.id))
            }
          >
            <span className={GRANT_NAME}>{server.name}</span>
            <span className={GRANT_NOTE}>{server.transport}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The skill folders of the Company's catalogue, as a chip row the boss turns on and off (T137,
 * frame `uApL8`). Nothing here can invent a skill, and a folder that is not where the boss left it
 * says so on its chip rather than being handed out quietly.
 */
export function SkillGrantChips({
  skills,
  value,
  onChange,
}: {
  skills: SkillRow[]
  value: string[]
  onChange(ids: string[]): void
}) {
  if (skills.length === 0) {
    return <p className={EFFECT}>No skills yet — add a folder in Company settings → Integrations.</p>
  }
  return (
    <div className="flex flex-wrap gap-8">
      {skills.map((skill) => {
        const on = value.includes(skill.id)
        return (
          <button
            key={skill.id}
            type="button"
            role="switch"
            aria-checked={on}
            className={cx(GRANT, on ? GRANT_ON : GRANT_OFF)}
            onClick={() =>
              onChange(skills.filter((s) => (s.id === skill.id ? !on : value.includes(s.id))).map((s) => s.id))
            }
          >
            <span className={GRANT_NAME}>{skill.name}</span>
            {/* A skill whose folder has moved still turns on — the boss may be about to put it back
                — and says what is wrong with it rather than being handed out quietly (T137). */}
            {skill.missing && <span className={GRANT_MISSING}>{MISSING_FOLDER_LINE}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The forms in the Employees side panel (T210f). */
const EFFECT = 'm-0 font-normal text-11-5/17 text-muted-foreground'

/** Inside the form's gapped column, the error needs no margin of its own. */
const ERROR = 'm-0 text-12/normal text-status-error-foreground'

const FIELDSET = 'mt-0 mr-0 mb-12 ml-0 flex flex-col gap-10 border-0 p-0'

/** The delete box at the foot of the role editor (frame `g0D3Ua`). */
const DANGER = 'flex flex-col gap-9 rounded-md border border-danger-edge bg-status-error p-12'

const LEGEND = 'mb-10 p-0 font-semibold text-13/normal text-foreground'

/** One thing the Company can hand out, as a switch the boss turns on and off (T136, T137). */
const GRANT = 'flex cursor-pointer items-center gap-6 rounded-full border px-10 py-5 [font:inherit] text-foreground'

const GRANT_OFF = 'border-border bg-transparent'

const GRANT_ON = 'border-primary bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]'

const GRANT_NAME = 'font-code font-semibold text-11-5/normal'

const GRANT_NOTE = 'text-10-5/normal text-muted-foreground'

const GRANT_MISSING = 'text-10-5/normal text-status-warning-foreground'
