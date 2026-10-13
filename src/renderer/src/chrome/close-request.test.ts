import { describe, expect, it } from 'vitest'
import { onCloseRequest, requestClose } from './close-request'

describe('⌘W, with one key and two things it could close', () => {
  it('is nobody’s until a view takes it, so the menu closes the Company', () => {
    expect(requestClose()).toBe(false)
  })

  it('goes to the view the boss is in, which is the one that registered last', () => {
    const taken: string[] = []
    const stopFiles = onCloseRequest(() => {
      taken.push('files')
      return true
    })
    const stopReview = onCloseRequest(() => {
      taken.push('review')
      return true
    })

    expect(requestClose()).toBe(true)
    expect(taken).toEqual(['review'])

    stopReview()
    expect(requestClose()).toBe(true)
    expect(taken).toEqual(['review', 'files'])

    stopFiles()
  })

  it('falls through a view with nothing of its own to close', () => {
    const stop = onCloseRequest(() => false)

    expect(requestClose()).toBe(false)

    stop()
  })

  it('leaves the key alone once the view is gone', () => {
    const stop = onCloseRequest(() => true)
    stop()

    expect(requestClose()).toBe(false)
  })
})
