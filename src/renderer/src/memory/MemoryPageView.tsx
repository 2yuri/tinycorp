import {
  Archive,
  ArrowRight,
  Flame,
  FlaskConical,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  type LucideIcon,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Split,
  StickyNote,
  Ticket,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  CONTRADICTION_EXPLANATION,
  MEMORY_KIND_LABEL,
  type MemoryPage,
  type MemoryPageSummary,
  type MemoryRevision,
  type MemorySourceKind,
  pagePath,
  sourceLabel,
  usesChip,
  whenLabel,
} from '../../../shared/memory/company-memory'
import { MarkdownBody } from '../files'
import { Avatar, Badge, Button, cx, SHELL_BUTTON } from '../ui'
import { KIND_ICON } from './MemoryList'
import { historyLabel } from './memory-view'

/** The mark a source carries in the front matter: a ticket, a PR, a review thread (`E40vSb`). */
const SOURCE_ICON: Record<MemorySourceKind, LucideIcon> = {
  ticket: Ticket,
  pr: GitPullRequest,
  review: MessageSquare,
  commit: GitCommitHorizontal,
  test: FlaskConical,
  note: StickyNote,
}

/** A source written as a ref reads in the mono face; one written as words reads in Inter. */
const SOURCE_MONO: Record<MemorySourceKind, boolean> = {
  ticket: true,
  pr: true,
  review: false,
  commit: true,
  test: false,
  note: false,
}

export interface MemoryPageViewProps {
  page: MemoryPage
  /** The row the list holds for this page: its usage, its cold mark and its contradiction. */
  row: MemoryPageSummary | null
  /** Every page's title by slug, so Linked pages and the banner read as names and not as slugs. */
  titles: Record<string, { title: string; kind: MemoryPage['kind'] }>
  revisions: MemoryRevision[]
  onOpen(slug: string): void
  onEdit(): void
  onPin(pinned: boolean): void
  onArchive(): void
  onRestore(commit: string): void
  now?: number
}

/**
 * The open page (frames `E40vSb`, `I44S1a`), as utilities.
 *
 * `memory-front`, `memory-front__chip`, `memory-uses` and `memory-body` stay in the lists because
 * the suite reads all four: `MemoryScreen.dom.test.tsx` counts the chips and looks for the avatar
 * inside `.memory-front dd`, and `MemoryEditor.dom.test.tsx` asserts the preview carries
 * `memory-body`.
 *
 * `FRONT_CHIP`, `FRONT_CHIP_MONO`, `USES`, `LINK_TITLE`, `LINK_KIND` and `FOOTER` are named rather
 * than inlined because `ui/line-boxes.test.ts` pins their line boxes: each was read off a PNG, and
 * the test fails if one of them ever goes back to `normal`.
 */
export const PAGE = 'flex min-h-0 flex-1 flex-col'

/* The frame draws the rule inside its own 8px, so the bottom padding gives back its width. */
export const BAR =
  'flex items-center gap-6 border-b border-border bg-card px-16 pt-8 pb-7 [&_[data-slot=button]]:gap-8 [&_[data-slot=button]]:px-10 [&_[data-slot=button]]:py-6 [&_[data-slot=button]]:text-12 [&_[data-slot=button][data-variant=outline]]:px-9 [&_[data-slot=button][data-variant=outline]]:py-5 [&_[data-slot=button][data-variant=primary]]:px-12 [&_[data-slot=button][data-variant=primary]]:py-6 [&_[data-slot=button]_svg]:size-13'

/* The whole path; the ellipsis is for a pane too narrow to hold it, not for every pane. */
export const PATH =
  'memory-page__path min-w-0 shrink grow-0 basis-auto overflow-hidden text-ellipsis whitespace-nowrap font-code text-12/[normal] text-muted-foreground'

/* A block of the page keeps its height and the pane scrolls, rather than squeezing it. */
const SCROLL = 'flex min-h-0 flex-1 flex-col gap-14 overflow-auto bg-code px-40 py-20 [&>*]:shrink-0'

/* The rule is drawn inside the frame's own 12px, so the left padding gives back its width. */
const CLASH =
  'flex items-center gap-12 rounded-sm border-l-3 border-l-status-warning-foreground bg-status-warning py-10 pr-12 pl-9'

const CLASH_TITLE = 'font-semibold text-13/[normal] text-status-warning-foreground'

const CLASH_BODY = 'm-0 text-12/18 text-status-warning-foreground [&_code]:font-code [&_code]:text-11-5'

const CLASH_REVIEW =
  'gap-6 border-status-warning-foreground px-9 py-5 text-12 text-status-warning-foreground [&_[data-slot=button-label]]:inline-flex [&_[data-slot=button-label]]:items-center [&_[data-slot=button-label]]:gap-6'

const TITLE = 'm-0 font-bold text-24/[normal] tracking-[-0.4px] text-foreground'

const FRONT =
  'memory-front m-0 grid grid-cols-[64px_1fr] gap-x-6 gap-y-8 border-b border-border pb-14 [&_dt]:self-center [&_dt]:font-code [&_dt]:text-11/[normal] [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:flex [&_dd]:flex-wrap [&_dd]:items-center [&_dd]:gap-6'

/*
 * Every value carries its own mark: the kind, the repo, where it came from. The frame's 19px chip:
 * `normal` on 11px rounds the row up and the whole page down a pixel.
 *
 * The mono one is a **whole list, not an override.** `.--mono` used to say `font-size: 10.5px;
 * line-height: 14px` and win by coming later in the sheet; two `text-*` utilities on one element are
 * settled by Tailwind's own emission order instead, and `text-11/13` kept its 13px line — which drew
 * the two mono rows 19px where the frame draws them 20, and pulled the whole page up 2px until the
 * pixel table caught it. So the box is written out twice rather than patched once.
 */
const FRONT_CHIP =
  'memory-front__chip inline-flex items-center gap-5 whitespace-nowrap rounded-full bg-secondary px-8 py-3 font-sans font-semibold text-11/13 text-soft-ink [&_svg]:flex-none [&_svg]:text-muted-foreground'

/* The machine's font sits taller in the same chip, and the frame draws that row 20px. */
const FRONT_CHIP_MONO =
  'memory-front__chip inline-flex items-center gap-5 whitespace-nowrap rounded-full bg-secondary px-8 py-3 font-code font-normal text-10-5/14 text-soft-ink [&_svg]:flex-none [&_svg]:text-muted-foreground'

const NOTE = 'text-12/[normal] text-soft-ink'

/* 19px, like the chips beside it: it is what the `updated` row is as tall as. */
const USES =
  'memory-uses ml-auto inline-flex items-center gap-5 rounded-full bg-primary-subtle px-8 py-3 font-semibold text-11/13 text-status-info-foreground'

const HISTORY = 'm-0 list-none rounded-sm border border-border p-0'

const HISTORY_ROW = 'flex items-center gap-10 border-b border-border px-12 py-8 text-12/[normal] last:border-b-0'

const HISTORY_SUBJECT = 'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground'

const HISTORY_RESTORE = 'cursor-pointer bg-transparent font-sans text-12/[normal] text-primary'

const HISTORY_EMPTY = 'cursor-default bg-transparent px-12 py-8 font-sans text-12/[normal] text-muted-foreground'

const LINKS_TITLE = 'mt-0 mb-8 font-bold text-11/[normal] uppercase tracking-[0.5px] text-muted-foreground'

/*
 * Cards of one width, as many across as the pane holds — three, at the frame's width. Each hugs its
 * own title: `E40vSb` draws the two-line one taller than the rest rather than squaring them.
 */
const LINKS_ROW = 'grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] items-start gap-8'

const LINK =
  'flex cursor-pointer flex-col gap-3 rounded-sm border border-input bg-muted px-10 py-8 text-left disabled:cursor-default disabled:opacity-60'

const LINK_TITLE =
  'flex items-center gap-6 font-semibold text-12/15 text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground'

const LINK_KIND = 'text-11/13 text-muted-foreground'

/* `normal` is 15px here and the frames draw the row 34: both of them put the rule at 909. */
export const FOOTER =
  'flex items-center gap-8 border-t border-border bg-card px-16 py-10 text-12/14 text-muted-foreground [&_svg]:flex-none'

/*
 * The rendered page. Every one of these was a `.memory-body <element>` rule: the markdown comes back
 * as real `h2`/`p`/`ul`/`pre` elements with no class of their own, so the container reaches them.
 *
 * `[&_pre_code]` beats `[&_code]` on specificity, which is what lets the fenced block keep the
 * block's own size and leading where an inline `code` sets its own.
 */
export const BODY =
  'memory-body text-13-5/[1.6] text-soft-ink [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h2]:my-14 [&_h2]:font-bold [&_h2]:text-15/[normal] [&_h2]:text-foreground [&_h3]:my-14 [&_h3]:font-bold [&_h3]:text-15/[normal] [&_h3]:text-foreground [&_p]:mt-0 [&_p]:mr-0 [&_p]:mb-14 [&_p]:ml-0 [&_ul]:mt-0 [&_ul]:mr-0 [&_ul]:mb-14 [&_ul]:ml-0 [&_ul]:pl-22 [&_ol]:mt-0 [&_ol]:mr-0 [&_ol]:mb-14 [&_ol]:ml-0 [&_ol]:pl-22 [&_li]:mb-6 [&_li::marker]:text-muted-foreground [&_code]:rounded-xs [&_code]:bg-muted [&_code]:px-5 [&_code]:py-1 [&_code]:font-code [&_code]:text-12-5/[1.6] [&_pre]:mt-0 [&_pre]:mr-0 [&_pre]:mb-14 [&_pre]:ml-0 [&_pre]:overflow-auto [&_pre]:rounded-sm [&_pre]:border [&_pre]:border-border [&_pre]:bg-veil-soft [&_pre]:px-13 [&_pre]:py-9 [&_pre]:text-12/20 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-code-foreground [&_pre_code]:[font-size:inherit] [&_pre_code]:leading-[inherit] [&_blockquote]:mt-0 [&_blockquote]:mr-0 [&_blockquote]:mb-14 [&_blockquote]:ml-0 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:py-2 [&_blockquote]:pr-0 [&_blockquote]:pl-12 [&_blockquote]:text-muted-foreground'

/**
 * The open page (frame `E40vSb`): the path bar and its actions, the contradiction banner, the
 * front matter, the body, and what it links to. Every action here is a commit in the memory repo.
 *
 * Whoever opens it keys it by slug, so another page opens with its history shut (T211).
 */
export function MemoryPageView(props: MemoryPageViewProps) {
  const { page, row } = props
  const now = props.now ?? Date.now()
  const [showHistory, setShowHistory] = useState(false)
  const uses = row ? usesChip(row) : null
  const KindIcon = KIND_ICON[page.kind]

  return (
    <div className={PAGE} data-ui="Memory page">
      <div className={BAR}>
        {/* The whole path, and an ellipsis only when the pane is too narrow to hold it. */}
        <span className={PATH}>{pagePath(page)}</span>
        <div className="ml-auto flex items-center gap-6">
          <Button variant="outline" size="sm" icon={Pencil} onClick={props.onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" icon={page.pinned ? PinOff : Pin} onClick={() => props.onPin(!page.pinned)}>
            {page.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={History}
            aria-expanded={showHistory}
            onClick={() => setShowHistory((open) => !open)}
          >
            {historyLabel(props.revisions.length)}
          </Button>
          <Button variant="ghost" size="sm" icon={Archive} onClick={props.onArchive} disabled={page.archived}>
            {page.archived ? 'Archived' : 'Archive'}
          </Button>
        </div>
      </div>

      <div className={SCROLL}>
        {row?.contradiction && (
          <div className={CLASH} role="note">
            <Split className="flex-none text-status-warning-foreground" size={16} aria-hidden />
            <div className="flex flex-1 flex-col gap-3">
              <div className={CLASH_TITLE}>Possible contradiction with ‘{row.contradiction.title}’</div>
              <p className={CLASH_BODY}>
                This page says <code>{row.contradiction.term}</code> is {row.contradiction.values[0]}; that one says{' '}
                {row.contradiction.values[1]}. {CONTRADICTION_EXPLANATION}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className={CLASH_REVIEW}
              onClick={() => props.onOpen(row.contradiction!.slug)}
            >
              Review
              <ArrowRight size={12} aria-hidden />
            </Button>
          </div>
        )}

        <h2 className={TITLE}>{page.title}</h2>

        <dl className={FRONT}>
          <dt>kind</dt>
          <dd>
            <FrontChip icon={KindIcon}>{MEMORY_KIND_LABEL[page.kind]}</FrontChip>
            {page.pinned && (
              <Badge size="sm" variant="primary">
                Pinned
              </Badge>
            )}
          </dd>
          {page.repos.length > 0 && (
            <>
              <dt>repos</dt>
              <dd>
                {page.repos.map((repo) => (
                  <FrontChip key={repo} icon={FolderGit2} mono>
                    {repo}
                  </FrontChip>
                ))}
              </dd>
            </>
          )}
          {page.sources.length > 0 && (
            <>
              <dt>sources</dt>
              <dd>
                {page.sources.map((source) => (
                  <FrontChip
                    key={`${source.kind}:${source.ref}`}
                    icon={SOURCE_ICON[source.kind]}
                    mono={SOURCE_MONO[source.kind]}
                  >
                    {sourceLabel(source)}
                  </FrontChip>
                ))}
              </dd>
            </>
          )}
          {page.handoff && (
            <>
              <dt>handoff</dt>
              <dd>
                <Badge
                  size="sm"
                  variant={
                    page.handoff.state === 'open' ? 'warning' : page.handoff.state === 'claimed' ? 'success' : 'neutral'
                  }
                >
                  {page.handoff.state}
                </Badge>
                {page.handoff.claimedBy && <span className={NOTE}>claimed by {page.handoff.claimedBy}</span>}
              </dd>
            </>
          )}
          <dt>updated</dt>
          <dd>
            <Avatar name={page.updatedBy} size={18} tone="primary" />
            <span className={NOTE}>
              {page.updatedBy} · {whenLabel(page.updatedAt, now)}
            </span>
            {uses && (
              <span className={USES}>
                <Flame size={11} aria-hidden />
                {uses}
              </span>
            )}
          </dd>
        </dl>

        {showHistory && (
          <ol className={HISTORY} aria-label="History">
            {props.revisions.length === 0 && <li className={HISTORY_EMPTY}>No commits yet.</li>}
            {props.revisions.map((revision) => (
              <li key={revision.commit} className={HISTORY_ROW}>
                <code>{revision.commit.slice(0, 7)}</code>
                <span className="font-medium text-foreground">{revision.author}</span>
                <span className="text-muted-foreground">{whenLabel(revision.at, now)}</span>
                <span className={HISTORY_SUBJECT}>{revision.subject}</span>
                <button
                  type="button"
                  className={cx(SHELL_BUTTON, HISTORY_RESTORE)}
                  onClick={() => props.onRestore(revision.commit)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ol>
        )}

        <MarkdownBody source={page.body} className={BODY} />

        {page.links.length > 0 && (
          <section className="m-0 border-border border-t pt-11">
            <h3 className={LINKS_TITLE}>Linked pages</h3>
            <div className={LINKS_ROW}>
              {page.links.map((slug) => {
                const linked = props.titles[slug]
                const Icon = KIND_ICON[linked?.kind ?? 'glossary']
                return (
                  <button
                    key={slug}
                    type="button"
                    className={cx(SHELL_BUTTON, LINK)}
                    onClick={() => props.onOpen(slug)}
                    disabled={!linked}
                  >
                    <span className={LINK_TITLE}>
                      <Icon size={12} aria-hidden />
                      {linked?.title ?? slug}
                    </span>
                    <span className={LINK_KIND}>{linked ? MEMORY_KIND_LABEL[linked.kind] : 'not written yet'}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <footer className={FOOTER}>
        <Plug size={13} aria-hidden />
        <span>
          Employees read and write this through the memory MCP tools. Every edit is a commit — History shows who changed
          what.
        </span>
      </footer>
    </div>
  )
}

/** One value of the front matter: its own icon, then what it says (frame `E40vSb`). */
function FrontChip({ icon: Icon, mono, children }: { icon: LucideIcon; mono?: boolean; children: ReactNode }) {
  return (
    <span className={mono ? FRONT_CHIP_MONO : FRONT_CHIP}>
      <Icon size={11} aria-hidden />
      {children}
    </span>
  )
}
