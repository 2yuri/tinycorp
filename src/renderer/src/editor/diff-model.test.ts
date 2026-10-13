import { describe, expect, it } from 'vitest'
import {
  changesLabel,
  type DiffMark,
  layoutFor,
  marksOn,
  overlaysOn,
  readDiffLayout,
  SPLIT_MIN_WIDTH,
  stepChange,
} from './diff-model'

describe('the remembered layout', () => {
  it('says nothing at all until the boss has chosen', () => {
    expect(readDiffLayout(null)).toBeNull()
    expect(readDiffLayout(undefined)).toBeNull()
    // A window whose storage holds something else — an older key, a hand edit — is not a choice.
    expect(readDiffLayout('unified')).toBeNull()
  })

  it('takes the two it knows', () => {
    expect(readDiffLayout('split')).toBe('split')
    expect(readDiffLayout('inline')).toBe('inline')
  })
})

describe('which way a diff is laid out', () => {
  /*
   * T243 opened every diff side by side. At the default 1512px window with the file list and the
   * conversation panel both open the Review screen gives its diff about 560px, which is 250px a
   * side: the code is cut off on both of them and a comment thread under one reads a word per line
   * (T244). These are the widths that screen really has.
   */
  it('lays a pane too narrow for two columns out inline', () => {
    expect(layoutFor(560, null)).toBe('inline')
    expect(layoutFor(SPLIT_MIN_WIDTH - 1, null)).toBe('inline')
  })

  it('lays a wide one out side by side', () => {
    expect(layoutFor(SPLIT_MIN_WIDTH, null)).toBe('split')
    expect(layoutFor(1200, null)).toBe('split')
  })

  it('does what the boss chose, at any width', () => {
    expect(layoutFor(560, 'split')).toBe('split')
    expect(layoutFor(1200, 'inline')).toBe('inline')
  })

  it('opens side by side while nothing has measured the pane', () => {
    // A mocked editor in a test, and the tick before the first layout: one answer, not a flash of
    // inline followed by split.
    expect(layoutFor(0, null)).toBe('split')
  })
})

describe('the walk through a file’s changes', () => {
  it('says which change of how many, and nothing before the editor has counted them', () => {
    expect(changesLabel(3, 12)).toBe('3 / 12')
    expect(changesLabel(0, 0)).toBe('')
    // A file whose two sides are the same says nothing either: `+0 −0` beside it is the answer.
    expect(changesLabel(1, 0)).toBe('')
  })

  it('wraps at both ends, as Monaco’s own next and previous do', () => {
    expect(stepChange(1, 4, 1)).toBe(2)
    expect(stepChange(4, 4, 1)).toBe(1)
    expect(stepChange(1, 4, -1)).toBe(4)
    expect(stepChange(2, 4, -1)).toBe(1)
    expect(stepChange(1, 0, 1)).toBe(0)
  })
})

describe('what hangs on a line', () => {
  it('puts the overlays of the head side in line order', () => {
    const overlays = [
      { id: 'b', line: 40 },
      { id: 'a', line: 12 },
      { id: 'c', line: 12, side: 'original' as const },
    ]

    expect(overlaysOn(overlays, 'modified').map((one) => one.id)).toEqual(['a', 'b'])
    expect(overlaysOn(overlays, 'original').map((one) => one.id)).toEqual(['c'])
  })

  it('marks each line once, whatever is said about it', () => {
    const marks: DiffMark[] = [
      { line: 20, kind: 'comment' },
      { line: 20, kind: 'comment' },
      { line: 7, kind: 'comment' },
      { line: 31, kind: 'finding' },
    ]

    expect(marksOn(marks, 'modified', 'comment')).toEqual([7, 20])
    expect(marksOn(marks, 'modified', 'finding')).toEqual([31])
  })
})
