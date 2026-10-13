import { describe, expect, it } from 'vitest'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import { EMPTY_SHELL_DATA, type ShellData } from './nav-model'
import { searchShell } from './search-model'

const employee = (id: string, name: string, title: string) => ({ id, name, title }) as Employee
const ticket = (id: number, title: string) => ({ id, title }) as Ticket

function data(employees: Employee[], tickets: Ticket[]): ShellData {
  return { ...EMPTY_SHELL_DATA, employees, board: { tickets } as BoardSnapshot }
}

const ada = employee('e1', 'Ada Lorne', 'Backend')
const bo = employee('e2', 'Bo Chen', 'QA')
const login = ticket(12, 'Login page')
const billing = ticket(142, 'Billing dashboard')
const shell = data([ada, bo], [login, billing])

const rows = (query: string) => searchShell(query, shell, 'TC').map((hit) => `${hit.kind} ${hit.label}`)

describe('the drawer’s search', () => {
  it('finds nothing until the second character', () => {
    expect(rows('a')).toEqual([])
    expect(rows('ad')).toEqual(['employee Ada Lorne'])
  })

  it('matches an Employee by name or title, and a ticket by title', () => {
    expect(rows('lorne')).toEqual(['employee Ada Lorne'])
    expect(rows('qa')).toEqual(['employee Bo Chen'])
    expect(rows('dashboard')).toEqual(['ticket Billing dashboard'])
  })

  it('lists Employees before tickets when both match', () => {
    expect(rows('l')).toEqual([])
    expect(rows('lo')).toEqual(['employee Ada Lorne', 'ticket Login page'])
  })

  it('puts the named ticket first for `TC-12`, `#12` and `12`, and shows the display id', () => {
    expect(rows('TC-12')).toEqual(['ticket Login page'])
    expect(rows('#12')).toEqual(['ticket Login page'])
    expect(rows('12')).toEqual(['ticket Login page'])
    expect(searchShell('#12', shell, 'TC')[0]).toMatchObject({ kind: 'ticket', id: 12, sub: 'TC-12' })
  })

  it('finds nothing for a query nobody matches', () => {
    expect(rows('nobody')).toEqual([])
  })

  it('keeps at most eight rows', () => {
    const many = data(
      Array.from({ length: 12 }, (_, i) => employee(`e${i}`, `Sam ${i}`, 'Frontend')),
      [],
    )

    expect(searchShell('sam', many, 'TC')).toHaveLength(8)
  })
})
