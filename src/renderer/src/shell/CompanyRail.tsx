import { Plus } from 'lucide-react'
import type { Company, CompanyAttention } from '../../../shared/company'
import { LogoIcon } from '../brand'
import { type MenuAnchor, pointerAnchor } from '../company-removal'
import { cx, initialsOf, SHELL_BUTTON } from '../ui'
import { railMarks } from './rail-marks'
import '../ui/tailwind.css'

/**
 * The App Mark (inert for now), then one tile per known Company — its logo, or its initials (T280); the open one carries the
 * white marker and ring. An open Company's tile also says what it needs (T145): a badge with what
 * waits on the boss, a quieter dot while it works. A Company that is not open has no marks.
 */
export function CompanyRail(props: {
  companies: Company[]
  currentId: string | null
  onSwitch(id: string): void
  onCreate(): void
  /** Right click on an avatar: the Company's actions (Remove from launcher, Delete company…). */
  onMenu?(company: Company, anchor: MenuAnchor): void
  /** Each open Company's marks, by id; a Company missing from it draws none. */
  attention?: ReadonlyMap<string, CompanyAttention>
}) {
  return (
    <nav className={RAIL} data-ui="Company Rail" aria-label="Companies">
      <div className="h-34 w-34 shrink-0 [&>svg]:block" aria-hidden>
        <LogoIcon />
      </div>
      <div className="h-1 w-28 shrink-0 bg-[#ffffff24]" aria-hidden />
      {props.companies.map((company) => {
        const active = company.id === props.currentId
        const marks = railMarks(company.name, props.attention?.get(company.id))
        return (
          <div key={company.id} data-ui="Rail Slot" className="relative h-44 w-full shrink-0">
            {active && (
              <div
                data-ui="Rail Marker"
                className="absolute top-12 left-0 h-20 w-3 rounded-full bg-white"
                aria-hidden
              />
            )}
            <button
              type="button"
              data-ui="Company Tile"
              className={cx(SHELL_BUTTON, TILE, active && 'outline-2 outline-white')}
              aria-label={marks.label}
              aria-current={active ? 'true' : undefined}
              title={`${company.name}\n${company.folder}`}
              onClick={() => active || props.onSwitch(company.id)}
              onContextMenu={(event) => {
                if (!props.onMenu) return
                event.preventDefault()
                props.onMenu(company, pointerAnchor(event))
              }}
            >
              {company.logo ? (
                <img src={company.logo} alt="" className="size-full rounded-sm object-cover" draggable={false} />
              ) : (
                initialsOf(company.name)
              )}
            </button>
            {marks.working && <span className={WORKING} data-ui="Rail Working" aria-hidden />}
            {marks.badge && (
              <span className={BADGE} data-ui="Rail Badge" aria-hidden>
                {marks.badge}
              </span>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className={cx(SHELL_BUTTON, ADD)}
        aria-label="New Company"
        title="New Company"
        onClick={props.onCreate}
      >
        <Plus size={18} aria-hidden />
      </button>
    </nav>
  )
}

/*
 * The Company Rail (design/html/office.html), as utilities (T210f). Its colours are the rail's own
 * — `#080d18` the strip, and three washes of white over it — and no token names any of them.
 */
const RAIL =
  'flex h-full w-68 shrink-0 flex-col items-center gap-10 overflow-y-auto bg-[#080d18] py-14 [scrollbar-width:none]'

const TILE =
  'absolute top-2 left-16 flex h-40 w-40 items-center justify-center whitespace-nowrap rounded-sm bg-secondary p-0 font-bold text-13/normal text-[#cbd5e1]'

/*
 * What an open Company needs, measured off frame `u9sLao` (T145, T251). The slot is 44 tall and as
 * wide as the rail, and the tile is 40x40 at (16, 2) inside it.
 *
 * The badge is **red**, not the app's indigo accent: a number here means something waits on the
 * boss, which is the one thing this app draws in `--destructive`. Its fill is 18px tall and its
 * ring 2px, so the box is 22 — the border *is* the ring, which is why these are border-box and not
 * the content-box the 16px version was. The frame puts the fill at x = 44 for one digit and x = 40
 * for two (`9+` is the widest it goes), so the box is centred on x = 52.5 and both land within half
 * a pixel of the frame rather than one of them landing on it and the other four pixels out.
 *
 * The ring is `#000000`, which is what the frame strokes both marks with — not `#080d18`, the
 * rail's own fill. On the rail they are a shade apart and indistinguishable; where the ring crosses
 * a tile the frame's is the darker one, and matching it takes the audit from 5.27% to 3.05%.
 *
 * The working dot is the office's live tone, 10px with the same 2px ring, at (49, 35) in the
 * frame — a 14px box at (47, 33).
 */
const BADGE =
  'pointer-events-none absolute top-[-5px] left-[52.5px] inline-flex h-22 min-w-22 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[#000000] bg-destructive px-6 font-bold text-10-5/[1] text-destructive-foreground'

const WORKING =
  'pointer-events-none absolute top-33 left-47 h-14 w-14 rounded-full border-2 border-[#000000] bg-brand-success'

const ADD =
  'flex h-40 w-40 shrink-0 items-center justify-center rounded-sm border border-[#ffffff33] p-0 text-[#ffffff99] hover:text-white'
