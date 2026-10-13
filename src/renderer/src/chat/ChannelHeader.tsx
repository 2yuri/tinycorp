import { PanelRight, Pin, Search, Trash2 } from 'lucide-react'
import { pinIconLabel } from '../../../shared/channel-extras'
import { deleteChannelAction } from '../../../shared/channel-removal'
import { BOSS } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { ViewHeader } from '../chrome'
import { PersonAvatar } from '../people'
import { Avatar, cx } from '../ui'
import type { ChannelPanel } from './ChannelPanels'
import type { ChannelHeader as Header } from './chat-view'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** The members badge: the pill, one step larger, as the top bar draws it. */
const BADGE =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-11 py-5 font-semibold text-12/[normal]'

/** One of the top bar's square icon buttons. */
const TOOL =
  'relative flex size-36 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border bg-transparent p-0 text-muted-foreground disabled:cursor-default focus-visible:shadow-focus focus-visible:outline-none'

/** The same button, lit: hovered, or on because its panel is open. */
const TOOL_ON = 'bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] text-foreground'
const TOOL_HOVER =
  'hover:not-disabled:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:not-disabled:text-foreground'

/** How many member avatars show before the `+N` one. */
const STACK_SIZE = 4

/** Fills the shell's 64px content header: name, members, topic, avatars and the panel toggles. */
export function ChannelHeader(props: {
  header: Header
  employees: Employee[]
  nameOf(id: string): string
  bossName?: string | undefined
  bossInitials?: string | undefined
  bossSprite?: number | undefined
  panelOpen: boolean
  onTogglePanel(): void
  /** Which of the header's own panels is open over the conversation, or null (T44). */
  channelPanel: ChannelPanel | null
  /** Opens one of them, or closes the open one when given the same again. */
  onChannelPanel(panel: ChannelPanel | null): void
  /** True on a named channel, whose topic and member list the boss may set (T44). */
  editable: boolean
  /** How many messages this channel has pinned (T44). */
  pinCount: number
  /** Delete channel…, offered only where it is allowed: a channel of the boss's own making (T112). */
  onDelete?: (() => void) | undefined
}) {
  const toggle = (panel: ChannelPanel) => props.onChannelPanel(props.channelPanel === panel ? null : panel)
  const badge = <span className={cx(BADGE, SOFT)}>{props.header.members}</span>
  return (
    <ViewHeader
      title={props.header.title}
      badge={
        props.editable ? (
          <button
            type="button"
            className={cx(
              'cursor-pointer border-none bg-transparent p-0',
              '[&:hover>span]:bg-[color-mix(in_srgb,var(--secondary)_70%,var(--foreground)_12%)] [&:hover>span]:text-foreground',
              "[&[aria-pressed='true']>span]:bg-[color-mix(in_srgb,var(--secondary)_70%,var(--foreground)_12%)] [&[aria-pressed='true']>span]:text-foreground",
            )}
            aria-label={`About ${props.header.title}`}
            aria-pressed={props.channelPanel === 'about'}
            title="Topic and members"
            onClick={() => toggle('about')}
          >
            {badge}
          </button>
        ) : (
          badge
        )
      }
      subtitle={props.header.topic}
    >
      <span className="flex items-center gap-14">
        <ChannelMembers
          memberIds={props.header.memberIds}
          employees={props.employees}
          nameOf={props.nameOf}
          bossName={props.bossName}
          bossInitials={props.bossInitials}
          bossSprite={props.bossSprite}
        />
        <button
          type="button"
          className={cx(TOOL, TOOL_HOVER, props.channelPanel === 'pins' && TOOL_ON)}
          aria-label={pinIconLabel(props.pinCount)}
          aria-pressed={props.channelPanel === 'pins'}
          title="Pinned messages"
          onClick={() => toggle('pins')}
        >
          <Pin size={18} aria-hidden />
          {props.pinCount > 0 && (
            <span className="absolute -top-5 -right-5 min-w-16 rounded-full bg-primary px-4 py-0 font-semibold text-10/16 text-primary-foreground">
              {props.pinCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className={cx(TOOL, TOOL_HOVER, props.channelPanel === 'search' && TOOL_ON)}
          aria-label="Search this channel"
          aria-pressed={props.channelPanel === 'search'}
          title="Search this channel"
          onClick={() => toggle('search')}
        >
          <Search size={18} aria-hidden />
        </button>
        {props.onDelete && (
          <button
            type="button"
            className={cx(
              TOOL,
              'hover:border-status-error hover:bg-[color-mix(in_srgb,var(--color-error)_14%,transparent)] hover:text-status-error',
            )}
            aria-label={deleteChannelAction(props.header.title.replace(/^#\s*/, ''))}
            title="Delete this channel"
            onClick={props.onDelete}
          >
            <Trash2 size={18} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className={cx(TOOL, TOOL_HOVER, props.panelOpen && TOOL_ON)}
          aria-label={props.panelOpen ? 'Hide thread panel' : 'Show thread panel'}
          aria-pressed={props.panelOpen}
          title="Thread panel"
          onClick={props.onTogglePanel}
        >
          <PanelRight size={18} aria-hidden />
        </button>
      </span>
    </ViewHeader>
  )
}

/**
 * The overlapping member stack: the boss, then every member on their own accent, then `+N` for the
 * rest. Its own component, so it renders outside the shell's header portal.
 */
export function ChannelMembers(props: {
  memberIds: string[]
  employees: Employee[]
  nameOf(id: string): string
  bossName?: string | undefined
  bossInitials?: string | undefined
  bossSprite?: number | undefined
}) {
  const shown = props.memberIds.slice(0, props.memberIds.length > STACK_SIZE + 1 ? STACK_SIZE : STACK_SIZE + 1)
  const more = props.memberIds.length - shown.length
  return (
    <ul className="m-0 flex shrink-0 list-none items-center p-0" aria-label="Members">
      {shown.map((id) => (
        <li key={id} className="[&+&]:ml-[-10px]">
          <PersonAvatar
            id={id}
            name={id === BOSS ? props.bossName || 'You' : props.nameOf(id)}
            people={{ employees: props.employees, bossInitials: props.bossInitials, bossSprite: props.bossSprite }}
            size={30}
            ring
          />
        </li>
      ))}
      {more > 0 && (
        <li className="[&+&]:ml-[-10px]">
          <Avatar name={`${more} more`} text={`+${more}`} size={30} ring />
        </li>
      )}
    </ul>
  )
}
