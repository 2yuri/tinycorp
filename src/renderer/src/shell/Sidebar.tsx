import {
  Activity,
  BookMarked,
  ChevronDown,
  ChevronsUpDown,
  EllipsisVertical,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitPullRequest,
  Inbox,
  Info,
  type LucideIcon,
  Map as MapIcon,
  MessageSquare,
  OctagonAlert,
  Pencil,
  Plus,
  Settings,
  SquareKanban,
  Trash2,
  TriangleAlert,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { BOSS_STATUS_LABEL } from '../../../shared/boss-profile'
import type { Company } from '../../../shared/company'
import { useChannelDelete } from '../chat'
import { type Route, sameRoute, VIEW_LABEL, type ViewId } from '../chrome'
import { Avatar, cx, DropdownMenu, initialsOf, MenuDivider, MenuItem, RepoMarkIcon, SHELL_BUTTON } from '../ui'
import { UsageButton } from '../usage'
import {
  type ChildMarker,
  companyPlan,
  type MarkerFace,
  type NavChild,
  type NavEntry,
  navTree,
  type ShellData,
} from './nav-model'
import { SidebarSearch } from './SidebarSearch'
import '../ui/tailwind.css'

const VIEW_ICON: Record<ViewId, LucideIcon> = {
  office: MapIcon,
  chat: MessageSquare,
  board: SquareKanban,
  employees: UsersRound,
  repositories: FolderGit2,
  files: FolderTree,
  memory: BookMarked,
  activity: Activity,
  settings: Settings,
  profile: UserRound,
}

export interface SidebarProps {
  company: Company
  companies: Company[]
  data: ShellData
  route: Route
  onNavigate(route: Route): void
  onSwitch(id: string): void
  onCreate(): void
  onOpen(): void
}

/** The Company drawer: switcher, search, the navigation tree, Company settings, Usage and the boss. */
export function Sidebar(props: SidebarProps) {
  const { route, onNavigate } = props
  // Which view's tree the boss folded away, so moving to another one opens the drawer again (T211).
  const [collapsedView, setCollapsedView] = useState<ViewId | null>(null)
  const collapsed = collapsedView === route.view
  const [menu, setMenu] = useState<'switcher' | 'boss' | null>(null)
  // Delete channel… on a channel row; it asks first and the engine tells every view (T112).
  const channelDelete = useChannelDelete()

  function openView(view: ViewId) {
    if (route.view !== view) return onNavigate({ view } as Route)
    if (sameRoute(route, { view } as Route)) return setCollapsedView((was) => (was === view ? null : view))
    onNavigate({ view } as Route)
  }

  function pick(action: () => void) {
    setMenu(null)
    action()
  }

  return (
    <aside className={SIDEBAR} data-ui="Company Drawer">
      <div className={DRAWER_HEAD}>
        <button
          type="button"
          className={cx(SHELL_BUTTON, SWITCHER)}
          aria-haspopup="menu"
          aria-expanded={menu === 'switcher'}
          onClick={() => setMenu(menu === 'switcher' ? null : 'switcher')}
        >
          <span data-ui="Switcher Initials" className={SWITCHER_AVATAR}>
            {initialsOf(props.company.name)}
          </span>
          <span className={STACK}>
            <span
              data-ui="Company Name"
              className="truncate font-bold text-14/normal text-foreground tracking-[-0.2px]"
            >
              {props.company.name}
            </span>
            <span data-ui="Company Plan" className="truncate font-normal text-11/normal text-muted-foreground">
              {companyPlan(props.data)}
            </span>
          </span>
          <ChevronsUpDown size={15} aria-hidden />
        </button>
        <SidebarSearch data={props.data} companyKey={props.company.key} />
      </div>

      {menu === 'switcher' && (
        <Popover placement="below" onClose={() => setMenu(null)}>
          {props.companies.map((company) => (
            <MenuItem
              key={company.id}
              label={company.name}
              highlighted={company.id === props.company.id}
              onClick={() => pick(() => company.id !== props.company.id && props.onSwitch(company.id))}
            />
          ))}
          <MenuDivider />
          <MenuItem icon={Plus} label="New Company…" onClick={() => pick(props.onCreate)} />
          <MenuItem icon={FolderOpen} label="Open Company…" onClick={() => pick(props.onOpen)} />
        </Popover>
      )}

      <nav className={NAV} aria-label="Company">
        {/* Only the tree scrolls: Company settings stays pinned above the footer however long the
            tree grows, as the frame draws it (T147). */}
        <div data-ui="Nav Scroll" className={NAV_SCROLL}>
          {navTree(props.data, collapsed ? null : route.view).map((entry) => {
            const active = route.view === entry.view
            const expanded = active && !collapsed && entry.children.length > 0
            return (
              <NavGroup
                key={entry.view}
                entry={entry}
                active={active}
                expanded={expanded}
                onClick={() => openView(entry.view)}
              >
                {expanded &&
                  entry.children.map((child) => (
                    <ChildRow
                      key={child.key}
                      child={child}
                      route={route}
                      onNavigate={onNavigate}
                      onRemove={channelDelete.ask}
                    />
                  ))}
              </NavGroup>
            )
          })}
        </div>
        <div data-ui="Nav Pinned" className="flex w-full shrink-0 flex-col px-12 pt-2 pb-12">
          <NavRow
            icon={VIEW_ICON.settings}
            label={VIEW_LABEL.settings}
            active={route.view === 'settings'}
            onClick={() => onNavigate({ view: 'settings' })}
          />
        </div>
      </nav>

      <UsageButton />

      <div className={cx(FOOTER, route.view === 'profile' && 'bg-secondary')} data-ui="Drawer Footer">
        {/* The row opens Your profile, where the boss picks the character it draws (T79). */}
        <button
          type="button"
          data-ui="Open Profile"
          className={cx(SHELL_BUTTON, FOOTER_OPEN)}
          aria-current={route.view === 'profile' ? 'page' : undefined}
          onClick={() => onNavigate({ view: 'profile' })}
        >
          <Avatar
            data-ui="Boss Initials"
            className={FOOTER_AVATAR}
            name={props.company.boss.name}
            size={34}
            sprite={props.company.boss.sprite}
            text={props.company.boss.initials}
          />
          <span className={STACK}>
            <span data-ui="Boss Name" className="truncate font-semibold text-13/normal text-foreground">
              {props.company.boss.name}
            </span>
            <span data-ui="Boss Status" className={STATUS} data-status={props.company.boss.status ?? 'available'}>
              {BOSS_STATUS_LABEL[props.company.boss.status ?? 'available']}
            </span>
          </span>
        </button>
        <button
          type="button"
          className={cx(SHELL_BUTTON, FOOTER_MORE)}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={menu === 'boss'}
          onClick={() => setMenu(menu === 'boss' ? null : 'boss')}
        >
          <EllipsisVertical size={16} aria-hidden />
        </button>
      </div>

      {channelDelete.overlay}

      {menu === 'boss' && (
        <Popover placement="above" onClose={() => setMenu(null)}>
          <MenuItem
            icon={UserRound}
            label={VIEW_LABEL.profile}
            onClick={() => pick(() => onNavigate({ view: 'profile' }))}
          />
          <MenuItem
            icon={Settings}
            label="Company settings"
            onClick={() => pick(() => onNavigate({ view: 'settings' }))}
          />
          <MenuDivider />
          <MenuItem icon={Plus} label="New Company…" onClick={() => pick(props.onCreate)} />
          <MenuItem icon={FolderOpen} label="Open Company…" onClick={() => pick(props.onOpen)} />
        </Popover>
      )}
    </aside>
  )
}

function NavGroup(props: {
  entry: NavEntry
  active: boolean
  expanded: boolean
  onClick(): void
  children: ReactNode
}) {
  const { entry } = props
  return (
    <>
      <NavRow
        icon={VIEW_ICON[entry.view]}
        label={entry.label}
        count={entry.count}
        badge={entry.badge}
        active={props.active}
        expanded={props.expanded}
        onClick={props.onClick}
      />
      {props.children}
    </>
  )
}

function NavRow(props: {
  icon: LucideIcon
  label: string
  count?: number | undefined
  /** Draws the count as the Needs You pill rather than a soft total (T251). */
  badge?: true | undefined
  active: boolean
  expanded?: boolean
  onClick(): void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      className={cx(SHELL_BUTTON, ITEM, props.active ? ITEM_ON : ITEM_OFF)}
      aria-current={props.active ? 'page' : undefined}
      aria-expanded={props.expanded}
      onClick={props.onClick}
    >
      <Icon size={17} aria-hidden />
      <span data-ui="Nav Label" className={cx(LABEL, 'text-13/normal', props.active ? LABEL_ON : LABEL_OFF)}>
        {props.label}
      </span>
      {props.count !== undefined && (
        <span data-ui="Nav Count" className={props.badge ? BADGE : cx(COUNT, 'text-11/normal')}>
          {props.count}
        </span>
      )}
      {props.expanded && <ChevronDown className="shrink-0 text-muted-foreground" size={14} aria-hidden />}
    </button>
  )
}

/** One row under an open view: a section label, or a channel, DM, pair, epic, role or repo. */
export function ChildRow(props: {
  child: NavChild
  route: Route
  onNavigate(route: Route): void
  /** Runs the row's destructive action, where it has one: deleting its channel (T112). */
  onRemove?(channelId: string): void
}) {
  const { child } = props
  if (child.kind === 'section')
    return (
      <div data-ui="Nav Section" className={SECTION}>
        {child.label}
      </div>
    )
  const active = sameRoute(child.route, props.route)
  // Something landed here since the boss last looked, so the row's `#` reads as loudly as its name
  // does (T251): `CHILD_UNREAD` is a two-part selector, which beats the marker's own one class.
  const row = (
    <button
      type="button"
      data-ui="Nav Child"
      className={cx(SHELL_BUTTON, CHILD, active ? 'bg-card' : CHILD_OFF, child.unread && CHILD_UNREAD)}
      aria-current={active ? 'page' : undefined}
      onClick={() => props.onNavigate(child.route)}
    >
      <Marker marker={child.marker} />
      <span
        data-ui="Nav Label"
        className={cx(LABEL, 'text-12-5/normal', child.unread ? LABEL_UNREAD : active ? LABEL_ON : LABEL_OFF)}
      >
        {child.label}
      </span>
      {child.drafted && (
        // The boss left a message unsent here (TI-1). The kit's pencil for now; the Pen frame follows.
        <span
          data-ui="Nav Draft"
          className="flex shrink-0 text-muted-foreground"
          role="img"
          aria-label="Unsent draft"
          title="Unsent draft"
        >
          <Pencil size={12} aria-hidden />
        </span>
      )}
      {child.count !== undefined && (
        <span data-ui="Nav Count" className={child.badge ? BADGE : cx(COUNT, 'text-10-5/normal')}>
          {child.count}
        </span>
      )}
      {child.time !== undefined && (
        <span className="shrink-0 whitespace-nowrap text-10-5/normal text-muted-foreground">{child.time}</span>
      )}
      {child.warning && (
        <span
          className="flex shrink-0 text-status-error-foreground"
          role="img"
          aria-label={child.warning}
          title={child.warning}
        >
          <TriangleAlert size={13} aria-hidden />
        </span>
      )}
      {child.hint && (
        <span className="flex shrink-0 text-muted-foreground" role="img" aria-label={child.hint} title={child.hint}>
          <Info size={13} aria-hidden />
        </span>
      )}
    </button>
  )
  const { edit, remove } = child
  const onRemove = props.onRemove
  if (!edit && !(remove && onRemove)) return row
  // A child row with a secondary action: the pencil shows on hover, over the count.
  return (
    <div className="relative w-full" data-child-row>
      {row}
      {edit && (
        <button
          type="button"
          className={cx(SHELL_BUTTON, CHILD_ACTION)}
          aria-label={edit.label}
          title={edit.label}
          onClick={() => props.onNavigate(edit.route)}
        >
          <Pencil size={12} aria-hidden />
        </button>
      )}
      {/* Delete channel… on a channel row (T112): the same affordance, in the error colour. */}
      {remove && onRemove && (
        <button
          type="button"
          className={cx(SHELL_BUTTON, CHILD_ACTION, CHILD_REMOVE)}
          aria-label={remove.label}
          title={remove.label}
          onClick={() => onRemove(remove.channelId)}
        >
          <Trash2 size={12} aria-hidden />
        </button>
      )}
    </div>
  )
}

const CHILD_ICON = { inbox: Inbox, blocked: OctagonAlert, 'pull-request': GitPullRequest } as const

/** What marks a child row on its left: a hash, a dot, an Employee's avatar or an icon. */
export function Marker({ marker }: { marker: ChildMarker }) {
  switch (marker.kind) {
    case 'hash':
      return (
        <span data-ui="Hash" className="shrink-0 font-semibold text-13/normal text-muted-foreground" aria-hidden>
          #
        </span>
      )
    case 'dot':
      return <span data-ui="Dot" className="h-6 w-6 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
    case 'avatar':
      return <Face face={marker} />
    // Two 20px faces, the second 14px in, as the design's Between agents rows draw a pair.
    case 'pair':
      return (
        <span className={FACES} aria-hidden>
          <Face face={marker.faces[0]} />
          <Face face={marker.faces[1]} />
        </span>
      )
    case 'icon': {
      if (marker.icon === 'repo') return <RepoMarkIcon size={14} aria-hidden />
      const Icon = CHILD_ICON[marker.icon]
      return <Icon size={14} aria-hidden />
    }
  }
}

function Face({ face }: { face: MarkerFace }) {
  return <Avatar name={face.name} person={{ id: face.employeeId, sprite: face.sprite }} size={20} />
}

/** A menu anchored in the sidebar that closes on an outside click or Escape. */
function Popover(props: { placement: 'below' | 'above'; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = props
  useEffect(() => {
    function onPointer(event: PointerEvent) {
      const target = event.target as Element
      // The toggle that opened the menu closes it itself.
      if (!ref.current?.contains(target) && !target.closest('[aria-haspopup]')) onClose()
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    // Defer so the click that opened the menu does not close it.
    const timer = setTimeout(() => document.addEventListener('pointerdown', onPointer))
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} className={cx(POPOVER, props.placement === 'above' ? 'bottom-64' : 'top-72')}>
      <DropdownMenu>{props.children}</DropdownMenu>
    </div>
  )
}

/*
 * The Company Drawer (design/html/office.html: Company Drawer), as utilities (T210f).
 *
 * `#cbd5e1` is the shell's soft ink and `#ffffff0f` the wash a row takes under the pointer; neither
 * has a token. Pen draws strokes inside the box, so the header's 1px border takes from its padding.
 *
 * Exported because a capture harness draws the drawer's own surface around one row of it, and a
 * harness with its own copy of the frame is the drift `design:compare` exists to catch.
 */
export const SIDEBAR = 'relative flex h-full w-276 shrink-0 flex-col border-r border-r-border bg-card'

const DRAWER_HEAD = 'flex w-full shrink-0 flex-col gap-12 border-b border-b-border px-16 pt-16 pb-11'

const SWITCHER = 'flex w-full shrink-0 items-center gap-10 rounded-sm bg-secondary px-10 py-8 text-muted-foreground'

const SWITCHER_AVATAR =
  'flex h-32 w-32 shrink-0 items-center justify-center whitespace-nowrap rounded-sm bg-secondary font-bold text-12/normal text-[#cbd5e1]'

/** A name over a line, both of which truncate rather than widening the drawer. */
const STACK = 'flex min-w-0 flex-1 basis-0 flex-col gap-1 whitespace-nowrap'

/**
 * The nav is the tree, which scrolls, over Company settings, which does not: however long the tree
 * grows, the settings row stays pinned above the footer, as the frame draws it (T147).
 */
const NAV = 'flex min-h-0 w-full flex-1 basis-0 flex-col'

/**
 * With no scrollbar, the rows fade out at an edge while there is more past it. The two lengths the
 * mask reads are registered properties animated by the scroll itself; both they and the keyframes
 * are in `ui/tailwind.css`, because a registered custom property is document-scoped by definition and a
 * `@keyframes` name is global. What is here is what one element does with them.
 */
const NAV_SCROLL =
  'flex min-h-0 w-full flex-1 basis-0 flex-col gap-2 overflow-y-auto px-12 pt-12 [scrollbar-width:none] [animation:shell-nav-more-above_linear_both,shell-nav-more-below_linear_both] [animation-timeline:scroll(self),scroll(self)] [animation-range:0_32px,calc(100%-32px)_100%] [mask-image:linear-gradient(to_bottom,transparent,#000_var(--shell-nav-fade-above),#000_calc(100%-var(--shell-nav-fade-below)),transparent)]'

const ITEM = 'flex w-full shrink-0 items-center gap-10 rounded-sm px-10 py-9 [&>svg]:shrink-0'

const ITEM_OFF = 'text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_50%,transparent)]'

const ITEM_ON = 'bg-secondary text-foreground hover:bg-secondary'

/* The size is the row's, not the label's: a child row sets it smaller, and two `text-*` utilities
   on one element are settled by the order Tailwind emitted them in. */
const LABEL = 'min-w-0 flex-1 basis-0 truncate'

const LABEL_ON = 'font-semibold text-foreground'

/** A row that is not the one you are on reads in the shell's soft ink. */
const LABEL_OFF = 'font-medium text-[#cbd5e1]'

/** Unread is bold (T251): heavier than the row you are on, because it is asking to be opened. */
const LABEL_UNREAD = 'font-bold text-foreground'

const COUNT = 'shrink-0 whitespace-nowrap font-semibold text-muted-foreground'

/**
 * `Badge/Needs You` (frame `SgMom`): a count that is not a total but a queue — how many Inbox rows
 * are waiting in that conversation. Red, so it reads as the rail's own badge does, and never the
 * app's indigo accent, which says nothing about who is waited on (T251).
 */
const BADGE =
  'inline-flex h-18 min-w-18 shrink-0 items-center justify-center rounded-full bg-destructive px-6 font-bold text-10-5/normal text-destructive-foreground'

const CHILD =
  'flex w-full shrink-0 items-center gap-9 rounded-sm py-7 pr-10 pl-34 text-muted-foreground [&>svg]:shrink-0'

const CHILD_OFF = 'hover:bg-[color-mix(in_srgb,var(--secondary)_50%,transparent)]'

/** The `#` of an unread channel, in the foreground its name is now drawn in (T251). */
const CHILD_UNREAD = '[&_[data-ui=Hash]]:text-foreground'

const SECTION =
  'w-full shrink-0 whitespace-nowrap px-10 pt-12 pb-5 pl-34 font-bold text-9-5/normal text-muted-foreground uppercase tracking-[1.2px]'

/** The pencil, and `Delete channel…` beside it (T112): hidden until the row is under the pointer. */
const CHILD_ACTION =
  'absolute top-1/2 right-6 flex h-20 w-20 -translate-y-1/2 items-center justify-center rounded-[4px] bg-secondary p-0 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 in-[[data-child-row]:hover]:opacity-100'

/** A row that offers both keeps the destructive one clear of the other. */
const CHILD_REMOVE =
  'right-30 hover:bg-[color-mix(in_srgb,var(--color-error)_70%,var(--secondary))] hover:text-status-error-foreground'

/** The two faces of a Between agents pair: 20px each, the second 14px in. */
const FACES =
  'relative block h-20 w-34 shrink-0 [&>[data-slot=avatar]]:absolute [&>[data-slot=avatar]]:top-0 [&>[data-slot=avatar]]:left-0 [&>[data-slot=avatar]]:outline-2 [&>[data-slot=avatar]]:outline-card [&>[data-slot=avatar]+[data-slot=avatar]]:left-14'

const FOOTER = 'relative flex w-full shrink-0 items-center gap-10 border-t border-t-border px-14 pt-11 pb-12'

/** The whole row opens Your profile; the ⋮ keeps its own hit area beside it. */
const FOOTER_OPEN = 'flex min-w-0 flex-1 basis-0 items-center gap-10 p-0 text-left hover:bg-[#ffffff0f]'

const FOOTER_AVATAR = 'shrink-0 whitespace-nowrap font-bold text-12/normal text-[#cbd5e1]'

const STATUS =
  'truncate font-normal text-11/normal text-brand-success data-[status=focused]:text-brand-warning data-[status=away]:text-muted-foreground'

const FOOTER_MORE = 'flex shrink-0 p-0 text-muted-foreground hover:text-foreground'

/** Menus opened from the company header and the footer. */
const POPOVER = 'absolute right-16 left-16 z-20 [&_[data-slot=menu]]:max-h-[60vh] [&_[data-slot=menu]]:overflow-y-auto'
