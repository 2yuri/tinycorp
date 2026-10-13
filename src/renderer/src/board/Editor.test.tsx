import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../shared/repos/repo'
import type { Review } from '../../../shared/review'
import type { BoardFacts } from './board-model'
import { type Editing, Editor, SUBTASK_TOOLS } from './Editor'

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const repos: Repo[] = [
  { id: 'r-web', name: 'web-app', path: '/w', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: '' },
  { id: 'r-api', name: 'billing-api', path: '/a', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: '' },
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

const ticket: Ticket = {
  id: 128,
  epicId: null,
  title: 'Checkout fails when the card token expires mid-session',
  description: 'Repro: leave checkout open ~20 min, then pay.',
  column: 'doing',
  assigneeId: 'e-ada',
  repos: ['r-web'],
  blocked: true,
  blockedReason: 'Waiting on the sandbox key',
  blockedBy: [],
  blocks: [],
  subtasks: [
    { id: 1, ticketId: 128, title: 'Expire the token server-side', done: true, repo: null },
    { id: 2, ticketId: 128, title: 'Refresh before charging', done: false, repo: null },
  ],
  priority: 'high',
  labels: ['bug'],
  baseBranch: 'main',
}

const board: BoardSnapshot = {
  columns: [
    { id: 'todo', title: 'Todo', wipLimit: null, count: 0, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: null, count: 1, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 0, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
  ],
  targets: [],
  epics: [],
  tickets: [ticket],
}

const review: Review = {
  id: 1,
  round: 1,
  rounds: 1,
  handoff: 'agents',
  roundLimit: 3,
  ticketId: 128,
  reviewerId: 'boss',
  status: 'pending',
  decidedBy: null,
  comments: '',
  merge: null,
  approvalId: null,
  mergedRepoIds: [],
  mergeError: null,
  messageId: 1,
  requestedAt: '',
  decidedAt: null,
}

const facts: BoardFacts = {
  sessions: {},
  approvals: [],
  reviews: [review],
  code: [
    {
      ticketId: 128,
      worktrees: [
        { ticketId: 128, repoId: 'r-web', path: '/w/128', branch: 'ada/128-card-token', base: 'main', createdAt: '' },
      ],
      pullRequests: [
        { ticketId: 128, repoId: 'r-web', url: 'https://github.com/t/web/pull/412', number: 412, openedAt: '' },
      ],
    },
  ],
  plans: [],
  tests: [],
  security: [],
}

function render(editing: Editing = { kind: 'ticket', id: 128 }, error: string | null = null) {
  return renderToStaticMarkup(
    <Editor
      board={board}
      editing={editing}
      apply={async () => true}
      repos={repos}
      repoName={(id) => repos.find((r) => r.id === id)?.name ?? id}
      employees={[ada]}
      facts={facts}
      companyName="Tiny Corp"
      error={error}
      onClose={() => {}}
    />,
  )
}

describe('The ticket drawer (design Izdc9)', () => {
  it('is a scrim, a fixed header, a scrolling body and a fixed footer, in that order', () => {
    const html = render()
    const order = ['data-ui="Scrim"', '<header', 'data-ui="DrawerBody"', '<footer']
    const at = order.map((mark) => html.indexOf(mark))
    expect(
      at.some((index) => index === -1),
      html,
    ).toBe(false)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  it('names the ticket and where it sits, and keeps the close in the header', () => {
    const html = render()
    expect(text(html)).toContain('#128 Ticket')
    expect(text(html)).toContain('Tiny Corp · Board · Doing · Ada Lorne')
    // The close is inside the header, so it survives the body's scrolling.
    const head = html.slice(html.indexOf('<header'), html.indexOf('data-ui="DrawerBody"'))
    expect(head).toContain('aria-label="Close"')
  })

  it('says how to save in the footer, and its Save submits the body’s form', () => {
    const html = render()
    const foot = html.slice(html.indexOf('<footer'))
    expect(text(foot)).toContain('⌘↵ to save')
    const submits = /<button[^>]*type="submit"[^>]*form="([^"]+)"/.exec(foot)?.[1]
    expect(submits, foot).toBeTruthy()
    expect(html).toContain(`<form id="${submits}"`)
  })

  it('draws the frame’s fields, in the frame’s order', () => {
    const body = render()
    const order = ['Title', 'Description', 'Repositories', 'Base branch', 'Assignee', 'Priority', 'Labels']
    const at = order.map((label) => body.indexOf(`>${label}<`))
    expect(
      at.some((index) => index === -1),
      body,
    ).toBe(false)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(body).toContain('One worktree and one PR per repo.')
  })

  it('makes Blocked by something else a toggle, with Why under it while it is on', () => {
    const html = render()
    expect(html).toMatch(/role="switch"[^>]*checked=""/)
    expect(text(html)).toContain('Blocked by something else')
    expect(html).toContain('Waiting on the sandbox key')
  })

  it('puts BLOCKED BY, the links to other tickets, above the manual toggle (frame sLKP8)', () => {
    const html = render()
    const section = html.indexOf('data-ui="BlockedBy"')
    expect(section).toBeGreaterThan(html.indexOf('>Labels<'))
    expect(section).toBeLessThan(html.indexOf('data-ui="BlockedToggle"'))
    expect(text(html)).toContain('Add a blocker')
  })

  it('counts the subtasks, mutes the done one and offers a text link, not a button', () => {
    const html = render()
    expect(text(html)).toContain('1 of 2')
    // The done subtask mutes its title; `+ Add subtask` is a text link, not a button.
    expect(html).toMatch(/data-ui="Subtask"[\s\S]*?text-muted-foreground/)
    const add = /<button[^>]*class="([^"]*)"[^>]*>\+ Add subtask/.exec(html)?.[1]
    expect(add).toContain('border-0')
    expect(add).toContain('bg-transparent')
    expect(add).toContain('text-primary')
  })

  it("keeps the subtask row the frame's 18px: the hover tools take no height (Izdc9)", () => {
    // The remove is the kit's 30px icon button; in flow at opacity 0 it boxed every row to 30px.
    expect(render()).toMatch(/data-ui="SubtaskTools"[\s\S]*?Remove subtask/)
    // The guard is the class list now, not a stylesheet: the row's height depends on these two.
    expect(SUBTASK_TOOLS).toContain('h-0')
    expect(SUBTASK_TOOLS).toContain('opacity-0')
  })

  it('puts the branch, the PR and the way into Review in one Code & review card', () => {
    const html = render()
    const card = html.slice(html.indexOf('data-ui="CodeCard"'))
    expect(text(html)).toContain('Code &amp; review')
    expect(text(card)).toContain('ada/128-card-token')
    expect(text(card)).toContain('worktree')
    expect(text(card)).toContain('#412')
    expect(card).toContain('data-variant="success"')
    expect(text(card)).toContain('Open review')
    expect(text(card)).toContain('Waiting for review · by you')
  })

  it('shows an error inside the body, above the form', () => {
    const html = render({ kind: 'ticket', id: 128 }, 'Nope')
    const body = html.slice(html.indexOf('data-ui="DrawerBody"'))
    expect(body.indexOf('Nope')).toBeLessThan(body.indexOf('<form'))
  })

  it('says so when the ticket is gone, instead of drawing an empty form', () => {
    const html = render({ kind: 'ticket', id: 999 })
    expect(text(html)).toContain('This ticket no longer exists.')
    expect(html).not.toContain('<form')
    // Nothing to save, so the footer promises nothing.
    expect(text(html)).not.toContain('to save')
    expect(html).not.toContain('type="submit"')
  })
})
