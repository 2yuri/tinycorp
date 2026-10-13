import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { RepoInspection } from '../../../shared/repos/repo'
import { scanRows } from './scan-view-model'

// Static rendering has no DOM: portals render in place.
vi.mock('react-dom', async (original) => ({
  ...(await original<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}))

let modals: {
  ScanFolderModal: typeof import('./ScanFolderModal').ScanFolderModal
  ScanResults: typeof import('./ScanFolderModal').ScanResults
  AddRepoModal: typeof import('./AddRepoModal').AddRepoModal
}

beforeAll(async () => {
  // The modals read the preload API when their modules load; static rendering never calls it.
  const globals = globalThis as { window?: unknown; document?: unknown }
  globals.window = { tinyCorp: { repos: {} } }
  globals.document = { body: {} }
  const [scan, add] = await Promise.all([import('./ScanFolderModal'), import('./AddRepoModal')])
  modals = { ...scan, AddRepoModal: add.AddRepoModal }
})

const noop = () => {}
const found = (path: string, overrides: Partial<RepoInspection> = {}): RepoInspection => ({
  path,
  isGitRepo: true,
  remote: null,
  defaultBranch: null,
  commitCount: null,
  lastCommitAt: null,
  detected: {},
  ...overrides,
})
const complete = {
  packageManager: 'pnpm',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'pnpm test',
  lint: 'pnpm lint',
}

describe('Scan a folder', () => {
  it('opens on the parent folder picker with nothing to attach yet', () => {
    const html = renderToStaticMarkup(
      <modals.ScanFolderModal companyName="Acme" repos={[]} onCancel={noop} onAttached={noop} />,
    )

    expect(html).toContain('aria-label="Scan a folder"')
    expect(html).toContain('PARENT FOLDER')
    expect(html).toContain('Browse…')
    expect(html).toContain('two folders deep and skips node_modules and hidden folders')
    const submit = /<button[^>]*type="submit"[^>]*>(.*?)<\/button>/.exec(html)
    expect(submit?.[0]).toContain('disabled=""')
    expect(submit?.[1]).toContain('>Attach</span>')
  })

  it('lists found repos with remote, detected stack, checkbox, checks state and a brief for the selected ones', () => {
    const rows = scanRows(
      [
        found('/code/api', {
          remote: 'github.com/acme/api',
          detected: { language: 'Go', packageManager: 'go modules' },
        }),
        found('/code/web', { remote: 'github.com/acme/web', detected: { language: 'TypeScript', ...complete } }),
        found('/code/old', { detected: complete }),
      ],
      [
        {
          id: 'r1',
          name: 'old',
          path: '/code/old',
          brief: '',
          rung: 'merge',
          stack: { ...complete, language: '', framework: '', packageManagerVersion: '' },
          addedAt: '',
        },
      ],
    )

    const html = renderToStaticMarkup(
      <modals.ScanResults
        scan={{ state: 'done', folder: '/code', found: [] }}
        rows={rows}
        selected={new Set(['/code/web'])}
        failed={[{ path: '/code/api', error: 'A repo named api already exists' }]}
        onToggle={noop}
        briefs={{ '/code/web': 'Storefront' }}
      />,
    )

    expect(html).toContain('FOUND IN /code')
    expect(html).toContain('github.com/acme/api · Go · go modules')
    expect(html).toContain('github.com/acme/web · TypeScript · pnpm')
    const items = html.split('data-scan-row').slice(1)
    expect(items).toHaveLength(3)
    expect(items[0]).toContain('aria-label="Attach api"')
    expect(items[0]).not.toContain('checked=""')
    expect(items[0]).toContain('No checks yet')
    expect(items[0]).not.toContain('Brief')
    expect(items[0]).toContain('A repo named api already exists')
    expect(items[1]).toContain('checked=""')
    expect(items[1]).toContain('Checks detected')
    expect(items[1]).toContain('aria-label="Brief"')
    expect(items[1]).toContain('>Storefront</textarea>')
    expect(items[1]).toContain('placeholder="What is this repo? Any stack preferences, or let the team decide."')
    expect(items[1]).toMatch(/aria-label="Checks \(optional\)".*install.*pnpm install/)
    expect(html).not.toContain('Stack required')
    expect(items[2]).toMatch(/checked=""[^>]*disabled=""|disabled=""[^>]*checked=""/)
    expect(items[2]).toContain('Attached')
  })

  it('says when a folder holds no repos, and why a scan failed', () => {
    const empty = renderToStaticMarkup(
      <modals.ScanResults
        scan={{ state: 'done', folder: '/notes', found: [] }}
        rows={[]}
        selected={new Set()}
        failed={[]}
        onToggle={noop}
      />,
    )
    const failed = renderToStaticMarkup(
      <modals.ScanResults
        scan={{ state: 'failed', folder: 'notes', error: 'A folder to scan must be absolute: notes' }}
        rows={[]}
        selected={new Set()}
        failed={[]}
        onToggle={noop}
      />,
    )

    expect(empty).toContain('No git repos in /notes or two folders below it.')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('must be absolute')
  })

  it('offers to initialise a scanned folder that holds no repos', () => {
    const html = renderToStaticMarkup(
      <modals.ScanResults
        scan={{ state: 'done', folder: '/notes', found: [] }}
        rows={[]}
        selected={new Set()}
        failed={[]}
        onToggle={noop}
        onInitialised={noop}
      />,
    )

    expect(html).toContain('data-ui="Alert"')
    expect(html).toContain('Not a git repository yet')
    expect(html).toMatch(/data-ui="Button"[^>]*>.*Initialise repository/)
  })
})

describe('Add repository sources', () => {
  it('offers to initialise a chosen folder without a .git instead of refusing it', () => {
    const plain = found('/code/notes', { isGitRepo: false })
    const html = renderToStaticMarkup(
      <modals.AddRepoModal
        companyName="Acme"
        initial={{ path: '/code/notes', name: 'notes', inspection: plain, detect: true }}
        onCancel={noop}
        onContinue={noop}
      />,
    )

    expect(html).toContain('data-ui="Alert"')
    expect(html).toContain('Not a git repository yet')
    expect(html).toMatch(/data-ui="Button"[^>]*>.*Initialise repository/)
    expect(html).not.toContain('Not a git repo<')
  })

  it('keeps Clone from GitHub and Remote URL inert; a local folder and a new repository are selectable', () => {
    const html = renderToStaticMarkup(
      <modals.AddRepoModal companyName="Acme" initial={null} onCancel={noop} onContinue={noop} />,
    )
    const sources = html
      .split('data-source')
      .slice(1)
      .map((part) => part.split('</label>')[0]!)

    expect(sources).toHaveLength(4)
    expect(sources[0]).toContain('Local folder')
    expect(sources[0]).not.toContain('disabled')
    expect(sources[1]).toContain('New repository')
    expect(sources[1]).not.toContain('disabled')
    for (const [i, title] of [
      [2, 'Clone from GitHub'],
      [3, 'Remote URL'],
    ] as const) {
      expect(sources[i]).toContain(title)
      expect(sources[i]).toContain('disabled=""')
    }
  })
})
