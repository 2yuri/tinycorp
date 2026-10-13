import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORGE_CATALOGUE, type ForgeEntry } from '../../shared/forges'
import { FORGE_CONFORMANCE_CHECKS } from './forge-conformance'

/**
 * `docs/forges.md` is the only thing a stranger reads before writing an adapter, so it is held to
 * the catalogue the way the code is: a forge that is not in the table, or a row that says
 * something the catalogue does not, is a guide that has started lying.
 *
 * CONTRIBUTING.md says a row is part of a forge pull request. This is what makes that true.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..')
const GUIDE = readFileSync(join(ROOT, 'docs', 'forges.md'), 'utf8')
const CONTRIBUTING = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** The table's rows: `| Forge | CLI | Authenticates with | Detected on | Maintainer |`. */
function rows(): Record<string, string[]> {
  return tableRows(GUIDE.slice(GUIDE.indexOf('| Forge | CLI |')))
}

/**
 * The README's own table, between its markers: `| Forge | CLI | Detected on | Sign in with |`.
 *
 * The front page carries the same two claims the guide does, in the other column order, and a
 * stranger reads it first (T198).
 */
function readmeRows(): Record<string, string[]> {
  const start = README.indexOf('<!-- forges:start -->')
  const end = README.indexOf('<!-- forges:end -->')
  expect(start, 'README.md has no <!-- forges:start --> marker around its table').toBeGreaterThan(-1)
  expect(end, 'README.md has no <!-- forges:end --> marker around its table').toBeGreaterThan(start)
  return tableRows(README.slice(start, end))
}

/** A markdown table, by the name in each row's first cell. */
function tableRows(text: string): Record<string, string[]> {
  const parsed = text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
  return Object.fromEntries(parsed.map((cells) => [cells[0]!, cells]))
}

describe('docs/forges.md', () => {
  it('lists every forge in the catalogue, with its CLI, its login and the hosts it answers for', () => {
    const table = rows()

    for (const entry of FORGE_CATALOGUE as readonly ForgeEntry[]) {
      const row = table[entry.name]
      expect(row, `${entry.name} is in the catalogue and not in the table at the end of docs/forges.md`).toBeDefined()
      expect(row![1], `${entry.name}'s row names the wrong CLI`).toBe(`\`${entry.command}\``)
      expect(row![2], `${entry.name}'s row and its catalogue entry disagree about how the boss signs in`).toBe(
        entry.auth.how,
      )
      expect(row![3], `${entry.name}'s row and its catalogue entry disagree about which hosts it answers for`).toBe(
        [...entry.hosts, ...(entry.instanceLabels ?? []).map((label) => `${label}.*`)]
          .map((host) => `\`${host}\``)
          .join(', '),
      )
      expect(row![4], `${entry.name}'s row names no maintainer`).toBe(entry.maintainer)
    }
  })

  it('names no forge in the table that is not in the catalogue', () => {
    const named = Object.keys(rows()).filter((name) => name !== 'Forge' && !/^-+$/.test(name))

    expect(named.sort()).toEqual(FORGE_CATALOGUE.map((entry) => entry.name).sort())
  })

  it('has a section for every part of the contract the suite can fail on', () => {
    for (const part of new Set(FORGE_CONFORMANCE_CHECKS.map((check) => check.contract))) {
      // The failures read `<part>: …`, so the section has to be there to turn to.
      expect(GUIDE, `the suite can fail with "${part}:" and the guide has no ### \`${part}\` to read`).toContain(
        `### \`${part}\``,
      )
    }
  })

  it('is what CONTRIBUTING.md sends a contributor to', () => {
    expect(CONTRIBUTING).toContain('docs/forges.md')
  })
})

describe("README.md's forges table", () => {
  it('names every forge in the catalogue, with its CLI, the hosts it answers for and its login', () => {
    const table = readmeRows()

    for (const entry of FORGE_CATALOGUE as readonly ForgeEntry[]) {
      const row = table[entry.name]
      expect(row, `${entry.name} is in the catalogue and not in the table on the front page`).toBeDefined()
      expect(row![1], `${entry.name}'s row names the wrong CLI`).toBe(`\`${entry.command}\``)
      expect(row![2], `${entry.name}'s row and its catalogue entry disagree about which hosts it answers for`).toBe(
        [...entry.hosts, ...(entry.instanceLabels ?? []).map((label) => `${label}.*`)]
          .map((host) => `\`${host}\``)
          .join(', '),
      )
      expect(row![3], `${entry.name}'s row and its catalogue entry disagree about how the boss signs in`).toBe(
        entry.auth.how,
      )
    }
  })

  it('names no forge the catalogue does not have', () => {
    const named = Object.keys(readmeRows()).filter((name) => name !== 'Forge' && !/^-+$/.test(name))

    expect(named.sort()).toEqual(FORGE_CATALOGUE.map((entry) => entry.name).sort())
  })
})
