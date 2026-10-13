import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AutonomyLevel } from '../../../shared/approvals'
import type { BoardSnapshot } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../shared/repos/repo'
import { NewTicketModal } from './NewTicketModal'
import { newTicketInput, startsInColumn, startWorkNote, type TicketDraft } from './new-ticket-model'

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const repos: Repo[] = [
  { id: 'r-web', name: 'web-app', path: '/w', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: '' },
  { id: 'r-api', name: 'billing-api', path: '/a', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: '' },
  { id: 'r-infra', name: 'infra', path: '/i', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: '' },
]

const ada = {
  id: 'e-ada',
  name: 'Ada Lorne',
  roleId: 'frontend',
  title: 'Frontend',
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
  overrides: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  desk: 0,
  sprite: 1,
  createdAt: '',
} as unknown as Employee

const board: BoardSnapshot = {
  columns: [
    { id: 'planning', title: 'Planning', wipLimit: null, count: 0, overLimit: false },
    { id: 'todo', title: 'Ready', wipLimit: null, count: 0, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: null, count: 0, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 0, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
  ],
  targets: [],
  epics: [],
  tickets: [],
}

function render(overrides: { autonomy?: AutonomyLevel | null; error?: string | null } = {}) {
  return renderToStaticMarkup(
    <NewTicketModal
      board={board}
      column="todo"
      epicId={null}
      repos={repos}
      employees={[ada]}
      companyName="Tiny Corp"
      autonomy={overrides.autonomy === undefined ? 'managed' : overrides.autonomy}
      apply={async () => true}
      error={overrides.error ?? null}
      onClose={() => {}}
    />,
  )
}

describe('New ticket (design Y5daiS)', () => {
  it('is a backdrop round a dialog with a header bar, a form and a footer bar, in that order', () => {
    const html = render()
    const order = ['data-ui="NewTicket"', 'role="dialog"', '<header', '<form', '<footer']
    const at = order.map((mark) => html.indexOf(mark))
    expect(
      at.some((index) => index === -1),
      html,
    ).toBe(false)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    // Not the drawer: the side panel is gone.
    expect(html).not.toContain('Board editor')
    expect(html).not.toContain('data-ui="Scrim"')
  })

  it('names it and where it lands, and keeps the close in the header', () => {
    const html = render()
    const head = html.slice(html.indexOf('<header'), html.indexOf('<form'))
    expect(text(head)).toContain('New ticket')
    expect(text(head)).toContain('Tiny Corp · Board · Ready')
    expect(head).toContain('aria-label="Close"')
  })

  it('draws the frame’s fields, in the frame’s order, with the repo chips beside the base branch', () => {
    const html = render()
    const order = ['Title', 'Description', 'Repositories', 'Base branch', 'Assignee', 'Priority', 'Labels']
    const at = order.map((label) => html.indexOf(`>${label}<`))
    expect(
      at.some((index) => index === -1),
      html,
    ).toBe(false)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    // The chip row (T43, decision 32) offers every repo with its own hint.
    for (const repo of repos) expect(html).toContain(`>${repo.name}<`)
    expect(html).toContain('One worktree and one PR per selected repo.')
  })

  it('says ⌘↵ to create in the footer, beside Cancel and a Create ticket that submits the form', () => {
    const html = render()
    const foot = html.slice(html.indexOf('<footer'))
    expect(text(foot)).toContain('⌘ ↵ to create')
    expect(text(foot)).toContain('Cancel')
    expect(text(foot)).toContain('Create ticket')
    const submits = /<button[^>]*type="submit"[^>]*form="([^"]+)"/.exec(foot)?.[1]
    expect(submits, foot).toBeTruthy()
    expect(html).toContain(`<form id="${submits}"`)
  })

  it('offers Start work immediately under a divider, off and waiting for an assignee', () => {
    const html = render()
    expect(html.indexOf('data-ui="Divider"')).toBeLessThan(html.indexOf('data-ui="StartWork"'))
    expect(text(html)).toContain('Start work immediately')
    expect(text(html)).toContain('Pick an assignee to start the work as soon as the ticket is created.')
    expect(html).toMatch(/role="switch"[^>]*disabled=""/)
    expect(html).not.toMatch(/role="switch"[^>]*checked=""/)
  })

  it('hides Start work immediately under Supervised (decision 38), and while the level is unknown', () => {
    for (const autonomy of ['supervised', null] as const) {
      const html = render({ autonomy })
      expect(text(html), String(autonomy)).not.toContain('Start work immediately')
      expect(html, String(autonomy)).not.toContain('data-ui="Divider"')
    }
    expect(text(render({ autonomy: 'autonomous' }))).toContain('Start work immediately')
  })

  it('shows an error inside the form, above the fields', () => {
    const html = render({ error: 'Nope' })
    const form = html.slice(html.indexOf('<form'))
    expect(form.indexOf('Nope')).toBeLessThan(form.indexOf('>Title<'))
  })
})

describe('The draft the modal sends the engine', () => {
  const draft: TicketDraft = {
    title: 'Checkout fails when the card token expires mid-session',
    description: 'Repro: leave checkout open ~20 min, then pay.',
    column: 'todo',
    epicId: 7,
    assigneeId: 'e-ada',
    repos: ['r-web', 'r-api'],
    priority: 'high',
    labels: ['bug', 'checkout'],
    baseBranch: 'main',
    startNow: false,
  }

  it('keeps every field the frame draws, and the epic the board is scoped to', () => {
    expect(newTicketInput(draft)).toEqual({
      title: draft.title,
      description: draft.description,
      epicId: 7,
      column: 'todo',
      assigneeId: 'e-ada',
      repos: ['r-web', 'r-api'],
      priority: 'high',
      labels: ['bug', 'checkout'],
      baseBranch: 'main',
    })
  })

  it('leaves a blank branch and an unclaimed ticket null, so the engine keeps its defaults', () => {
    const blank = newTicketInput({ ...draft, assigneeId: '  ', baseBranch: '  ' })
    expect(blank.baseBranch).toBeNull()
    expect(blank.assigneeId).toBeNull()
  })

  it('starts the work by creating the ticket in Doing, where an assigned ticket cuts its worktree', () => {
    expect(startsInColumn({ ...draft, startNow: true })).toBe('doing')
    expect(startsInColumn({ ...draft, startNow: false })).toBe('todo')
    // Nobody to start: the ticket lands where the action was taken.
    expect(startsInColumn({ ...draft, startNow: true, assigneeId: '' })).toBe('todo')
  })

  it('names who starts and the branch they cut from, and asks for an assignee when there is none', () => {
    expect(startWorkNote('Ada', 'main')).toBe(
      'Ada opens a worktree off main and starts as soon as the ticket is created.',
    )
    expect(startWorkNote('Ada', '  ')).toContain('off the repo default')
    expect(startWorkNote(null, 'main')).toBe('Pick an assignee to start the work as soon as the ticket is created.')
  })
})
