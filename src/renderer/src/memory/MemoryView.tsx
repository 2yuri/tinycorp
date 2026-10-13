import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Company } from '../../../shared/company'
import type {
  MemoryCounts,
  MemoryKind,
  MemoryPage,
  MemoryPageSummary,
  MemoryRevision,
  MemorySort,
  MemoryWrite,
} from '../../../shared/memory/company-memory'
import { emptyCounts } from '../../../shared/memory/company-memory'
import type { Route } from '../chrome'
import { SHELL_VIEW, ViewHeader } from '../chrome'
import { resources, useIpcResource } from '../ipc'
import { Alert, cx, SHELL_BUTTON } from '../ui'
import { MemoryActions } from './MemoryActions'
import { MemoryEditor } from './MemoryEditor'
import { MemoryHowItFills } from './MemoryHowItFills'
import { MemoryList } from './MemoryList'
import { MemoryPageView } from './MemoryPageView'
import { filterRows, memorySubtitle, PICK_A_PAGE } from './memory-view'
import '../ui/tailwind.css'

const api = window.tinyCorp

export interface MemoryViewProps {
  company: Company
  /** The page the route names, or none. */
  slug?: string | undefined
  kind?: MemoryKind | undefined
  /** The Activity line's way in: only the pages one closed ticket wrote. */
  ticket?: string | undefined
  onNavigate(route: Route): void
}

/* The two columns of the screen. Exported because `memory/capture` mounts them itself, and a
   harness with its own copy of the numbers is the drift T196 exists to catch. */
export const BODY = 'flex min-h-0 flex-1 items-stretch'

export const PAGE = 'flex min-h-0 min-w-0 flex-1 flex-col'

/** The filter bar over the open page: the frame's own padding, closed by one rule. */
const FILTER = 'flex items-center gap-10 border-b border-border px-22 py-16 text-12-5/[normal] text-muted-foreground'

/**
 * The Memory screen (frame `E40vSb`): the Company's shared pages on the left, the open one on the
 * right. Everything it writes goes through the engine to a markdown file and a git commit; nothing
 * on this screen asks a model anything, and the contradiction banner says so.
 */
export function MemoryView({ company, slug, kind, ticket, onNavigate }: MemoryViewProps) {
  const [rows, setRows] = useState<MemoryPageSummary[]>([])
  const [counts, setCounts] = useState<MemoryCounts>(emptyCounts())
  const [page, setPage] = useState<MemoryPage | null>(null)
  const [revisions, setRevisions] = useState<MemoryRevision[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<MemorySort>('used')
  // Which page the open editor belongs to, so leaving for another one closes it (T211).
  const [editor, setEditor] = useState<{ on: 'new' | 'page'; slug: string | undefined } | null>(null)
  const editing = editor !== null && editor.slug === slug ? editor.on : null
  const [error, setError] = useState<string | null>(null)
  const repos = useIpcResource(resources.repos).map((repo) => repo.name)
  // Where the pages are kept. The How-it-fills pane names it, and Open in Files reveals it while
  // there is no page to open.
  const [folder, setFolder] = useState<string | null>(null)

  const open = useCallback(
    (next: string | undefined) => onNavigate({ view: 'memory', ...(next && { slug: next }), ...(kind && { kind }) }),
    [kind, onNavigate],
  )

  const refresh = useCallback(async () => {
    const [list, total] = await Promise.all([
      ticket ? api.companyMemory.fromTicket(ticket) : api.companyMemory.list({ ...(kind && { kind }), sort }),
      api.companyMemory.counts(),
    ])
    setError(list.ok ? null : list.error)
    if (list.ok) setRows(list.value)
    if (total.ok) setCounts(total.value)
  }, [kind, sort, ticket])

  useEffect(() => {
    void refresh()
    return api.companyMemory.onChanged(() => void refresh())
  }, [refresh])

  useEffect(() => {
    void api.companyMemory.folder().then((result) => result.ok && setFolder(result.value))
  }, [])

  /**
   * Open in Files opens the page's own markdown file. The Files view opens a file, not a folder,
   * and the boss wants the one they are reading; with none open it takes the first row.
   *
   * A Company with no page has no file to open, and the frame still offers the action — so it
   * reveals the folder in the OS file manager instead, which is the only thing there is to show.
   */
  async function openInFiles(): Promise<void> {
    const wanted = page?.slug ?? shown[0]?.slug
    if (!wanted) {
      if (folder) await api.paths.reveal(folder)
      return
    }
    const result = await api.companyMemory.filePath(wanted)
    if (!result.ok) return setError(result.error)
    if (result.value) onNavigate({ view: 'files', outside: result.value })
  }

  // The open page and its history follow the route, and are read again after every write.
  const reopen = useCallback(async () => {
    if (!slug) {
      setPage(null)
      setRevisions([])
      return
    }
    const [found, log] = await Promise.all([api.companyMemory.get(slug), api.companyMemory.history(slug)])
    if (found.ok) setPage(found.value)
    else setError(found.error)
    setRevisions(log.ok ? log.value : [])
  }, [slug])

  useEffect(() => {
    void reopen()
    return api.companyMemory.onChanged(() => void reopen())
  }, [reopen])

  const shown = useMemo(() => filterRows(rows, search), [rows, search])
  const titles = useMemo(
    () => Object.fromEntries(rows.map((row) => [row.slug, { title: row.title, kind: row.kind }])),
    [rows],
  )
  const row = page ? (rows.find((one) => one.slug === page.slug) ?? null) : null

  function run(action: Promise<{ ok: true } | { ok: false; error: string }>): void {
    void action.then((result) => setError(result.ok ? null : result.error))
  }

  async function save(input: MemoryWrite): Promise<void> {
    const result = await api.companyMemory.write(input)
    if (!result.ok) return setError(result.error)
    setError(null)
    setEditor(null)
    open(result.value.slug)
  }

  return (
    <div className={cx(SHELL_VIEW, 'flex flex-col')}>
      <ViewHeader title="Memory" subtitle={memorySubtitle(company.name, counts)}>
        <MemoryActions
          openDisabled={folder === null && counts.pages === 0 && counts.archived === 0}
          onOpenInFiles={() => void openInFiles()}
          onNewPage={() => setEditor({ on: 'new', slug })}
        />
      </ViewHeader>

      <div className={BODY}>
        <MemoryList
          rows={shown}
          counts={counts}
          search={search}
          onSearch={setSearch}
          kind={kind ?? null}
          onKind={(next) => onNavigate({ view: 'memory', ...(next && { kind: next }), ...(slug && { slug }) })}
          sort={sort}
          onSort={setSort}
          /* A page being written is not a page being read: no row is open while the boss writes. */
          openSlug={editing === 'new' ? null : (page?.slug ?? null)}
          onOpen={(next) => open(next)}
          onWriteFirst={() => setEditor({ on: 'new', slug })}
        />

        <section className={PAGE}>
          {error && <Alert variant="error" title={error} />}
          {ticket && (
            <div className={FILTER}>
              Pages written when {ticket} closed.
              <button
                type="button"
                className={cx(SHELL_BUTTON, 'font-sans text-12-5/[normal] text-primary')}
                onClick={() => onNavigate({ view: 'memory' })}
              >
                Show everything
              </button>
            </div>
          )}
          {editing !== null ? (
            <MemoryEditor
              page={editing === 'page' ? page : null}
              repos={repos}
              onSave={(input) => void save(input)}
              onCancel={() => setEditor(null)}
            />
          ) : page ? (
            <MemoryPageView
              key={page.slug}
              page={page}
              row={row}
              titles={titles}
              revisions={revisions}
              onOpen={(next) => open(next)}
              onEdit={() => setEditor({ on: 'page', slug })}
              onPin={(pinned) => run(api.companyMemory.pin(page.slug, pinned))}
              onArchive={() => run(api.companyMemory.archive(page.slug))}
              onRestore={(commit) => run(api.companyMemory.restore(page.slug, commit))}
            />
          ) : counts.pages === 0 && counts.archived === 0 ? (
            /* No page has ever been written here, so there is nothing to pick (frame `SlxSy`). */
            <MemoryHowItFills companyName={company.name} folder={folder} onOpenFolder={() => void openInFiles()} />
          ) : (
            <div className="flex flex-1 items-center justify-center px-22 py-16 text-12-5/[normal] text-muted-foreground">
              {PICK_A_PAGE}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
