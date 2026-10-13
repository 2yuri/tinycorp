// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { NewRoleDialog } from './NewRoleDialog'
import { roleChoices } from './roles-model'

/**
 * New role, frame `s1iawl` (T262): the dialog picks one card, and picking *Start blank* takes the
 * selection off the template it opened on — it never shows two chosen.
 */

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const cards = () => [...document.body.querySelectorAll<HTMLLabelElement>('[data-ui="Template"]')]
const chosen = () => cards().filter((card) => card.getAttribute('data-state') === 'on')

it('selects the blank card, and only it, when the boss starts blank', () => {
  act(() =>
    root.render(<NewRoleDialog choices={roleChoices([])} error={null} onCancel={() => {}} onCreate={() => {}} />),
  )
  expect(chosen()).toHaveLength(1)

  const blank = cards().find((card) => card.textContent?.includes('Start blank'))
  act(() => blank?.click())

  expect(chosen().map((card) => card.textContent)).toEqual([expect.stringContaining('Start blank')])
  expect(document.body.querySelectorAll('input[type="radio"]:checked')).toHaveLength(1)
})
