import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What an effect returns is taken for its clean-up. A concise arrow body hands React whatever the
 * last call answered — and in this Chromium `scrollIntoView` answers with a promise — so the view
 * comes down with `destroy is not a function` the moment it unmounts, and the screen goes blank.
 * An effect that is not a block body has to return a function on purpose, not by accident.
 */
const ALLOWED = /useEffect\(\s*\(\)\s*=>\s*(\{|on[A-Z]|set[A-Z]|window\.tinyCorp|api\.on|listenFor|request|void )/

describe('every effect in the renderer', () => {
  it('returns a clean-up on purpose, or nothing at all', () => {
    const root = join(import.meta.dirname, '../..')
    const files = globSync('**/*.{ts,tsx}', { cwd: root }).filter(
      (name) => !name.endsWith('.test.tsx') && !name.endsWith('.test.ts'),
    )
    const loose: string[] = []
    for (const name of files) {
      const source = readFileSync(join(root, name), 'utf8')
      for (const [index, line] of source.split('\n').entries()) {
        if (!line.includes('useEffect(() =>')) continue
        if (ALLOWED.test(line)) continue
        loose.push(`${name}:${index + 1} ${line.trim()}`)
      }
    }

    expect(loose, 'an effect whose body is an expression: make it a block').toEqual([])
  })
})
