import { describe, expect, it } from 'vitest'
import { deleteBody, deleteTitle } from './removal-text'

const acme = { name: 'Acme', folder: '/Users/ada/code/acme' }

describe('company removal text', () => {
  it('asks by name', () => {
    expect(deleteTitle(acme)).toBe('Delete Acme?')
  })

  it('names the folder, what leaves it and what stays', () => {
    expect(deleteBody(acme)).toBe(
      'This stops Acme’s Sessions and deletes its data in /Users/ada/code/acme: ' +
        'company.sqlite, memory/, worktrees/ and attachments/. ' +
        'Connected repos and every other file in the folder stay. This cannot be undone.',
    )
  })
})
