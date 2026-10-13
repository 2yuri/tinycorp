import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RestoreLoss, RestorePoint } from '../../../shared/restore-points'
import { GoBackDialog, RestorePointList } from './TicketRestorePoints'

const noop = () => {}
const now = new Date('2026-09-21T18:00:00.000Z')
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const point = (over: Partial<RestorePoint> = {}): RestorePoint => ({
  id: 'p1',
  ticketId: 12,
  repoId: 'r1',
  employeeId: 'e1',
  reason: 'commit',
  note: 'Add the form',
  commit: '1a2b3c4d5e6f7890',
  branch: 'ticket-12-login',
  hadUncommitted: false,
  takenAt: '2026-09-21T09:30:00.000Z',
  ...over,
})

const loss: RestoreLoss = {
  commits: ['Ruin it'],
  uncommitted: true,
  stops: { employeeId: 'e1', name: 'Ada' },
}

const repoName = (id: string) => (id === 'r1' ? 'web' : id)

describe('The restore point list', () => {
  it('shows every point with what was said and a way back to it', () => {
    const html = renderToStaticMarkup(
      <RestorePointList
        points={[point(), point({ id: 'p2', reason: 'start', note: 'Login page' })]}
        now={now}
        repoName={repoName}
        onGoBack={noop}
      />,
    )

    expect(text(html)).toContain('Committed Add the form')
    expect(text(html)).toContain('Before the work started')
    expect(text(html)).toContain('web · 1a2b3c4')
    expect(html.match(/Go back/g)).toHaveLength(2)
  })

  it('says when a point carried uncommitted work', () => {
    const html = renderToStaticMarkup(
      <RestorePointList points={[point({ hadUncommitted: true })]} now={now} repoName={repoName} onGoBack={noop} />,
    )

    expect(text(html)).toContain('with uncommitted work')
  })
})

describe('The going-back confirmation', () => {
  function dialog(patch: Partial<Parameters<typeof GoBackDialog>[0]> = {}) {
    return renderToStaticMarkup(
      <GoBackDialog point={point()} loss={loss} repo="web" busy={false} onCancel={noop} onConfirm={noop} {...patch} />,
    )
  }

  it('is a modal alert dialog naming the point, what stops and what is lost', () => {
    const html = dialog()

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
    expect(text(html)).toContain('Go back to “Add the form”?')
    expect(text(html)).toContain('This stops Ada’s Session')
    expect(text(html)).toContain('It loses 1 commit (“Ruin it”) and the uncommitted work there.')
  })

  it('puts Cancel first and the destructive Go back last', () => {
    const html = dialog()

    expect(text(html)).toMatch(/Cancel Go back$/)
    expect(html).toMatch(/data-variant="outline"[^>]*>.*Cancel.*data-variant="destructive"[^>]*>.*Go back/)
  })

  it('disables both buttons while it runs', () => {
    expect(dialog({ busy: true }).match(/disabled=""/g)).toHaveLength(2)
  })
})
