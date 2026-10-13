import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { ACCENTS, accentFor } from '../ui'
import { PersonAvatar, personAccent, personTile } from './PersonAvatar'

const ada = { id: 'e-ada', name: 'Ada Byron', sprite: 2 } as Employee
const bo = { id: 'e-bo', name: 'Bo Chen', sprite: 5 } as Employee
const people = { employees: [ada, bo] }

describe('an accent per Employee', () => {
  it('is stable for an id, whatever the name', () => {
    expect(accentFor(ada.id)).toBe(accentFor(ada.id))
    expect(ACCENTS).toContain(accentFor(ada.id))
  })

  it('reads the id, so a rename keeps the colour and two Employees can differ', () => {
    expect(accentFor('e-ada')).not.toBe(accentFor('e-bo'))
    expect(new Set(ACCENTS.map((_, i) => accentFor(`e-${i}`))).size).toBeGreaterThan(1)
  })

  it('belongs to Employees only: the boss and the Company have none', () => {
    expect(personAccent(ada.id, [ada, bo])).toBe(accentFor(ada.id))
    expect(personAccent(BOSS, [ada, bo])).toBeNull()
    expect(personAccent(COMPANY_AUTHOR, [ada, bo])).toBeNull()
  })
})

describe('who a tile stands for', () => {
  it('draws an Employee as their character on their accent', () => {
    expect(personTile(ada.id, ada.name, people).person).toEqual({ id: 'e-ada', sprite: 2 })
  })

  it("keeps the boss's initials, from Company settings when they are set", () => {
    expect(personTile(BOSS, 'Yuri Miguel', { ...people, bossInitials: 'Y' })).toMatchObject({ person: null, text: 'Y' })
    expect(personTile(BOSS, 'Yuri Miguel', people)).toMatchObject({ person: null, text: 'YM' })
    expect(personTile(BOSS, 'You', people)).toMatchObject({ person: null, text: 'Y' })
  })

  it('draws the boss as the character they picked, with their initials standing in', () => {
    expect(personTile(BOSS, 'Yuri Miguel', { ...people, bossSprite: 4 })).toEqual({
      person: null,
      sprite: 4,
      text: 'YM',
    })
  })

  it('keeps initials for the Company and for someone who is gone', () => {
    expect(personTile(COMPANY_AUTHOR, 'tinycorp', people)).toMatchObject({ person: null, text: 'TC' })
    expect(personTile('e-gone', 'Former employee', people)).toMatchObject({ person: null, text: 'FE' })
  })
})

describe('the avatar it renders', () => {
  it('carries the Employee accent and stands the initials in until the sheet decodes', () => {
    const html = renderToStaticMarkup(<PersonAvatar id={ada.id} name={ada.name} people={people} size={34} />)
    expect(html).toContain(`data-accent="${accentFor(ada.id)}"`)
    expect(html).toContain('data-tone="accent"')
    expect(html).toContain('--ui-avatar-size:34px')
    expect(html).toContain('AB')
  })

  it('leaves the boss on the neutral tile, with no accent', () => {
    const html = renderToStaticMarkup(<PersonAvatar id={BOSS} name="Yuri Miguel" people={people} size={34} />)
    expect(html).not.toContain('data-accent')
    expect(html).toContain('data-tone="neutral"')
    expect(html).not.toContain('data-sprite')
  })

  it("draws the boss's own character on that neutral tile once they pick one", () => {
    const html = renderToStaticMarkup(
      <PersonAvatar id={BOSS} name="Yuri Miguel" people={{ ...people, bossSprite: 4 }} size={34} />,
    )
    expect(html).toContain('data-sprite="4"')
    expect(html).toContain('data-tone="neutral"')
    expect(html).toContain('YM')
  })
})
