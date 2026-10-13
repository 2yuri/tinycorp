import { useMemo } from 'react'
import type { SkillDescribed } from '../../../shared/catalogue/skills'
import type { Mentionable } from '../../../shared/domain/chat'
import { type Employee, intakeHolder } from '../../../shared/domain/staff'
import { type SkillGroup, skillHolder } from '../../../shared/providers/slash-commands'
import { epicIdOfChannel } from '../../../shared/ticket-refs'
import { navigate } from '../chrome'
import { openHire } from '../hiring'
import { resources, useIpcResource } from '../ipc'
import type { SlashComposer } from './Composer'
import { type ChatData, companyKeyOf } from './chat-view'
import { runSlash } from './slash-run'

/**
 * What a composer needs to offer and run slash commands where it stands (decision 37): the channel
 * and thread it is in, who can be reached from it, and the epic a `/ticket` lands in.
 */
export function useSlashComposer(scope: {
  channelId: string
  /** The thread the box is in, or the one open beside it; null for neither. */
  threadId: number | null
  data: ChatData
  people: Mentionable[]
  /** Shows a channel, as a `#channel` link does. */
  openChannel(channelId: string): void
}): SlashComposer {
  // The hiring catalog `/hire` completes against.
  const roles = useIpcResource(resources.roles)
  // What each skill says it does, for the palette's SKILLS group (T264).
  const described = useIpcResource(resources.skillsDescribed)
  const { channelId, threadId, data, people, openChannel } = scope
  // An epic channel scopes `/ticket` to its epic — unless the epic itself is gone.
  const named = epicIdOfChannel(channelId)
  const epicId = data.board?.epics.some((e) => e.id === named) ? named : null
  const intakeId = intakeHolder(data.employees)?.id ?? null
  const options = useMemo(() => ({ people, roles: roles.map(({ id, name }) => ({ id, name })) }), [people, roles])
  const approvals = data.approvals
  const companyKey = companyKeyOf(data)
  const employees = data.employees
  return useMemo(
    () => ({
      ...options,
      skills: (text: string) => heldSkills(skillHolder(channelId, text, people), employees, described),
      run: (text: string) =>
        runSlash(text, {
          ...options,
          channelId,
          threadId,
          epicId,
          approvals,
          intakeId,
          companyKey,
          chat: window.tinyCorp.chat,
          board: window.tinyCorp.board,
          sessions: window.tinyCorp.sessions,
          approvalApi: window.tinyCorp.approvals,
          openChannel,
          // What the office header's Hire button does: the Employees view, with the flow open.
          openHire: (roleId) => {
            navigate({ view: 'employees' })
            openHire(roleId)
          },
        }),
    }),
    [options, channelId, threadId, epicId, approvals, intakeId, companyKey, openChannel, people, employees, described],
  )
}

/**
 * The skills one Employee holds, in catalogue order and by the name the agent sees them under, or
 * null for nobody and for an Employee who holds none — who gets no group at all (T264).
 */
export function heldSkills(
  employeeId: string | null,
  employees: readonly Pick<Employee, 'id' | 'name' | 'skills'>[],
  catalogue: readonly SkillDescribed[],
): SkillGroup | null {
  const employee = employees.find((e) => e.id === employeeId)
  if (!employee) return null
  const skills = catalogue
    .filter((skill) => employee.skills.includes(skill.id))
    .map(({ name, description, missing }) => ({ name, description, missing }))
  return skills.length === 0 ? null : { owner: employee.name, skills }
}
