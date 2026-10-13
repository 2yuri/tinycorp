import { UsersRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Company } from '../../../shared/company'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { pickDefaultProvider } from '../../../shared/domain/providers'
import type { Result } from '../../../shared/domain/result'
import { type Employee, type RoleTemplate, shutOutLine, shutOutOfEveryRepo } from '../../../shared/domain/staff'
import { sandboxUnjailed } from '../../../shared/sandbox'
import type { Route } from '../chrome'
import { EmployeeDrawer } from '../employee-drawer'
import { HireEmployeeModal, onOpenHire } from '../hiring'
import { resources, useIpcResource } from '../ipc'
import { useOfficeScene } from '../office'
import { useEveryProvider } from '../preflight'
import { useSessionStatuses } from '../sessions'
import { Button, EmptyState } from '../ui'
import { EditEmployeeModal } from './EditEmployeeModal'
import { DeleteRoleForm, FireForm, ProposalForm, type RoleFields, RoleForm } from './forms'
import {
  autonomyLine,
  cardState,
  effectText,
  filterEmployees,
  headcountNotice,
  pendingHireProposal,
  repoChips,
  teamLoadRows,
} from './model'
import { NewRoleDialog } from './NewRoleDialog'
import { EmployeeCard, EmployeesHeader, HireProposalPanel, SidePanel } from './parts'
import { RolesPanel } from './RolesPanel'
import { deleteBlocker, fieldsForChoice, type RoleChoice, roleChoices, roleRows } from './roles-model'
import { useEmployeesData, useMcpServers, usePermissionDefault, useSkills, useStaffData } from './use-employees-data'

type Editing =
  /** `newRole` is the blank role being written beside a hire that is set aside meanwhile (T262). */
  | { kind: 'hire'; roleId?: string; newRole?: RoleFields }
  | { kind: 'employee'; employee: Employee }
  | { kind: 'fire'; employee: Employee }
  | { kind: 'roles' }
  | { kind: 'role'; role: RoleTemplate }
  | { kind: 'new-role'; fields: RoleFields; templateId: string | null }
  | { kind: 'delete-role'; role: RoleTemplate }
  | { kind: 'proposal'; requestId: number }
  | null

/**
 * The Employees view: header, the grid of Employee cards (filtered by the sidebar's role) and the
 * side panel, which shows the pending hire proposal unless a form is open. A card opens the Employee drawer.
 */
export function EmployeesView(props: {
  company: Company
  route: Extract<Route, { view: 'employees' }>
  onNavigate(route: Route): void
}) {
  const { company, route, onNavigate } = props
  const { roles, employees } = useStaffData()
  const data = useEmployeesData()
  const servers = useMcpServers()
  const skills = useSkills()
  const permissionDefault = usePermissionDefault()
  const sessions = useSessionStatuses(employees)
  // The boss turned the jail on and this machine cannot give it (T260): the drawer says so.
  const sandbox = useIpcResource(resources.sandbox)
  const scene = useOfficeScene(employees)
  // What every CLI on this Mac said when the app started (T135, T141), for the model picker and for
  // what a hire opens on (T169): read, never asked again. Every Provider and not only the ones this
  // Company is hired on — the picker lists them all, and a hire can start on any of them.
  const preflight = useEveryProvider()
  const [editing, setEditing] = useState<Editing>(null)
  // The New role dialog sits over whatever is open — the Roles panel, or the hire modal, whose
  // draft has to still be there when the boss comes back to it (T240).
  const [pickingRole, setPickingRole] = useState(false)
  const [hireRoleId, setHireRoleId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawerFor, setDrawerFor] = useState<string | null>(null)
  const closeDrawer = useCallback(() => setDrawerFor(null), [])
  const api = window.tinyCorp

  // The office header's Hire, the application menu's and `/hire <role>` all open the flow here.
  useEffect(
    () =>
      onOpenHire((request) =>
        setEditing({ kind: 'hire', ...(request.roleId !== undefined && { roleId: request.roleId }) }),
      ),
    [],
  )

  // The sidebar asks for a role editor through the route; open it once the catalog is here, then drop the ask.
  const editRole = route.editRole
  useEffect(() => {
    if (editRole === undefined) return
    if (editRole === 'roles' || editRole === 'new') {
      setError(null)
      setEditing({ kind: 'roles' })
      setPickingRole(editRole === 'new')
    } else {
      const role = roles.find((r) => r.id === editRole)
      if (!role) return
      setError(null)
      setEditing({ kind: 'role', role })
    }
    onNavigate({ view: 'employees', ...(route.roleId !== undefined && { roleId: route.roleId }) })
  }, [editRole, roles, route.roleId, onNavigate])

  const rows = roleRows(roles, employees, data.former)
  const roleId = roles.some((r) => r.id === route.roleId) ? route.roleId! : null
  const shown = filterEmployees(employees, roleId)
  const spriteState = useMemo(() => new Map(scene.sprites.map((s) => [s.employeeId, s.state])), [scene])

  async function run<T>(action: Promise<Result<T>>, close = true): Promise<boolean> {
    const result = await action
    setError(result.ok ? null : result.error)
    if (result.ok && close) setEditing(null)
    return result.ok
  }

  function open(next: Editing) {
    setError(null)
    setEditing(next)
  }

  const proposal = pendingHireProposal({
    approvals: data.approvals,
    requests: data.requests,
    roles,
    employees,
    former: data.former,
    defaultProvider: pickDefaultProvider(preflight),
  })

  /**
   * The New role dialog's Create: the role is made from the template there and then, so the hire
   * modal underneath can be pointed at it, and the editor opens on it unless a hire was waiting.
   */
  async function createRole(choice: RoleChoice): Promise<void> {
    const fields = fieldsForChoice(choice, roles)
    if (choice.templateId === null) {
      // A blank role has no name yet, so there is nothing to create: the editor is where it is written.
      // Over a hire, the hire steps aside for it and comes back when the editor closes (T262).
      setPickingRole(false)
      setError(null)
      setEditing(
        editing?.kind === 'hire' ? { ...editing, newRole: fields } : { kind: 'new-role', fields, templateId: null },
      )
      return
    }
    const result = await api.staff.createRole({ ...fields, templateId: choice.templateId })
    setError(result.ok ? null : result.error)
    if (!result.ok) return
    setPickingRole(false)
    if (editing?.kind === 'hire') setHireRoleId(result.value.id)
    else setEditing({ kind: 'role', role: result.value })
  }

  async function suggestName(): Promise<string | null> {
    const result = await api.hiring.suggestName()
    return result.ok ? result.value : null
  }

  const drawer = employees.find((e) => e.id === drawerFor)
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? id

  function panel() {
    if (editing?.kind === 'hire' && editing.newRole) {
      const { newRole, ...hire } = editing
      return (
        <RoleForm
          key="blank"
          title="New role"
          initial={newRole}
          error={error}
          servers={servers}
          skills={skills}
          onCancel={() => {
            setError(null)
            setEditing(hire)
          }}
          onSave={(saved) =>
            void api.staff.createRole(saved).then((result) => {
              setError(result.ok ? null : result.error)
              if (!result.ok) return
              setHireRoleId(result.value.id)
              setEditing(hire)
            })
          }
        />
      )
    }
    if (editing?.kind === 'fire') {
      const { employee } = editing
      return (
        <FireForm
          key={employee.id}
          employee={employee}
          error={error}
          onCancel={() => setEditing(null)}
          onFire={(reason) => void run(api.hiring.fire(employee.id, reason))}
        />
      )
    }
    if (editing?.kind === 'roles') {
      return (
        <RolesPanel
          rows={rows}
          error={error}
          onNew={() => {
            setError(null)
            setPickingRole(true)
          }}
          onEdit={(roleId) => {
            const role = roles.find((r) => r.id === roleId)
            if (role) open({ kind: 'role', role })
          }}
          onDelete={(roleId) => {
            const role = roles.find((r) => r.id === roleId)
            if (role) open({ kind: 'delete-role', role })
          }}
          onRemoveUnused={() => void run(api.staff.removeUnusedRoles(), false)}
        />
      )
    }
    if (editing?.kind === 'new-role') {
      const { fields, templateId } = editing
      return (
        <RoleForm
          key={templateId ?? 'blank'}
          title="New role"
          initial={fields}
          error={error}
          servers={servers}
          skills={skills}
          onCancel={() => open({ kind: 'roles' })}
          onSave={(saved) =>
            void run(api.staff.createRole({ ...saved, ...(templateId !== null && { templateId }) })).then((ok) => {
              if (ok) setEditing({ kind: 'roles' })
            })
          }
        />
      )
    }
    if (editing?.kind === 'role') {
      const { role } = editing
      const row = rows.find((candidate) => candidate.role.id === role.id)
      return (
        <RoleForm
          key={role.id}
          title={`Edit ${role.name}`}
          role={role}
          error={error}
          servers={servers}
          skills={skills}
          holders={row ? deleteBlocker(row) : null}
          onDelete={() => open({ kind: 'delete-role', role })}
          onCancel={() => setEditing(null)}
          onSave={(fields) => void run(api.staff.updateRole(role.id, fields))}
        />
      )
    }
    if (editing?.kind === 'delete-role') {
      const { role } = editing
      const row = rows.find((candidate) => candidate.role.id === role.id)
      return (
        <DeleteRoleForm
          key={role.id}
          role={role}
          blocker={row ? deleteBlocker(row) : null}
          others={roles.filter((candidate) => candidate.id !== role.id)}
          error={error}
          onCancel={() => open({ kind: 'roles' })}
          onDelete={(options) =>
            void run(api.staff.deleteRole(role.id, options)).then((ok) => {
              if (ok) setEditing({ kind: 'roles' })
            })
          }
        />
      )
    }
    if (editing?.kind === 'proposal') {
      const request = data.requests.find((r) => r.id === editing.requestId)
      if (request?.proposal && request.status === 'pending') {
        return (
          <ProposalForm
            key={request.id}
            proposal={request.proposal}
            roles={roles}
            error={error}
            preflight={preflight}
            suggestName={suggestName}
            onCancel={() => setEditing(null)}
            onSave={(patch) => void run(api.hiring.updateProposal(request.id, patch))}
          />
        )
      }
    }
    if (proposal) {
      const { candidate, requestId } = proposal
      return (
        <HireProposalPanel
          key={proposal.approval.id}
          proposal={proposal}
          channelName={data.channelNames[proposal.approval.channelId] || proposal.approval.channelId}
          time={clock(proposal.approval.createdAt)}
          load={data.teamLoad && teamLoadRows(data.teamLoad, candidate)}
          repos={repoChips(candidate.repoFilter, data.repoNames, 0)}
          autonomy={data.level && autonomyLine(data.level)}
          headcount={data.teamLoad && headcountNotice(candidate.name, data.teamLoad.headcount, data.level)}
          effect={
            data.capacity &&
            effectText(
              candidate.named ? candidate.name : `the new ${candidate.roleName}`,
              data.capacity,
              data.capacity.parked.map(nameOf),
            )
          }
          error={error}
          preflight={preflight}
          onEdit={proposal.proposal && requestId !== null ? () => open({ kind: 'proposal', requestId }) : undefined}
          onApprove={() => void run(api.approvals.decide(proposal.approval.id, { approve: true }), false)}
          onReject={(reason) => void run(api.approvals.decide(proposal.approval.id, { approve: false, reason }), false)}
          onModel={(model) =>
            candidate.requestId !== null && void run(api.hiring.setRequestModel(candidate.requestId, model), false)
          }
        />
      )
    }
    return (
      <SidePanel label="Hire proposal" title="Hire proposal" sub="Proposals from anyone who can hire">
        <EmptyState
          icon={UsersRound}
          title="No hire proposal"
          body="When an Employee with the hire capability proposes a hire, it waits here for you."
        />
      </SidePanel>
    )
  }

  return (
    <section className={VIEW} aria-label="Employees">
      <EmployeesHeader
        capacity={data.capacity}
        onSetCap={(cap) => void run(api.capacity.setConcurrencyCap(cap), false)}
        onRoles={() => open({ kind: 'roles' })}
        onHire={() => open({ kind: 'hire' })}
      />
      {/* Split: the grid on the left, the 404px panel on the right. */}
      <div className="flex min-h-0 flex-1 basis-0">
        <div className="min-w-0 flex-1 basis-0 overflow-y-auto p-24">
          {error && !editing && !proposal && (
            <p className={ERROR} role="alert">
              {error}
            </p>
          )}
          {sessions.error && (
            <p className={ERROR} role="alert">
              {sessions.error}
            </p>
          )}
          {shown.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={employees.length === 0 ? 'Nobody works here yet' : 'Nobody on this role'}
              body={
                employees.length === 0
                  ? 'Hire from the role catalog to fill the first desk.'
                  : 'Pick another role, or hire one.'
              }
              action={<Button onClick={() => open({ kind: 'hire' })}>Hire Employee</Button>}
            />
          ) : (
            <div className={GRID}>
              {shown.map((employee) => {
                const status = sessions.statuses[employee.id] ?? 'off'
                return (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    state={cardState(spriteState.get(employee.id) ?? 'off', status)}
                    repos={repoChips(employee.repoFilter, data.repoNames, employee.capabilities.length)}
                    shutOut={shutOutOfEveryRepo(employee, data.repoNames) ? shutOutLine(employee.name) : null}
                    onOpen={() => setDrawerFor(employee.id)}
                    menu={{
                      running: status !== 'off',
                      onEdit: () => open({ kind: 'employee', employee }),
                      onStart: () => sessions.start(employee.id),
                      onStop: () => sessions.stop(employee.id),
                      onFire: () => open({ kind: 'fire', employee }),
                    }}
                  />
                )
              })}
            </div>
          )}
          {data.former.length > 0 && roleId === null && (
            <>
              <h3 className={SECTION_TITLE}>Former employees</h3>
              <div className={GRID}>
                {data.former.map((employee) => (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    state={{ label: 'Former', tone: 'muted', dimmed: true }}
                    repos={repoChips(employee.repoFilter, data.repoNames, employee.capabilities.length)}
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        data-card="action"
                        onClick={() => void run(api.hiring.rehire(employee.id), false)}
                      >
                        Rehire
                      </Button>
                    }
                  />
                ))}
              </div>
            </>
          )}
        </div>
        {panel()}
      </div>
      {editing?.kind === 'employee' && (
        <EditEmployeeModal
          key={editing.employee.id}
          companyName={company.name}
          employee={editing.employee}
          roles={roles}
          employees={employees}
          repoNames={data.repoNames}
          servers={servers}
          skills={skills}
          error={error}
          preflight={preflight}
          suggestName={suggestName}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void run(api.staff.updateEmployee(editing.employee.id, patch))}
        />
      )}
      {editing?.kind === 'hire' && (
        <HireEmployeeModal
          hidden={editing.newRole !== undefined}
          permissionDefault={permissionDefault}
          companyName={company.name}
          roles={roles}
          employees={employees}
          former={data.former}
          repoNames={data.repoNames}
          servers={servers}
          skills={skills}
          headcount={data.teamLoad?.headcount ?? null}
          error={error}
          preflight={preflight}
          suggestName={suggestName}
          initialRoleId={editing.roleId}
          selectRoleId={hireRoleId}
          onNewRole={() => {
            setError(null)
            setPickingRole(true)
          }}
          onCancel={() => setEditing(null)}
          onHire={(input) => void run(api.staff.hire(input))}
        />
      )}
      {pickingRole && (
        <NewRoleDialog
          choices={roleChoices(roles)}
          error={error}
          onCancel={() => {
            setError(null)
            setPickingRole(false)
          }}
          onCreate={(choice) => void createRole(choice)}
        />
      )}
      {drawer && (
        <EmployeeDrawer
          key={drawer.id}
          employee={drawer}
          skills={skills}
          status={sessions.statuses[drawer.id] ?? 'off'}
          startedAt={sessions.startedAt[drawer.id] ?? null}
          providerReady={sessions.providerReady[drawer.id] ?? true}
          unjailed={sandboxUnjailed(sandbox.status, sandbox.settings)}
          subagents={sessions.subagents[drawer.id]}
          subSessions={sessions.subSessions[drawer.id]}
          routedTo={sessions.routedTo[drawer.id] ?? null}
          concurrencyCap={data.capacity?.concurrencyCap ?? null}
          state={spriteState.get(drawer.id) ?? 'off'}
          onStart={() => sessions.start(drawer.id)}
          onStop={() => sessions.stop(drawer.id)}
          onClose={closeDrawer}
          onDm={() => onNavigate({ view: 'chat', channelId: dmChannelId(BOSS, drawer.id) })}
        />
      )}
    </section>
  )
}

function clock(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/*
 * The Employees screen's own frame, as utilities (T210f). The view sets the body face and
 * `leading-normal` because the cards and the panel below it are measured against `normal` and not
 * against a step of the type scale.
 */
const VIEW = 'flex h-full min-h-0 w-full flex-col bg-background font-sans leading-normal'

const GRID = 'grid grid-cols-[repeat(2,minmax(0,1fr))] items-start gap-16'

const SECTION_TITLE = 'mt-24 mr-0 mb-12 ml-0 font-bold text-10/normal text-muted-foreground uppercase tracking-[0.8px]'

/** Over the grid the error stands on its own, so it keeps the rule's bottom margin. */
const ERROR = 'mt-0 mr-0 mb-12 ml-0 text-12/normal text-status-error-foreground'
