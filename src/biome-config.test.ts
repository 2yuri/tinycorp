import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `AGENTS.md`: "A rule that is off carries the reason beside it, or the ticket that turns it back
 * on." This is the machine-checkable half of that sentence.
 *
 * T183 turned Biome on and left three groups `off` with a pointer to T190; T190 read every one of
 * their sites and either turned the rule on or wrote the reason down where the rule is. A fourth
 * group turned off in a hurry, with nothing beside it, is how the first three happened — and it is
 * the one thing a reader of `biome.jsonc` cannot recover on their own.
 */
const CONFIG = join(import.meta.dirname, '..', 'biome.jsonc')

/** Every `"someRule": "off"` line, with the block of `//` comment lines directly above it. */
function switchedOff(): { rule: string; line: number; reason: string }[] {
  const lines = readFileSync(CONFIG, 'utf8').split('\n')
  const found: { rule: string; line: number; reason: string }[] = []
  for (const [index, text] of lines.entries()) {
    const rule = /^\s*"([A-Za-z]+)":\s*"off"/.exec(text)?.[1]
    if (rule === undefined) continue
    const above: string[] = []
    for (let back = index - 1; back >= 0; back--) {
      const comment = /^\s*\/\/ ?(.*)$/.exec(lines[back] ?? '')
      if (!comment) break
      above.unshift(comment[1] ?? '')
    }
    found.push({ rule, line: index + 1, reason: above.join(' ').trim() })
  }
  return found
}

describe('biome.jsonc', () => {
  it('finds the rules that are off', () => {
    expect(switchedOff().map(({ rule }) => rule)).toEqual([
      'useLiteralKeys',
      'noControlCharactersInRegex',
      'noArrayIndexKey',
    ])
  })

  it('says beside every one of them why, or which ticket turns it back on', () => {
    for (const { rule, line, reason } of switchedOff()) {
      expect(reason, `${rule} at biome.jsonc:${line} is off with nothing said about it`).not.toBe('')
      // A sentence, not a word: "off" and a ticket number alone is the pointer T190 was asked for.
      expect(reason.length, `${rule} at biome.jsonc:${line} says too little to be a reason`).toBeGreaterThan(60)
    }
  })
})
