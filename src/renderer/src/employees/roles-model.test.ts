import { describe, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { BLANK_ROLE, deleteBlocker, fieldsForChoice, removeUnusedNote, roleChoices, roleRows } from './roles-model'

const role = (patch: Partial<RoleTemplate> & { id: string }): RoleTemplate => ({
  name: patch.id,
  persona: '',
  capabilities: [],
  repoFilter: [],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
  ...patch,
})

const employee = (name: string, roleId: string): Employee =>
  ({ id: name.toLowerCase(), name, roleId, title: roleId }) as unknown as Employee

describe('the Roles list', () => {
  it('counts who is on each role and marks the ones nobody ever was', () => {
    const roles = [role({ id: 'frontend', name: 'Frontend' }), role({ id: 'po', name: 'PO' })]

    const rows = roleRows(roles, [employee('Ada', 'frontend'), employee('Vega', 'frontend')], [])

    expect(rows.map((row) => [row.role.name, row.count, row.unused])).toEqual([
      ['Frontend', '2 employees', false],
      ['PO', 'Not used', true],
    ])
  })

  it('counts a role a former Employee could be rehired onto as used', () => {
    const rows = roleRows([role({ id: 'qa', name: 'QA' })], [], [employee('Iris', 'qa')])

    expect(rows[0]).toMatchObject({ count: '0 employees', unused: false })
  })

  it('offers Remove unused roles for the built-ins only, and says which they are', () => {
    const roles = [
      role({ id: 'pm', name: 'PM' }),
      role({ id: 'po', name: 'PO' }),
      role({ id: 'hr', name: 'HR' }),
      role({ id: 'own', name: 'Designer', seeded: false }),
    ]

    const rows = roleRows(roles, [employee('Hera', 'pm')], [])

    expect(removeUnusedNote(rows)).toBe('PO and HR came with the Company and nobody was ever hired into them.')
    expect(removeUnusedNote(rows.slice(0, 1))).toBeNull()
  })

  it('says who has to move before a role can go, and nothing when nobody does', () => {
    const rows = roleRows(
      [role({ id: 'frontend', name: 'Frontend' }), role({ id: 'po', name: 'PO' })],
      [employee('Ada', 'frontend')],
      [employee('Kepler', 'frontend')],
    )

    expect(deleteBlocker(rows[0]!)).toBe(
      'Ada is on this role, and Kepler can be rehired onto it. Pick where they go, or move them yourself first.',
    )
    expect(deleteBlocker(rows[1]!)).toBeNull()
  })

  it('reads a role’s capabilities and repos as one line', () => {
    const rows = roleRows(
      [
        role({ id: 'tech-lead', capabilities: ['plan', 'code'], repoFilter: ['*'] }),
        role({ id: 'frontend', capabilities: ['code'], repoFilter: ['*web*', '*ui*'] }),
        role({ id: 'blank' }),
      ],
      [],
      [],
    )

    expect(rows.map((row) => row.meta)).toEqual(['plan · code · every repo', 'code · *web*, *ui*', 'nothing yet'])
  })
})

describe('the New role dialog', () => {
  it('offers the built-ins the Company has not taken first, then the rest, then the blank one', () => {
    const choices = roleChoices([role({ id: 'pm', name: 'PM' })])

    expect(choices.at(-1)).toEqual(BLANK_ROLE)
    expect(choices.find((choice) => choice.templateId === 'pm')).toMatchObject({ inCompany: true })
    expect(choices[0]).toMatchObject({ templateId: 'po', inCompany: false })
    expect(choices.filter((choice) => choice.inCompany).map((choice) => choice.name)).toEqual(['PM'])
  })

  it('offers Security beside the rest, which is one catalogue and not two (T241)', () => {
    const security = roleChoices([]).find((choice) => choice.templateId === 'security')

    expect(security).toMatchObject({ name: 'Security', meta: 'review · code · every repo' })
  })

  it('says what each template is for in one sentence', () => {
    const qa = roleChoices([]).find((choice) => choice.templateId === 'qa')!

    expect(qa.description).toBe(
      'You test a ticket in the running app before it merges, against the plan’s acceptance criteria, try to break it, and write down how to reproduce what you find.',
    )
    expect(qa.meta).toBe('review · test · code · every repo')
  })

  it('opens the editor on the template’s fields, under a name the Company does not have', () => {
    expect(fieldsForChoice(roleChoices([])[0]!, [])).toMatchObject({
      name: 'PM',
      capabilities: ['intake', 'plan', 'hire'],
    })
    expect(
      fieldsForChoice(roleChoices([]).find((c) => c.templateId === 'qa')!, [role({ id: 'x', name: 'QA' })]),
    ).toMatchObject({ name: 'QA 2' })
    expect(fieldsForChoice(BLANK_ROLE, [])).toEqual({
      name: '',
      persona: '',
      capabilities: [],
      repoFilter: [],
      areas: [],
      mcpServers: [],
      skills: [],
    })
  })
})
