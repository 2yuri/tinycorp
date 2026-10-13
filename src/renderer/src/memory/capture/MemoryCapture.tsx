// A dev-only capture of the Memory view against the design's own fixture, so the screen can be
// compared with `design/screens/E40vSb.png` — with `?state=empty`, with `design/screens/SlxSy.png`,
// which is the screen every real Company shows until its first ticket closes, and with `?state=new`,
// with `design/screens/V2v4hd.png`, the boss writing a page. Nothing here ships:
// `company-memory-capture.html` is not the app's entry, and no app module imports this folder.

import type { ReactNode } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { emptyCounts } from '../../../../shared/memory/company-memory'
import {
  HEADER_ACTIONS,
  HEADER_INFO,
  HEADER_SPACER,
  HEADER_SUBTITLE,
  HEADER_TITLE,
  HEADER_TITLE_ROW,
  SHELL,
  SHELL_BODY,
  SHELL_HEADER,
  SHELL_MAIN,
  SHELL_VIEW,
} from '../../chrome'
import { cx } from '../../ui'
import { MemoryActions } from '../MemoryActions'
import { MemoryEditor } from '../MemoryEditor'
import { MemoryHowItFills } from '../MemoryHowItFills'
import { MemoryList } from '../MemoryList'
import { MemoryPageView } from '../MemoryPageView'
import { BODY, PAGE } from '../MemoryView'
import { memorySubtitle } from '../memory-view'
import * as fixture from './fixture'
import '../../ui/tailwind.css'

/** The window this is shot in: the frame's, less the title bar the harness does not draw. */
const WINDOW = { width: 1512, height: 900 }

const noop = () => {}

/**
 * What the drawer reaches for the moment it mounts. It is handed its own data; the Usage row and
 * the channel-delete prompt are the two modules under it that read the preload API themselves.
 */
function stub(): TinyCorpApi {
  const usage = { providers: [], readAt: null }
  return {
    usage: {
      read: () => Promise.resolve({ ok: true, value: usage }),
      refresh: () => Promise.resolve({ ok: true, value: usage }),
      onChanged: () => () => {},
    },
    chat: {},
  } as unknown as TinyCorpApi
}

/** Where a new Company's pages would be, written as the boss would type it (frame `SlxSy`). */
const EMPTY_FOLDER = '~/Projects/tiny-corp/memory/company'

/** The Company's repos, as the repo select offers them (frame `V2v4hd`). */
const REPOS = ['web-app', 'billing-api', 'infra']

/** The states beside the frame's own: nothing written, a page being written, a page being rewritten. */
const STATES = ['empty', 'new', 'edit'] as const
type State = (typeof STATES)[number]

function stateFromQuery(): State | null {
  const state = new URLSearchParams(window.location.search).get('state')
  return STATES.find((one) => one === state) ?? null
}

export async function memoryCapture(): Promise<ReactNode> {
  // The stub goes in before the drawer's modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  const { CompanyRail } = await import('../../shell/CompanyRail')
  const { Sidebar } = await import('../../shell/Sidebar')
  const state = stateFromQuery()
  const empty = state === 'empty'
  const counts = empty ? emptyCounts() : fixture.counts
  return (
    <div className={SHELL} style={{ ...WINDOW, overflow: 'hidden' }}>
      <div className={SHELL_BODY}>
        <CompanyRail companies={fixture.companies} currentId={fixture.company.id} onSwitch={noop} onCreate={noop} />
        <Sidebar
          company={fixture.company}
          companies={fixture.companies}
          data={fixture.shellData(counts.pages)}
          route={{ view: 'memory' }}
          onNavigate={noop}
          onSwitch={noop}
          onCreate={noop}
          onOpen={noop}
        />
        <main className={SHELL_MAIN}>
          <Header counts={counts} />
          <div className={cx(SHELL_VIEW, 'flex flex-col')} style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
            <div className={BODY}>
              <MemoryList
                rows={empty ? [] : fixture.rows}
                counts={counts}
                search=""
                onSearch={() => {}}
                kind={null}
                onKind={() => {}}
                sort="used"
                onSort={() => {}}
                openSlug={state === null || state === 'edit' ? fixture.open.slug : null}
                onOpen={() => {}}
                onWriteFirst={() => {}}
                now={fixture.NOW}
              />
              <section className={PAGE}>
                {empty ? (
                  <MemoryHowItFills companyName="Tiny Corp" folder={EMPTY_FOLDER} onOpenFolder={() => {}} />
                ) : state === 'new' || state === 'edit' ? (
                  <MemoryEditor
                    page={state === 'edit' ? fixture.open : null}
                    repos={REPOS}
                    onSave={() => {}}
                    onCancel={() => {}}
                  />
                ) : (
                  <MemoryPageView
                    page={fixture.open}
                    row={fixture.rows[0]!}
                    titles={fixture.titles}
                    revisions={fixture.revisions}
                    onOpen={() => {}}
                    onEdit={() => {}}
                    onPin={() => {}}
                    onArchive={() => {}}
                    onRestore={() => {}}
                    now={fixture.NOW}
                  />
                )}
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/** The shell's 64px content header, which the real view fills through `<ViewHeader>`. */
function Header({ counts }: { counts: Parameters<typeof memorySubtitle>[1] }) {
  return (
    <header className={SHELL_HEADER}>
      <div className={HEADER_INFO}>
        <div className={HEADER_TITLE_ROW}>
          <h1 className={HEADER_TITLE}>Memory</h1>
        </div>
        <div className={HEADER_SUBTITLE}>{memorySubtitle('Tiny Corp', counts)}</div>
      </div>
      <div className={HEADER_SPACER} />
      {/* The view's own buttons, not a copy: a copy here is a copy that drifts from the screen
          the audit is supposed to be measuring, and this one did. */}
      <div className={HEADER_ACTIONS}>
        <MemoryActions />
      </div>
    </header>
  )
}
