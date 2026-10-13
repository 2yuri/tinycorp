import { describe, expect, it } from 'vitest'
import type { Outlined } from '../../../shared/files/language'
import { type Jump, outlineLabel, popJump, pushJump, symbolOn, TRAIL_LIMIT } from './language-model'
import { worthReading } from './use-language'

describe('The way back from a definition', () => {
  const from = (path: string, line: number): Jump => ({ placeId: 'repo:r-web', path, line })

  it('remembers where the boss was, and takes them back there', () => {
    const trail = pushJump(pushJump([], from('desk.ts', 3)), from('counter.ts', 2))
    const { trail: left, back } = popJump(trail)

    expect(back).toEqual(from('counter.ts', 2))
    expect(popJump(left).back).toEqual(from('desk.ts', 3))
  })

  it('has nowhere to go back to with nothing behind it', () => {
    expect(popJump([])).toEqual({ trail: [], back: null })
  })

  it('keeps only the last few jumps, so a long afternoon does not pile up', () => {
    let trail: Jump[] = []
    for (let line = 1; line <= TRAIL_LIMIT + 5; line++) trail = pushJump(trail, from('desk.ts', line))

    expect(trail).toHaveLength(TRAIL_LIMIT)
    expect(trail[0]).toEqual(from('desk.ts', 6))
  })
})

describe('The outline', () => {
  const outline: Outlined[] = [
    { name: 'FilePlace', kind: 'interface', line: 17, column: 18, depth: 0 },
    { name: 'path', kind: 'property', line: 23, column: 3, depth: 1 },
    { name: 'placeId', kind: 'function', line: 41, column: 17, depth: 0 },
  ]

  it('names a symbol and what it is', () => {
    expect(outlineLabel(outline[0]!)).toBe('FilePlace · interface')
  })

  it('marks the symbol the boss is inside, all the way down it', () => {
    expect(symbolOn(outline, 23)?.name).toBe('path')
    expect(symbolOn(outline, 30)?.name).toBe('path')
    expect(symbolOn(outline, 41)?.name).toBe('placeId')
    expect(symbolOn(outline, 3)).toBeNull()
    expect(symbolOn(outline, null)).toBeNull()
  })
})

describe('Which files are worth asking a server about', () => {
  it('asks about a source file of a place, and about nothing else', () => {
    const watch = { placeId: 'repo:r-web', path: 'src/desk.ts', text: 'const a = 1\n' }

    expect(worthReading(watch)).toBe(true)
    expect(worthReading({ ...watch, path: 'docs/product.md' })).toBe(false)
    // A file from outside the Company belongs to no place, so no server speaks for it (T121).
    expect(worthReading({ ...watch, placeId: null })).toBe(false)
    // Half a file would only be complained about for the half that is not there.
    expect(worthReading({ ...watch, truncated: true })).toBe(false)
  })
})
