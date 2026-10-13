// The capture page's entry (`launcher-capture.html`): the stub goes in before any view module
// reads it. `?unfinished=0` drops the row that still owes its setup wizard, for a before/after.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { MANY, NOW, SUMMARIES } from './fixture'

// The Launcher frame's title bar asks for the update state (T130), so the stub answers that too.
window.tinyCorp = {
  shell: { toggleMaximize: () => Promise.resolve() },
  updates: {
    get: () => Promise.resolve({ current: 'capture', available: null, checkedAt: null, checking: false }),
    onChanged: () => () => {},
    checkNow: () => Promise.resolve({ current: 'capture', available: null, checkedAt: null, checking: false }),
    openDownloadPage: () => Promise.resolve(),
  },
} as unknown as TinyCorpApi

const query = new URLSearchParams(window.location.search)
// `?many=1` is a boss with a dozen Companies (T267), and `&q=` what their search holds.
const many = query.get('many') === '1'
const search = query.get('q') ?? ''
const summaries = (many ? MANY : SUMMARIES).filter((summary) =>
  query.get('unfinished') === '0' ? summary.onboardingCompletedAt : true,
)

const { LauncherView } = await import('../Launcher')
const { CreateCompanyView, EMPTY_DRAFT } = await import('../CreateCompanyView')

/**
 * `?step=create` draws the Create step instead of the list (T252). The folder is the one the step
 * suggests — `<home>/TinyCorp/<name>` — because that is what a boss sees before they have touched
 * the picker; `&onedrive=1` is the same folder inside OneDrive, with the line under the field, and
 * `&wsl=1` is the boss whose team runs inside a distro: the step suggests the distro's own home,
 * and the line under the field says the database stays on this PC (T256).
 */
const step = query.get('step')
const onedrive = query.get('onedrive') === '1'
const wsl = query.get('wsl') === '1'
const hints = {
  home: wsl ? '\\\\wsl.localhost\\archlinux\\home\\ada' : '/Users/ada',
  syncedRoots: onedrive ? ['/Users/ada'] : [],
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ width: 680, height: 740, overflow: 'hidden' }}>
      {step === 'create' ? (
        <CreateCompanyView
          draft={{ ...EMPTY_DRAFT, name: 'Acme Works' }}
          hints={hints}
          busy={false}
          error={null}
          onDraft={() => {}}
          onBrowseFolder={() => {}}
          onBrowseRepo={() => {}}
          onRepoInitialised={() => {}}
          onBack={() => {}}
          onCancel={() => {}}
          onCreate={() => {}}
        />
      ) : (
        <LauncherView
          summaries={summaries}
          now={NOW}
          highlight={0}
          version="0.9.4"
          error={null}
          onHighlight={() => {}}
          onOpen={() => {}}
          onCreate={() => {}}
          onOpenFolder={() => {}}
          query={search}
          onQuery={many ? () => {} : undefined}
        />
      )}
    </div>
  </StrictMode>,
)
