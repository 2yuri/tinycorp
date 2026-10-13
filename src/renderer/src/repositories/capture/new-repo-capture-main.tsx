// The New repository capture's entry (`new-repo-capture.html`, T144): the Add repository panel on
// its New repository source, filled in the way frame `gFdvh` draws it, over a stand-in engine.
// `?state=in-place|refused|remote` shows the other rows of `zzGk4`. Nothing here ships.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { RemoteOffer, RepoInspection, RepoStartPlan } from '../../../../shared/repos/repo'

const state = new URLSearchParams(location.search).get('state') ?? 'new-folder'

const plan = (path: string): RepoStartPlan =>
  state === 'in-place'
    ? { kind: 'in-place', path, files: 12 }
    : state === 'refused'
      ? {
          kind: 'refused',
          path,
          reason:
            'Inside the repository at ~/code/tinycorp/web-app — both would track its files. Choose a folder outside it.',
        }
      : { kind: 'new-folder', path }

const offers: RemoteOffer[] = [
  state === 'signed-out'
    ? { forge: 'github', name: 'GitHub', ready: false, account: null, fix: 'gh auth login' }
    : { forge: 'github', name: 'GitHub', ready: true, account: '2yuri', fix: null },
]

const nothing = (path: string): RepoInspection => ({
  path,
  isGitRepo: false,
  remote: null,
  defaultBranch: null,
  commitCount: null,
  lastCommitAt: null,
  detected: {},
})

;(window as unknown as { tinyCorp: unknown }).tinyCorp = {
  repos: {
    inspect: (path: string) => Promise.resolve(nothing(path)),
    planStart: (path: string) => Promise.resolve(plan(path)),
    remoteOffers: () => Promise.resolve({ ok: true, value: offers }),
    pickFolder: () => Promise.resolve(null),
  },
}

const { AddRepoModal } = await import('../AddRepoModal')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AddRepoModal companyName="Tiny Corp" initial={null} onCancel={() => {}} onContinue={() => {}} />
  </StrictMode>,
)

/**
 * Chooses the source and types the values, as the boss would, and keeps doing it until they are
 * there.
 *
 * Once was not enough: `StrictMode` mounts the modal, throws that mount away and mounts it again,
 * so a single click landed on a tree React was about to discard and the capture came back on the
 * source it opened with — which is how `new-repo.css` ended up drawn by no shot at all (T209).
 */
const LABELS: Record<string, string> =
  state === 'local'
    ? { 'LOCAL PATH': '~/code/notes' }
    : {
        LOCATION: state === 'refused' ? '~/code/tinycorp/web-app/packages' : '~/code/tinycorp',
        'REPOSITORY NAME': state === 'in-place' ? 'notes' : state === 'refused' ? 'new' : 'payments-web',
      }

function fill() {
  // `?state=local` stays on the source the modal opens with: a folder that holds no repo, which is
  // where `Not a git repository yet` and its offer to start one are drawn.
  if (state !== 'local') {
    // The source cards are `<label>`s over a real radio, not `role="radio"` — which is what the
    // old selector looked for, so it never found one and this capture had been shooting the
    // modal's opening source ever since (T209).
    const card = [...document.querySelectorAll('.repo-source')].find(
      (el) => el.querySelector('.repo-source__title')?.textContent === 'New repository',
    )
    const source = card?.querySelector<HTMLInputElement>('input[type="radio"]')
    if (!source) return
    if (!source.checked) source.click()
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  for (const field of document.querySelectorAll('label.repo-field')) {
    const label = Object.keys(LABELS).find((key) => field.textContent?.startsWith(key))
    const input = field.querySelector('input')
    if (!label || !input || input.value === LABELS[label]) continue
    setter.call(input, LABELS[label])
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}
setInterval(fill, 100)
