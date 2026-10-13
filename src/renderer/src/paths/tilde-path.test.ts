import { describe, expect, it } from 'vitest'
import { tildePath } from './tilde-path'

describe('tildePath', () => {
  it('shortens the home folder to ~ on each of the three platforms', () => {
    expect(tildePath('/Users/ada/code/tinycorp')).toBe('~/code/tinycorp')
    expect(tildePath('/home/ada/work/lumen')).toBe('~/work/lumen')
    expect(tildePath('C:\\Users\\ada\\code\\x')).toBe('~\\code\\x')
  })

  it('leaves a path that is not under a home folder alone', () => {
    expect(tildePath('/srv/acme')).toBe('/srv/acme')
    expect(tildePath('/Usersomething/ada')).toBe('/Usersomething/ada')
  })
})
