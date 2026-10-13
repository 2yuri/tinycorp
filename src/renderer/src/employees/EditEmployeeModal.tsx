import { Info, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../shared/catalogue/skills'
import { PROVIDER_LABEL, PROVIDER_SKILLS_FOLDER } from '../../../shared/domain/providers'
import {
  type Employee,
  type EmployeePatch,
  type JobField,
  PERMISSION_HELP,
  type RoleTemplate,
  shutOutOfEveryRepo,
} from '../../../shared/domain/staff'
import type { ProviderPreflight } from '../../../shared/providers/preflight'
import {
  AreasField,
  CANCEL,
  CLOSE,
  DIVIDER,
  ERROR,
  FIELD,
  FIELDS,
  FOOTER,
  FORM,
  GrantChips,
  HEADER,
  HEADER_TEXT,
  HELP,
  IDENTITY,
  LABEL,
  LABEL_ROW,
  LookField,
  MODAL,
  NameInput,
  NOTE,
  NOTE_TEXT,
  OVERLAY,
  PermissionField,
  RepoAccess,
  RoleGrid,
  SUBMIT,
  SUBTITLE,
  skillChips,
  TEXTAREA,
  TITLE,
} from '../hiring'
import { ModelPicker } from '../model-picker'
import { Badge } from '../ui'
import '../ui/tailwind.css'
import {
  canSave,
  capabilityChips,
  draftForEmployee,
  draftOverrides,
  type EditDraft,
  editPatch,
  givenName,
  grantLine,
  heldFirst,
  integrationChips,
  saveNote,
  serverNames,
  skillNames,
  skillsLine,
  toCapabilities,
  whoLine,
  withFollowRole,
  withJobEdit,
  withRole,
} from './edit-model'

const JOB_FIELD_LABEL: Record<JobField, string> = {
  persona: 'Persona',
  capabilities: 'Capabilities',
  repoFilter: 'Repository access',
  areas: 'Areas',
  mcpServers: 'Integrations',
  skills: 'Skills',
}

export interface EditEmployeeModalProps {
  companyName: string
  employee: Employee
  roles: RoleTemplate[]
  /** Everyone on staff: their names are taken, so Save refuses one that is already someone's. */
  employees: Employee[]
  repoNames: string[]
  /** The Company's MCP catalogue, for the INTEGRATIONS row (T136). */
  servers?: McpServerRow[] | undefined
  /** The Company's skill catalogue, for the SKILLS row (T137). */
  skills?: SkillRow[] | undefined
  error: string | null
  /** The engine's name generator, behind the shuffle. */
  suggestName?(): Promise<string | null>
  /** Every Provider's cached preflight answer, for the model picker; null until it is read. */
  preflight?: readonly ProviderPreflight[] | null
  onCancel(): void
  onSave(patch: EmployeePatch): void
}

/**
 * Edit Employee, the design's 660×840 modal (frame `FbR2n`): one screen for everything an Employee
 * is — its role, its look, its name, its model, its persona, its repositories, its integrations and
 * its capabilities. The header and footer stand still and the body between them scrolls, the way
 * the ticket drawer does it; `⌘↵` saves and `Escape` closes.
 *
 * The role is a control here, not a label. Picking another one moves every job field the Employee
 * was following onto it and leaves the ones it made its own alone — and says which is which in the
 * override marker before Save, because the boss should not have to save to find out what moved.
 * Nothing else about the Employee changes: not its desk, not its Sessions, not its tickets.
 */
export function EditEmployeeModal(props: EditEmployeeModalProps) {
  const { employee, roles, repoNames } = props
  const servers = props.servers ?? []
  const skills = props.skills ?? []
  const [draft, setDraft] = useState<EditDraft>(() => draftForEmployee(employee))
  const edit = (patch: Partial<EditDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const role = roles.find((r) => r.id === draft.roleId)
  const overridden = draftOverrides({ role, employee, draft })
  const ready = canSave(draft, employee, props.employees)
  const who = givenName(draft.name)

  const submit = () => {
    if (ready) props.onSave(editPatch(draft))
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onCancel()
      // ⌘↵ saves from anywhere in the body, including the persona textarea, where ↵ is a newline.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        submit()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const suggest = async () => {
    const name = await props.suggestName?.()
    if (name) edit({ name })
  }

  /**
   * What editing adds to the hire modal's anatomy (frame `FbR2n`): the frame's 840px height, and the
   * marker a field carries when its value is the Employee's own rather than its role's (T210f).
   */
  const RESET =
    'cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-semibold text-11 text-muted-foreground underline underline-offset-2 hover:text-foreground'

  /** The override marker a job field carries when it is the Employee's own, with its reset. */
  function marker(field: JobField) {
    if (!overridden.includes(field) || !role) return undefined
    return (
      <span data-ui="Override" className="inline-flex items-center gap-8">
        <Badge variant="warning">overridden</Badge>
        <button
          type="button"
          className={RESET}
          aria-label={`${JOB_FIELD_LABEL[field]}: follow role`}
          onClick={() => setDraft((current) => withFollowRole(current, role, field))}
        >
          Follow role
        </button>
      </span>
    )
  }

  return createPortal(
    <div
      data-ui="Modal Overlay"
      className={OVERLAY}
      onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}
    >
      <form
        className={MODAL}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${employee.name}`}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <header className={HEADER}>
          <div className={HEADER_TEXT}>
            <div data-ui="Modal Title" className={TITLE}>
              Edit {employee.name}
            </div>
            <div data-ui="Modal Subtitle" className={SUBTITLE}>
              {whoLine(props.companyName, employee, role)}
            </div>
          </div>
          <button type="button" className={CLOSE} aria-label="Close" onClick={props.onCancel}>
            <X size={17} aria-hidden />
          </button>
        </header>

        <div data-ui="Modal Form" className={FORM}>
          <RoleGrid
            roles={roles}
            value={draft.roleId}
            onChange={(picked) => setDraft((current) => withRole(current, picked, overridden))}
          />

          <div className={IDENTITY}>
            <LookField value={draft.sprite} onChange={(sprite) => edit({ sprite })} />

            <div className={FIELDS}>
              <NameInput
                value={draft.name}
                onChange={(name) => edit({ name })}
                onShuffle={props.suggestName && (() => void suggest())}
              />

              <ModelPicker
                value={draft.model}
                provider={draft.provider}
                preflight={props.preflight ?? null}
                who={who}
                onChange={(choice) => edit({ provider: choice.provider, model: choice.model })}
              />
            </div>
          </div>

          {/* PERMISSIONS sits between MODEL and PERSONA, as frame `XJxrZ` puts it. */}
          <PermissionField
            id="edit-permissions"
            value={draft.permissionMode}
            help={PERMISSION_HELP[draft.permissionMode]}
            onChange={(permissionMode) => edit({ permissionMode })}
          />

          <label data-ui="Field" className={FIELD}>
            <span className={LABEL_ROW}>
              <span data-ui="Field Label" className={LABEL}>
                PERSONA
              </span>
              {marker('persona')}
            </span>
            <textarea
              className={TEXTAREA}
              value={draft.persona}
              onChange={(event) => setDraft((current) => withJobEdit(current, 'persona', event.target.value))}
            />
          </label>

          <RepoAccess
            value={draft.repoFilter}
            repoNames={repoNames}
            marker={marker('repoFilter')}
            shutOut={
              shutOutOfEveryRepo({ capabilities: draft.capabilities, repoFilter: draft.repoFilter }, repoNames)
                ? who
                : null
            }
            onChange={(repoFilter) => setDraft((current) => withJobEdit(current, 'repoFilter', repoFilter))}
          />

          {/* AREAS under REPOSITORY ACCESS: which repos, then which paths inside them (T239). */}
          <AreasField
            value={draft.areas}
            marker={marker('areas')}
            onChange={(areas) => setDraft((current) => withJobEdit(current, 'areas', areas))}
          />

          <div data-ui="Divider" className={DIVIDER} />

          <GrantChips
            label="INTEGRATIONS"
            items={heldFirst(integrationChips(servers), employee.mcpServers)}
            value={draft.mcpServers}
            marker={marker('mcpServers')}
            empty={
              <p data-ui="Field Help" className={HELP}>
                No MCP servers yet — add them in Company settings → Integrations.
              </p>
            }
            line={
              servers.length === 0
                ? undefined
                : `The MCP servers this Employee is handed. ${grantLine({
                    who,
                    fromRole: serverNames(servers, role?.mcpServers ?? []),
                    on: serverNames(servers, draft.mcpServers),
                  })}`
            }
            onChange={(mcpServers) => setDraft((current) => withJobEdit(current, 'mcpServers', mcpServers))}
          />

          {/*
            SKILLS is the INTEGRATIONS row again over another catalogue (T137): the same chips, the
            same override marker, the same generated grant line. A folder that is not where the boss
            left it says so on its own chip — the grant stands, and the Employee starts without it.
          */}
          <GrantChips
            label="SKILLS"
            items={heldFirst(skillChips(skills), employee.skills)}
            value={draft.skills}
            marker={marker('skills')}
            empty={
              <p data-ui="Field Help" className={HELP}>
                No skills yet — add a folder in Company settings → Integrations.
              </p>
            }
            line={
              skills.length === 0
                ? undefined
                : skillsLine({
                    who,
                    fromRole: skillNames(skills, role?.skills ?? []),
                    on: skillNames(skills, draft.skills),
                    providerLabel: PROVIDER_LABEL[draft.provider],
                    providerReadsSkills: PROVIDER_SKILLS_FOLDER[draft.provider] !== null,
                  })
            }
            onChange={(granted) => setDraft((current) => withJobEdit(current, 'skills', granted))}
          />

          <GrantChips
            label="CAPABILITIES"
            items={heldFirst(capabilityChips(), employee.capabilities)}
            value={draft.capabilities}
            marker={marker('capabilities')}
            onChange={(ids) => setDraft((current) => withJobEdit(current, 'capabilities', toCapabilities(ids)))}
          />

          {props.error && (
            <p className={ERROR} role="alert">
              {props.error}
            </p>
          )}
        </div>

        <footer className={FOOTER}>
          <span className={NOTE}>
            <Info size={14} aria-hidden />
            <span data-ui="Modal Note" className={NOTE_TEXT}>
              {saveNote(who)}
            </span>
          </span>
          <button type="button" className={CANCEL} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className={SUBMIT} disabled={!ready}>
            <Save size={15} aria-hidden />
            Save changes
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
