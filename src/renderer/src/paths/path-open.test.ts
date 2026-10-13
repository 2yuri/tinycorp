import { describe, expect, it } from 'vitest'
import type { PathLink, PathTarget } from '../../../shared/files/path-links'
import type { Route } from '../chrome'
import { openPathLink, type PathOpenDeps } from './path-open'

function link(target: PathTarget, over: Partial<PathLink> = {}): PathLink {
  return {
    index: 0,
    text: 'src/counter.ts:19',
    path: 'src/counter.ts',
    repo: null,
    line: 19,
    column: null,
    full: '/work/tinycorp/src/counter.ts',
    target,
    ...over,
  }
}

function deps() {
  const routes: Route[] = []
  const all: PathOpenDeps = { navigate: (route) => void routes.push(route) }
  return { deps: all, routes }
}

describe('A click on a path an Employee wrote', () => {
  it('opens Files at the file and the line, for a path inside the Company', () => {
    const { deps: on, routes } = deps()

    openPathLink(link({ kind: 'place', placeId: 'worktree:12:repo', path: 'src/counter.ts', line: 19, column: 8 }), on)

    expect(routes).toEqual([{ view: 'files', placeId: 'worktree:12:repo', path: 'src/counter.ts', line: 19 }])
  })

  it('leaves the line out when none was written', () => {
    const { deps: on, routes } = deps()

    openPathLink(link({ kind: 'place', placeId: 'repo:1', path: 'README.md', line: null, column: null }), on)

    expect(routes).toEqual([{ view: 'files', placeId: 'repo:1', path: 'README.md' }])
  })

  it('opens a path outside the Company in Files too, under its whole path', () => {
    const shot = '/Users/yuri/Projects/arcade-screenshots/menu-portrait.png'
    const { deps: on, routes } = deps()

    openPathLink(link({ kind: 'outside', path: shot }, { text: shot, path: shot, line: null, full: shot }), on)

    expect(routes).toEqual([{ view: 'files', outside: shot }])
  })

  it('carries the line a path outside was written with', () => {
    const note = '/Users/yuri/notes/todo.md'
    const { deps: on, routes } = deps()

    openPathLink(link({ kind: 'outside', path: note }, { text: `${note}:12`, path: note, line: 12, full: note }), on)

    expect(routes).toEqual([{ view: 'files', outside: note, line: 12 }])
  })
})
