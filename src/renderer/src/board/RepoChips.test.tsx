import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EMPTY_STACK, type Repo } from '../../../shared/repos/repo'
import { RepoChips } from './RepoChips'

const stack = {
  ...EMPTY_STACK,
  language: 'TypeScript',
  framework: 'React',
  packageManager: 'pnpm',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'pnpm test',
  lint: 'pnpm lint',
}
const repos: Repo[] = [
  { id: 'r-web', name: 'web-app', path: '/w', brief: '', rung: 'merge', stack, addedAt: '' },
  { id: 'r-api', name: 'billing-api', path: '/a', brief: '', rung: 'merge', stack, addedAt: '' },
  { id: 'r-infra', name: 'infra', path: '/i', brief: '', rung: 'merge', stack: { ...stack, lint: '' }, addedAt: '' },
]

function render(selected: string[], error: string | null = null) {
  return renderToStaticMarkup(<RepoChips repos={repos} selected={selected} onChange={() => {}} error={error} />)
}

describe('RepoChips', () => {
  it('shows one toggle chip per repo, with or without checks, pressed when picked', () => {
    const html = render(['r-api'])
    expect(html).toContain('Repositories')
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?web-app/)
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?billing-api/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?infra/)
    expect(html).toContain('One worktree and one PR per selected repo.')
  })

  it('shows the validation error in place of the hint', () => {
    const html = render([], 'Pick at least one repo')
    expect(html).toContain('Pick at least one repo')
    expect(html).not.toContain('One worktree and one PR')
  })

  it('says so when the Company has no repo', () => {
    expect(renderToStaticMarkup(<RepoChips repos={[]} selected={[]} onChange={() => {}} />)).toContain(
      'No repositories yet.',
    )
  })
})

describe('RepoChips in a Company with many repos (T285)', () => {
  const many: Repo[] = Array.from({ length: 110 }, (_, i) => ({ ...repos[0]!, id: `r-${i}`, name: `repo${i + 1}` }))

  it('folds into one line of the picked repos, three names and a count, with Edit', () => {
    const html = renderToStaticMarkup(<RepoChips repos={many} selected={many.map((r) => r.id)} onChange={() => {}} />)
    expect(html).toContain('data-slot="repo-line"')
    expect(html).toContain('repo1, repo2, repo3, …')
    expect(html).toContain('+107')
    expect(html).toContain('Edit')
    expect(html).not.toContain('aria-pressed')
  })

  it('says none are picked yet, and still draws every chip in a small Company', () => {
    expect(renderToStaticMarkup(<RepoChips repos={many} selected={[]} onChange={() => {}} />)).toContain(
      'No repositories picked',
    )
    expect(render([])).toContain('aria-pressed')
  })
})
