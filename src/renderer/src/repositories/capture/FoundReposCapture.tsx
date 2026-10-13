// A dev-only capture of the Found repositories picker (`found-repos-capture.html`, T168), so it can
// be compared with `design/screens/UohF8.png` and, with `?state=`, the three of `XHkqC`. The picker,
// the modal and the tree are the app's own; only the folder behind them is the frame's.
import { type ReactNode, useState } from 'react'
import type { FoundRepo } from '../../../../shared/repos/found-repos'
import { FoundReposModal } from '../FoundReposModal'
import { knownFoundRepos } from '../found-repos-model'
import { CONNECTED, FOLDER, FOUND, INSPECTIONS, SELECTED } from './found-repos-fixture'
import '../../ui/tailwind.css'

export type CaptureState = 'found' | 'scanning' | 'empty' | 'self'

/** The folder is a checkout too: its own row goes on top, and nothing inside it is ticked. */
const WITH_SELF: FoundRepo[] = [{ path: FOLDER, relative: '', kind: 'repo', parent: null }, ...FOUND]

export function foundReposCapture(which: CaptureState): ReactNode {
  return <Capture which={which} />
}

function Capture({ which }: { which: CaptureState }) {
  // Ticking in the capture is the app's own: the harness only decides what starts ticked.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    which === 'self' ? new Set([`${FOLDER}/gitops`, `${FOLDER}/k8s`]) : SELECTED,
  )
  const found = which === 'empty' ? [] : which === 'self' ? WITH_SELF : FOUND
  const streamed = which === 'scanning' ? found.slice(0, 84) : found

  const state = knownFoundRepos(FOLDER, streamed, which === 'self' ? [] : CONNECTED, {
    selected,
    inspections: INSPECTIONS,
    scanning: which === 'scanning',
    at: which === 'scanning' ? 'payments/subscriptions/worktrees' : '',
    total: which === 'scanning' ? 84 : streamed.length,
    walk:
      which === 'scanning'
        ? null
        : { folder: FOLDER, found: streamed, stopped: 'done', emptyFolders: which === 'empty' ? 0 : 1 },
    toggle: (rows, on) =>
      setSelected((before) => {
        const next = new Set(before)
        for (const row of rows) {
          if (!row.offered) continue
          if (on) next.add(row.path)
          else next.delete(row.path)
        }
        return next
      }),
  })

  return (
    <div style={{ width: 1512, height: 944, background: 'var(--background)' }}>
      <FoundReposModal
        folder={FOLDER}
        state={state}
        onCancel={() => {}}
        onChangeFolder={() => Promise.resolve(null)}
        onStartHere={() => {}}
        onAdded={() => {}}
      />
    </div>
  )
}
