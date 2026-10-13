import { FolderGit2, FolderOpen } from 'lucide-react'
import { MEMORY_KIND_LABEL } from '../../../shared/memory/company-memory'
import { Button } from '../ui'
import { KIND_ICON } from './MemoryList'
import { HOW_IT_FILLS, HOW_IT_FILLS_BODY, HOW_IT_FILLS_TITLE } from './memory-view'

/**
 * Frame `SlxSy`'s reading pane, as utilities. The two `svg` rules the sheet carried — the kind head's
 * and the folder row's, both `flex: none` and muted — are arbitrary variants here, because the icon
 * is a lucide component and the rule was reaching past it.
 */
const FILLS = 'flex min-h-0 flex-1 flex-col gap-22 overflow-auto px-56 py-40'

const EYEBROW = 'font-bold text-11/[normal] uppercase tracking-[0.5px] text-muted-foreground'

const TITLE = 'm-0 font-bold text-24/[normal] tracking-[-0.4px] text-foreground'

/* Two columns, as the frame draws three rows of two; one below the frame's own width. */
const KINDS = 'grid grid-cols-[repeat(2,minmax(0,1fr))] gap-10 [@media(max-width:900px)]:grid-cols-[minmax(0,1fr)]'

/* The frame measures its 14px from the card's own edge, so the stroke comes out of it. */
const KIND = 'flex flex-col gap-6 rounded-md border border-border bg-card p-13'

const KIND_HEAD =
  'flex items-center gap-8 font-semibold text-13/[normal] text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground'

const WHERE =
  'flex items-center gap-12 rounded-sm bg-secondary px-14 py-12 [&_svg]:flex-none [&_svg]:text-muted-foreground'

const PATH = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-11-5/[normal] text-muted-foreground'

/**
 * The reading pane of frame `SlxSy`: what a Company with no page at all is shown in place of a
 * page.
 *
 * Every Company starts here — nothing writes a page until a ticket closes — so this is the Memory
 * screen most of them show, and "Pick a page to read it." over an empty list was the app telling
 * the boss to do something there was nothing to do (T181).
 */
export function MemoryHowItFills({
  companyName,
  folder,
  onOpenFolder,
}: {
  companyName: string
  /** Where the markdown lives, as the boss would type it; null until the engine has answered. */
  folder: string | null
  onOpenFolder(): void
}) {
  return (
    <div className={FILLS} data-ui="How memory fills">
      <div className="flex flex-col gap-6">
        <span className={EYEBROW}>How it fills</span>
        <h2 className={TITLE}>{HOW_IT_FILLS_TITLE(companyName)}</h2>
        <p className="m-0 text-13-5/[1.5] text-muted-foreground">{HOW_IT_FILLS_BODY}</p>
      </div>
      <div className={KINDS}>
        {HOW_IT_FILLS.map((entry) => {
          const Icon = KIND_ICON[entry.kind]
          return (
            <div className={KIND} key={entry.kind}>
              <span className={KIND_HEAD}>
                <Icon size={14} aria-hidden />
                {MEMORY_KIND_LABEL[entry.kind]}
              </span>
              <span className="text-12-5/[1.5] text-foreground">{entry.what}</span>
              <span className="text-11-5/[1.5] text-muted-foreground">{entry.from}</span>
            </div>
          )
        })}
      </div>
      {folder && (
        <div className={WHERE}>
          <FolderGit2 size={15} aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="font-semibold text-13/[normal] text-foreground">
              Plain markdown in your Company folder
            </span>
            <span className={PATH}>{folder}</span>
          </span>
          <Button variant="outline" size="sm" icon={FolderOpen} onClick={onOpenFolder}>
            Open in Files
          </Button>
        </div>
      )}
    </div>
  )
}
