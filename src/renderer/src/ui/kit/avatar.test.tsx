import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const sheet = [
  { src: 'data:image/png;base64,zero', width: 77, height: 169 },
  { src: 'data:image/png;base64,one', width: 83, height: 169 },
]
vi.mock('../../sprites/character-looks', () => ({ useCharacterLooks: () => sheet }))

const { ACCENTS, accentFor } = await import('./accent')
const { Avatar, AvatarStack } = await import('./Avatar')

describe('the Avatar of an Employee', () => {
  it('draws their character on a tile tinted with their accent', () => {
    const html = renderToStaticMarkup(<Avatar name="Ada Byron" person={{ id: 'e-ada', sprite: 1 }} size={34} />)

    expect(html).toContain(`data-accent="${accentFor('e-ada')}"`)
    expect(html).toContain('data-tone="accent"')
    // The head crop: the drawing pulled back 8% inside a tile that clips it.
    expect(html).toMatch(/class="[^"]*absolute top-\[-8%\] left-\[-8%\]/)
    expect(html).toContain(sheet[1]!.src)
    expect(html).toContain('--ui-avatar-size:34px')
    // The name is still what a screen reader hears, though no initials are drawn.
    expect(html).toContain('aria-label="Ada Byron"')
  })

  it('names one of the nine accents, and the same one for the same id', () => {
    expect(new Set(ACCENTS).size).toBe(9)
    for (const id of ['e-ada', 'e-bo', 'e-iris']) expect(ACCENTS).toContain(accentFor(id))
    expect(accentFor('e-ada')).toBe(accentFor('e-ada'))
  })

  it('keeps initials on the neutral tile for anyone who is not an Employee', () => {
    const html = renderToStaticMarkup(<Avatar name="Yuri Miguel" />)

    expect(html).toContain('>YM<')
    expect(html).toContain('data-tone="neutral"')
    expect(html).not.toContain('data-accent')
  })

  it('stacks carry the same tile', () => {
    const stack = renderToStaticMarkup(
      <AvatarStack>
        <Avatar name="Ada Byron" person={{ id: 'e-ada', sprite: 0 }} size={30} ring />
        <Avatar name="2 more" text="+2" size={30} ring />
      </AvatarStack>,
    )
    expect(stack.match(/data-ui="Avatar"/g)).toHaveLength(2)
    expect(stack).toContain('data-ring="true"')
    expect(stack).toContain('+2')
  })
})
