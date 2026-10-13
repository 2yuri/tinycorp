import { BookOpen, Info, Plug, UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../shared/catalogue/skills'
import { pickDefaultProvider } from '../../../shared/domain/providers'
import {
  type Employee,
  type EmployeeInput,
  PERMISSION_HIRE_HELP,
  type PermissionMode,
  type RoleTemplate,
  shutOutOfEveryRepo,
} from '../../../shared/domain/staff'
import type { Headcount } from '../../../shared/hiring'
import { leastUsedSheet } from '../../../shared/office/characters'
import type { ProviderPreflight } from '../../../shared/providers/preflight'
import { ModelPicker } from '../model-picker'
import { cx } from '../ui'
import {
  canHire,
  draftForRole,
  type HireDraft,
  hireInput,
  nextDesk,
  openOn,
  seatLine,
  shownPermission,
  walkInNote,
} from './hire-model'
import { LookField, rollLook } from './LookField'
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
  IDENTITY,
  LABEL,
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
} from './modal-fields'
import '../ui/tailwind.css'

export interface HireEmployeeModalProps {
  companyName: string
  roles: RoleTemplate[]
  /** Everyone on staff: their names are taken, and their desks decide which one the hire gets. */
  employees: Employee[]
  /** Fired Employees keep their desk, so they count too. */
  former: Employee[]
  repoNames: string[]
  /** The Company's MCP catalogue; the hire walks in holding the chips that are on (T136). */
  servers?: McpServerRow[] | undefined
  /** The Company's skill catalogue; the same, for folders of instructions (T137). */
  skills?: SkillRow[] | undefined
  headcount: Headcount | null
  error: string | null
  /** The engine's name generator; it also fills the empty name once the modal opens. */
  suggestName(): Promise<string | null>
  onCancel(): void
  onHire(input: EmployeeInput): void
  /** Overrides the character the tile opens on; by default the office's least-used sheet. */
  initialSprite?: number
  /** The role the modal opens on, as `/hire <role>` names one; by default the catalog's first. */
  initialRoleId?: string | undefined
  /**
   * A role to move the draft onto once it exists: the one the New role dialog just made over this
   * modal (T240). Everything else the boss has typed stays where it is.
   */
  selectRoleId?: string | null | undefined
  /** Opens the New role dialog over this modal; left out, the ROLE field offers no such chip. */
  onNewRole?: (() => void) | undefined
  /**
   * Set aside while the role editor is open beside it (T262): still mounted, so the draft is
   * exactly as the boss left it when they come back, but not drawn and not listening for Escape.
   */
  hidden?: boolean
  /** Every Provider's cached preflight answer, for the model picker; null until it is read. */
  preflight?: readonly ProviderPreflight[] | null
  /**
   * The Company's default permission mode, which the PERMISSIONS field opens on (T164). Null until
   * the engine has answered; the field then moves onto it as long as the boss has not chosen.
   */
  permissionDefault?: PermissionMode | null
}

/**
 * Hire Employee, the design's 660px modal (design/html/hire-employee.html, frame `zf2Ks`): the role
 * chip grid, the LOOK tile, name and model side by side, the PERMISSIONS chips, persona, repository
 * chips and the `Hire <name>` footer. Capabilities and provider come from the role and stay editable
 * on the Employee (design-gaps: fields the design leaves out on purpose).
 */
export function HireEmployeeModal(props: HireEmployeeModalProps) {
  const { roles, repoNames } = props
  const wanted = props.initialRoleId
  // What a hire starts on, read off this Mac rather than off the catalogue (T169).
  const defaultProvider = pickDefaultProvider(props.preflight ?? null)
  const [draft, setDraft] = useState<HireDraft>(() => {
    const sprite = props.initialSprite ?? leastUsedSheet(props.employees.map((employee) => employee.sprite))
    return draftForRole(openOn(roles, wanted), { name: '', model: null, sprite }, defaultProvider)
  })
  const edit = (patch: Partial<HireDraft>) => setDraft((current) => ({ ...current, ...patch }))
  /** The role being hired into, for what only the role knows: whether this hire writes code (T239). */
  const hiringInto = roles.find((r) => r.id === draft.roleId)
  // The preflight answers can land after the modal has opened. Until the boss has touched MODEL the
  // field is only showing a default, so it moves onto the one the machine turned out to be ready
  // for; once they have chosen, nothing moves under them.
  // Adjusted while rendering rather than after it, so the field is never drawn on a Provider this
  // Mac cannot run and then swapped under the boss a frame later (T211).
  const chosen = useRef(false)
  if (!chosen.current && draft.provider !== defaultProvider) {
    setDraft((current) => ({ ...current, provider: defaultProvider }))
  }

  // The catalog arrives after the first render; the modal opens on the role it was asked for.
  useEffect(() => {
    const role = openOn(roles, wanted)
    if (draft.roleId === '' && role) {
      setDraft((current) => draftForRole(role, current, defaultProvider))
    }
  }, [roles, wanted, draft.roleId, defaultProvider])

  // A role created over this modal is what the boss meant to hire into, so the draft moves onto it.
  const selectRoleId = props.selectRoleId ?? null
  useEffect(() => {
    if (selectRoleId === null) return
    const role = roles.find((candidate) => candidate.id === selectRoleId)
    if (role)
      setDraft((current) => (current.roleId === role.id ? current : draftForRole(role, current, defaultProvider)))
  }, [selectRoleId, roles, defaultProvider])

  useEffect(() => {
    if (props.hidden) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])

  const suggest = async (reroll: boolean) => {
    const name = await props.suggestName()
    setDraft((current) => ({
      ...current,
      ...(name !== null && { name }),
      // The shuffle control rerolls the look with the name, so one press gives a whole new colleague.
      ...(reroll && { sprite: rollLook(current.sprite) }),
    }))
  }

  // Fills the name once, the moment the modal opens; a name the boss clears stays cleared.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fills the name once as the modal opens, per the comment above.
  useEffect(() => {
    void suggest(false)
  }, [])

  const name = draft.name.trim()
  const ready = canHire(draft, props.employees)

  return createPortal(
    <div
      data-ui="Modal Overlay"
      className={cx(OVERLAY, props.hidden && 'hidden')}
      onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}
    >
      <form
        className={MODAL}
        role="dialog"
        aria-modal="true"
        aria-label="Hire an employee"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) props.onHire(hireInput(draft))
        }}
      >
        <header className={HEADER}>
          <div className={HEADER_TEXT}>
            <div data-ui="Modal Title" className={TITLE}>
              Hire an employee
            </div>
            <div data-ui="Modal Subtitle" className={SUBTITLE}>
              {seatLine(props.companyName, props.headcount)}
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
            onNewRole={props.onNewRole}
            onChange={(role) => setDraft((current) => draftForRole(role, current, defaultProvider))}
          />

          <div className={IDENTITY}>
            <LookField value={draft.sprite} onChange={(sprite) => edit({ sprite })} />

            <div className={FIELDS}>
              <NameInput
                value={draft.name}
                autoFocus
                shuffleLabel="Suggest another name and look"
                onChange={(next) => edit({ name: next })}
                onShuffle={() => void suggest(true)}
              />

              <ModelPicker
                value={draft.model}
                provider={draft.provider}
                preflight={props.preflight ?? null}
                who={draft.name}
                onChange={(choice) => {
                  chosen.current = true
                  edit({ provider: choice.provider, model: choice.model })
                }}
              />
            </div>
          </div>

          {/* PERMISSIONS sits between MODEL and PERSONA, as frame `PGtFO` puts it. */}
          <PermissionField
            id="hire-permissions"
            value={shownPermission(draft, props.permissionDefault ?? null)}
            help={PERMISSION_HIRE_HELP}
            onChange={(permissionMode) => edit({ permissionMode })}
          />

          <label className={FIELD}>
            <span className={LABEL}>PERSONA</span>
            <textarea
              className={TEXTAREA}
              value={draft.persona}
              onChange={(event) => edit({ persona: event.target.value })}
            />
          </label>

          <RepoAccess
            value={draft.repoFilter}
            repoNames={repoNames}
            shutOut={
              shutOutOfEveryRepo(
                { capabilities: hiringInto?.capabilities ?? [], repoFilter: draft.repoFilter },
                repoNames,
              )
                ? draft.name.trim() || 'This hire'
                : null
            }
            onChange={(repoFilter) => edit({ repoFilter })}
          />

          {/* AREAS under REPOSITORY ACCESS: which repos, then which paths inside them (T239). */}
          <AreasField value={draft.areas} onChange={(areas) => edit({ areas })} />

          {(props.servers ?? []).length > 0 && (
            <GrantChips
              label="MCP SERVERS"
              icon={Plug}
              items={(props.servers ?? []).map((server) => ({ id: server.id, label: server.name }))}
              value={draft.mcpServers}
              onChange={(mcpServers) => edit({ mcpServers })}
            />
          )}

          {(props.skills ?? []).length > 0 && (
            <GrantChips
              label="SKILLS"
              icon={BookOpen}
              items={skillChips(props.skills ?? [])}
              value={draft.skills}
              onChange={(skills) => edit({ skills })}
            />
          )}

          {props.error && (
            <p className={ERROR} role="alert">
              {props.error}
            </p>
          )}
          <div data-ui="Divider" className={DIVIDER} />
        </div>

        <footer className={FOOTER}>
          <span className={NOTE}>
            <Info size={14} aria-hidden />
            <span data-ui="Modal Note" className={NOTE_TEXT}>
              {walkInNote(name, nextDesk(props.employees, props.former))}
            </span>
          </span>
          <button type="button" className={CANCEL} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className={SUBMIT} disabled={!ready}>
            <UserPlus size={15} aria-hidden />
            {name ? `Hire ${name}` : 'Hire'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
