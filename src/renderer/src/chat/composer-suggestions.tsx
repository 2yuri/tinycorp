/**
 * What the composer offers under the box, and how it is drawn (T214).
 *
 * `@` and `#` keep the plain list they had; `/` is the command palette, in the kit's Dropdown Menu.
 * Which of the three is open is decided from the text and the caret alone — `suggestionsFor` is a
 * pure function of them — so the box holds no state about it at all.
 */
import {
  BookOpen,
  Check,
  type LucideIcon,
  MessageSquare,
  Pause,
  Play,
  Target,
  Ticket,
  Undo2,
  UserPlus,
} from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { MISSING_FOLDER_LINE } from '../../../shared/catalogue/skills'
import {
  CHANNEL_MENTION,
  completeMention,
  type Mentionable,
  mentionAt,
  mentionSuggestions,
} from '../../../shared/domain/chat'
import {
  completeSlash,
  invokesSkill,
  type SlashName,
  skillSuggestions,
  slashArguments,
  slashAt,
  slashSuggestions,
} from '../../../shared/providers/slash-commands'
import { completeHash, hashAt, hashSuggestions } from '../../../shared/ticket-refs'
import { cx, DropdownMenu, MenuDivider, MenuItem } from '../ui'
import type { SlashComposer } from './Composer'
import type { Refs } from './Messages'
import '../ui/tailwind.css'

export interface Suggestion {
  key: string
  label: ReactNode
  hint?: string | undefined
  icon?: LucideIcon | undefined
  /** True when the row is already what the box holds, so Enter runs it instead of completing it. */
  submits?: boolean
  complete(): { text: string; caret: number }
}

/**
 * The palette's first group, when the draft can invoke an Employee's skills (T264): whose they are,
 * how many they hold, and how many of the rows at the top of `items` are theirs. The commands
 * follow under their own label.
 */
export interface SkillRows {
  owner: string
  held: number
  rows: number
}

/** The palette rows, in the kit's Dropdown Menu; `@` and `#` keep the plain list they had. */
export interface Suggestions {
  palette: boolean
  items: Suggestion[]
  /** Set when the palette opens with an Employee's skills; left out, it is the commands alone. */
  skills?: SkillRows | undefined
}

export const NO_SUGGESTIONS: Suggestions = { palette: false, items: [] }

/** A palette row's two lines: the name in mono, what follows it, and the line under it. */
function paletteLabel(name: string, argument: string, line: string): ReactNode {
  return (
    <>
      <span className="font-code text-12/[normal]">/{name}</span>
      {argument && <span className="ml-6 font-code text-12/[normal] text-muted-foreground">{argument}</span>}
      <span className="mt-2 block text-11-5/[normal] text-muted-foreground">{line}</span>
    </>
  )
}

/** The row the box's `aria-activedescendant` points at while the arrows walk the list. */
export const optionId = (index: number) => `chat-suggestion-${index}`

/** One icon per command, so the palette reads as a menu of actions and not a list of words. */
const COMMAND_ICON: Record<SlashName, LucideIcon> = {
  dm: MessageSquare,
  ticket: Ticket,
  approve: Check,
  reject: Undo2,
  hire: UserPlus,
  pause: Pause,
  resume: Play,
  goal: Target,
}

export interface SuggestionsInput {
  text: string
  caret: number
  /** True once Escape has closed the list, until the next keystroke. */
  dismissed: boolean
  /** Left out, `/` is ordinary text and the palette never opens. */
  slash?: SlashComposer | undefined
  people: Mentionable[]
  refs: Refs
}

export function suggestionsFor({ text, caret, dismissed, slash, people, refs }: SuggestionsInput): Suggestions {
  if (dismissed) return NO_SUGGESTIONS
  if (slash) {
    const hit = slashAt(text, caret)
    const group = slash.skills(text)
    // A skill named like a command is the skill, and takes no command's argument (T264).
    if (hit?.command && invokesSkill(text, group)) return NO_SUGGESTIONS
    if (hit?.command) {
      const items = slashArguments(hit.command, hit.query, slash).map((a) => ({
        key: `arg:${a.value}`,
        label: a.label,
        complete: () => completeSlash(text, hit.start, caret, `${a.value} `),
      }))
      return { palette: true, items }
    }
    if (hit) {
      const skills = group ? skillSuggestions(hit.query, group.skills) : []
      const skillItems = skills.map((skill) => ({
        key: `skill:${skill.name}`,
        label: paletteLabel(skill.name, '', skill.missing ? MISSING_FOLDER_LINE : skill.description),
        icon: BookOpen,
        complete: () => completeSlash(text, hit.start, caret, `/${skill.name} `),
      }))
      const commandItems = slashSuggestions(hit.query)
        // A skill that shares a command's name is listed once, under SKILLS.
        .filter((c) => !skills.some((skill) => skill.name === c.name))
        .map((c) => ({
          key: `/${c.name}`,
          label: paletteLabel(c.name, c.argument, c.summary),
          icon: COMMAND_ICON[c.name],
          submits: c.argument === '' && hit.query === c.name,
          complete: () => completeSlash(text, hit.start, caret, `/${c.name} `),
        }))
      const rows =
        group && skillItems.length > 0
          ? { owner: group.owner, held: group.skills.length, rows: skillItems.length }
          : undefined
      return { palette: true, items: [...skillItems, ...commandItems], skills: rows }
    }
  }
  const mention = mentionAt(text, caret)
  if (mention) {
    const items = mentionSuggestions(mention.query, people).map((p) => ({
      key: `@${p.id}`,
      label: `@${p.name}`,
      hint: p.id === CHANNEL_MENTION ? 'everyone here' : undefined,
      complete: () => completeMention(text, mention.start, caret, p.name),
    }))
    return { palette: false, items }
  }
  const hash = hashAt(text, caret)
  if (hash) {
    const items = hashSuggestions(hash.query, refs.tickets, refs.channelIds, refs.companyKey).map((s) => ({
      key: `${s.kind}:${s.value}`,
      label: s.insert,
      hint: s.kind === 'ticket' ? s.label : undefined,
      complete: () => completeHash(text, hash.start, caret, s.insert),
    }))
    return { palette: false, items }
  }
  return NO_SUGGESTIONS
}

const PALETTE = 'absolute bottom-full left-0 z-1 mb-6 max-h-440 min-w-364 max-w-full overflow-y-auto'

const PLAIN =
  'absolute bottom-full left-0 z-1 mx-0 mt-0 mb-6 min-w-220 list-none rounded-sm border border-border bg-popover p-4 text-13/[normal] text-popover-foreground shadow-menu'

/** A group's label in the palette (frame `DhY2y`): `SKILLS · ORION`, with its count on the right. */
function GroupLabel({ label, count }: { label: string; count?: string }) {
  return (
    <div
      data-slot="menu-group-label"
      className="flex items-center gap-6 px-10 pt-8 pb-4 text-10-5/[normal] text-muted-foreground"
      aria-hidden
    >
      <span className="font-bold uppercase tracking-[0.4px]">{label}</span>
      <span className="shrink grow basis-0" />
      {count && <span>{count}</span>}
    </div>
  )
}

/** The list over the box. Nothing at all when there is nothing to offer. */
export function SuggestionList(props: {
  suggestions: Suggestions
  highlighted: number
  onChoose(suggestion: Suggestion): void
}) {
  const { palette, items } = props.suggestions
  if (items.length === 0) return null
  // A mouse press on a row must not take focus off the box, or the caret it completes to is lost.
  const choose = (suggestion: Suggestion) => (event: { preventDefault(): void }) => {
    event.preventDefault()
    props.onChoose(suggestion)
  }
  if (palette) {
    const skills = props.suggestions.skills
    return (
      <DropdownMenu className={PALETTE} role="listbox" aria-label="Commands">
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {skills && i === 0 && (
              <GroupLabel
                label={`Skills · ${skills.owner}`}
                count={skills.held === 1 ? '1 skill' : `${skills.held} skills`}
              />
            )}
            {skills && i === skills.rows && (
              <>
                <MenuDivider />
                <GroupLabel label="Commands" />
              </>
            )}
            <MenuItem
              id={optionId(i)}
              role="option"
              aria-selected={i === props.highlighted}
              highlighted={i === props.highlighted}
              icon={item.icon}
              label={item.label}
              onMouseDown={choose(item)}
            />
          </Fragment>
        ))}
      </DropdownMenu>
    )
  }
  return (
    <div className={PLAIN} role="listbox" aria-label="Suggestions">
      {items.map((p, i) => (
        <div
          key={p.key}
          id={optionId(i)}
          role="option"
          tabIndex={-1}
          aria-selected={i === props.highlighted}
          className={cx(
            'cursor-pointer rounded-[6px] px-8 py-6',
            i === props.highlighted && 'bg-primary text-primary-foreground',
          )}
          onMouseDown={choose(p)}
        >
          {p.label}
          {p.hint && (
            <span className={i === props.highlighted ? 'text-inherit' : 'text-muted-foreground'}> {p.hint}</span>
          )}
        </div>
      ))}
    </div>
  )
}
