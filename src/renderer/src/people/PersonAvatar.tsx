// One avatar for every person in the app: the kit's Avatar, told who an author id stands for.
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { type Accent, Avatar, type AvatarPerson, type AvatarSize, accentFor, initialsOf } from '../ui'

/** What a surface knows about the people it draws: the current Employees, and the boss's own profile. */
export interface People {
  employees: Employee[]
  /** The boss's avatar initials from their profile; their name's initials without one. */
  bossInitials?: string | undefined
  /** The character the boss picked in Your profile (T79); initials stand in until it decodes. */
  bossSprite?: number | undefined
}

export interface PersonTile {
  /** The Employee whose character and accent the tile draws; null for the boss and the Company. */
  person: AvatarPerson | null
  /** A character for someone who is not an Employee: the boss's own, on the neutral tile. */
  sprite?: number | undefined
  /** What a tile without a character says. */
  text: string
}

/**
 * Who a tile stands for. An Employee brings their character and their accent; the boss brings the
 * character they chose on the neutral tile, and the Company itself and anyone who has left keep
 * initials, as the design draws them.
 */
export function personTile(id: string, name: string, people: People): PersonTile {
  if (id === BOSS) {
    return {
      person: null,
      sprite: people.bossSprite,
      text: people.bossInitials?.trim() || (name === 'You' ? 'Y' : initialsOf(name)),
    }
  }
  if (id === COMPANY_AUTHOR) return { person: null, text: 'TC' }
  const employee = people.employees.find((e) => e.id === id)
  return { person: employee ? { id: employee.id, sprite: employee.sprite } : null, text: initialsOf(name) }
}

/** The accent of the Employee an id names, or null for anyone who has none (the boss, the Company). */
export function personAccent(id: string, employees: Employee[]): Accent | null {
  return employees.some((e) => e.id === id) ? accentFor(id) : null
}

export function PersonAvatar(props: {
  id: string
  name: string
  people: People
  size?: AvatarSize
  ring?: boolean
  className?: string
}) {
  const tile = personTile(props.id, props.name, props.people)
  return (
    <Avatar
      name={props.name}
      size={props.size}
      person={tile.person}
      sprite={tile.sprite}
      text={tile.text}
      ring={props.ring}
      className={props.className}
    />
  )
}
