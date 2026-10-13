import { describe, expect, it } from 'vitest'
import { bubbleFor } from './bubbles'
import type { SpriteState } from './projection'

describe('bubbleFor', () => {
  it('shows the illustration bubbles: … Talking, ! Waiting on you, ? Blocked, Zzz Idle', () => {
    expect(bubbleFor({ state: 'talking' })).toBe('…')
    expect(bubbleFor({ state: 'waiting', bubble: '!' })).toBe('!')
    expect(bubbleFor({ state: 'blocked', bubble: '?' })).toBe('?')
    expect(bubbleFor({ state: 'idle' })).toBe('Zzz')
  })

  it('shows nothing over anyone else', () => {
    const quiet: SpriteState[] = ['off', 'starting', 'working', 'reading', 'parked', 'out_of_budget']
    expect(quiet.map((state) => bubbleFor({ state }))).toEqual(quiet.map(() => null))
  })
})
