import type { Approval, AutonomyLevel } from '../../../shared/approvals'
import type { CapacityInfo } from '../../../shared/capacity'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../shared/catalogue/skills'
import type { Employee, PermissionMode, RoleTemplate } from '../../../shared/domain/staff'
import type { StaffingRequest, TeamLoad } from '../../../shared/hiring'
import { resources, useIpcResource } from '../ipc'

/** The current Company's roles and Employees, kept live. */
export function useStaffData(): { roles: RoleTemplate[]; employees: Employee[] } {
  const roles = useIpcResource(resources.roles)
  const employees = useIpcResource(resources.employees)
  return { roles, employees }
}

/**
 * The Company's default permission mode, kept live (T164): what a hire takes when nobody names
 * one. Null until the engine has answered, so a form can tell "not yet" from "asks first".
 */
export function usePermissionDefault(): PermissionMode | null {
  return useIpcResource(resources.permissionDefault)
}

/**
 * The Company's MCP catalogue, kept live (T136). Every form that hands servers out reads it here,
 * so the chips are the catalogue as it stands rather than a copy taken when the form opened.
 */
export function useMcpServers(): McpServerRow[] {
  return useIpcResource(resources.mcpServers)
}

/**
 * The Company's skill catalogue, kept live (T137). Every form that hands skills out reads it here,
 * and so does the drawer, whose line says how many an Employee holds — or that its Provider reads
 * none at all.
 */
export function useSkills(): SkillRow[] {
  return useIpcResource(resources.skills)
}

export interface EmployeesData {
  former: Employee[]
  capacity: CapacityInfo | null
  repoNames: string[]
  approvals: Approval[]
  requests: StaffingRequest[]
  teamLoad: TeamLoad | null
  level: AutonomyLevel | null
  channelNames: Record<string, string>
}

/** Everything else the Employees view reads, kept live. */
export function useEmployeesData(): EmployeesData {
  const repos = useIpcResource(resources.repos)
  const channels = useIpcResource(resources.channels)
  const former = useIpcResource(resources.formerEmployees)
  const capacity = useIpcResource(resources.capacity)
  const approvals = useIpcResource(resources.pendingApprovals)
  const requests = useIpcResource(resources.staffingRequests)
  const teamLoad = useIpcResource(resources.teamLoad)
  const level = useIpcResource(resources.autonomy)
  return {
    former,
    capacity,
    repoNames: repos.map((repo) => repo.name),
    approvals,
    requests,
    teamLoad,
    level,
    channelNames: Object.fromEntries(channels.map((channel) => [channel.id, channel.name])),
  }
}
