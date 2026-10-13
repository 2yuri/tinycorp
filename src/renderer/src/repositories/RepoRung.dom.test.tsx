// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo, type RepoInspection, type RepoRung } from '../../../shared/repos/repo'
import { RepoCard } from './RepoCard'
import { StackPanel } from './StackPanel'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const repo = (rung: RepoRung): Repo => ({
  id: 'r1',
  name: 'web-app',
  path: '/code/web-app',
  brief: '',
  rung,
  stack: EMPTY_STACK,
  addedAt: '',
})

const inspection: RepoInspection = {
  path: '/code/web-app',
  isGitRepo: true,
  remote: 'github.com/acme/web-app',
  defaultBranch: 'main',
  commitCount: 1,
  lastCommitAt: null,
  detected: {},
}

const roles = [{ id: 'frontend', name: 'Frontend', capabilities: ['code'], repoFilter: ['*'] } as RoleTemplate]
const employees: Employee[] = []
const noop = () => {}

function card(rung: RepoRung, onRung: (rung: RepoRung) => void = noop) {
  act(() => {
    root.render(
      <RepoCard
        repo={repo(rung)}
        inspection={inspection}
        worktreeRoot="~/acme/worktrees/web-app"
        roles={roles}
        employees={employees}
        onEdit={noop}
        onRemove={noop}
        onRung={onRung}
      />,
    )
  })
}

const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe('The chip on a repo card', () => {
  it('names the rung and its tone, in each of the three states', () => {
    for (const [rung, label, tone] of [
      ['merge', 'merges', 'neutral'],
      ['pr', 'PR only', 'warning'],
      ['local', 'local only', 'error'],
    ] as const) {
      card(rung)

      const chip = host.querySelector('[data-rung-tone]')!
      expect(chip.textContent, rung).toBe(label)
      expect(chip.getAttribute('data-rung-tone'), rung).toBe(tone)
    }
  })

  it('sits in the card head beside the state badge, as the frame draws it', () => {
    card('pr')

    const head = host.querySelector('[data-card-head]')!
    const order = [...head.children].map((child) => child.getAttribute('data-card-slot'))
    expect(order.indexOf('chip')).toBeLessThan(order.indexOf('status'))
  })
})

describe('The … menu of a repo card', () => {
  it('offers the three rungs, marks the one it is on, and moves the repo to another', () => {
    const chosen: RepoRung[] = []
    card('merge', (rung) => chosen.push(rung))

    click(host.querySelector('[data-menu-button]')!)
    const items = [...host.querySelectorAll('[role="menuitemradio"]')]

    // The ladder reads bottom-up, as the ticket writes it: local only, PR only, merges.
    expect(items.map((item) => item.textContent)).toEqual(['local only', 'PR only', 'merges'])
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    click(items[1]!)
    expect(chosen).toEqual(['pr'])
  })
})

describe('The picker in the Add repository panel', () => {
  it('offers the ladder with what each rung allows, on merges by default, and saves the pick', () => {
    const saved: RepoRung[] = []
    act(() => {
      root.render(
        <StackPanel
          mode="add"
          name="web-app"
          path="/code/web-app"
          inspection={inspection}
          initialBrief=""
          initialStack={EMPTY_STACK}
          roles={roles}
          initialAllowed={new Set<string>()}
          error={null}
          busy={false}
          onCancel={noop}
          onSave={(values) => saved.push(values.rung)}
        />,
      )
    })

    const options = [...host.querySelectorAll('[data-rung-option]')]
    expect(host.textContent).toContain('WHAT TINYCORP MAY DO HERE')
    expect(options.map((option) => option.querySelector('[data-rung-title]')!.textContent)).toEqual([
      'local only',
      'PR only',
      'merges',
    ])
    expect(host.textContent).toContain('Never pushes. Work stays in the worktree and you take it from there.')
    expect(options.map((option) => option.querySelector<HTMLInputElement>('input')!.checked)).toEqual([
      false,
      false,
      true,
    ])

    click(options[1]!)
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(saved).toEqual(['pr'])
  })

  it('opens on the rung the repo already has when the boss edits it', () => {
    act(() => {
      root.render(
        <StackPanel
          mode="edit"
          name="web-app"
          path="/code/web-app"
          inspection={inspection}
          initialBrief=""
          initialStack={EMPTY_STACK}
          initialRung="local"
          roles={roles}
          initialAllowed={new Set<string>()}
          error={null}
          busy={false}
          onCancel={noop}
          onSave={noop}
        />,
      )
    })

    const on = host.querySelector('[data-on]')!
    expect(on.textContent).toContain('local only')
  })
})
