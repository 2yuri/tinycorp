import { describe, expect, it } from 'vitest'
import { repoLine, repoLineText } from './repo-line'

describe('repoLine (T285)', () => {
  it('names up to three and counts the rest', () => {
    const names = Array.from({ length: 110 }, (_, i) => `repo${i + 1}`)
    expect(repoLine(names)).toEqual({ text: 'repo1, repo2, repo3, …', more: 107, all: names.join(', ') })
    expect(repoLineText(names)).toBe('repo1, repo2, repo3, … +107')
  })

  it('names them all when there are three or fewer', () => {
    expect(repoLineText(['web', 'api'])).toBe('web, api')
    expect(repoLine(['web', 'api', 'docs']).more).toBe(0)
    expect(repoLineText([])).toBe('')
  })
})
