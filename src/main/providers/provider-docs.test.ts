import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE } from '../../shared/domain/providers'
import { CONFORMANCE_CHECKS } from './provider-conformance'

/**
 * `docs/providers.md` is the only thing a stranger reads before writing an adapter, so it is held
 * to the catalogue the way the code is: a Provider that is not in the table, or a row that says
 * something the catalogue does not, is a guide that has started lying.
 *
 * CONTRIBUTING.md says a row is part of a Provider pull request. This is what makes that true.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..')
const GUIDE = readFileSync(join(ROOT, 'docs', 'providers.md'), 'utf8')
const CONTRIBUTING = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** The table's rows: `| Provider | CLI | Authenticates with | Reads usage | Maintainer |`. */
function rows(): Record<string, string[]> {
  return tableRows(GUIDE.slice(GUIDE.indexOf('| Provider | CLI |')))
}

/**
 * The README's own table, between its markers: `| Provider | CLI | Sign in with | Reads your usage |`.
 *
 * The front page is where most people meet the list, and the ticket that wrote it (T198) derived the
 * table from the catalogue by hand. This is what stops the *next* Provider landing without it.
 */
function readmeRows(): Record<string, string[]> {
  const start = README.indexOf('<!-- providers:start -->')
  const end = README.indexOf('<!-- providers:end -->')
  expect(start, 'README.md has no <!-- providers:start --> marker around its table').toBeGreaterThan(-1)
  expect(end, 'README.md has no <!-- providers:end --> marker around its table').toBeGreaterThan(start)
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

describe('docs/providers.md', () => {
  it('lists every Provider in the catalogue, with its CLI, its login and its usage answer', () => {
    const table = rows()

    for (const entry of PROVIDER_CATALOGUE) {
      const row = table[entry.name]
      expect(
        row,
        `${entry.name} is in the catalogue and not in the table at the end of docs/providers.md`,
      ).toBeDefined()
      expect(row![1], `${entry.name}'s row names the wrong CLI`).toBe(`\`${entry.command}\``)
      expect(row![2], `${entry.name}'s row and its catalogue entry disagree about how the boss signs in`).toBe(
        entry.auth.how,
      )
      expect(row![3], `${entry.name}'s row and its catalogue entry disagree about reading usage`).toBe(
        entry.readsUsage ? 'Yes' : 'No',
      )
      expect(row![4], `${entry.name}'s row names no maintainer`).toBe(entry.maintainer)
    }
  })

  it('names no Provider in the table that is not in the catalogue', () => {
    const named = Object.keys(rows()).filter(
      (name) => !name.startsWith('_') && name !== 'Provider' && !/^-+$/.test(name),
    )

    expect(named.sort()).toEqual(PROVIDER_CATALOGUE.map((entry) => entry.name).sort())
  })

  it('has a section for every part of the contract the suite can fail on', () => {
    for (const part of new Set(CONFORMANCE_CHECKS.map((check) => check.contract))) {
      // The failures say `docs/providers.md#<part>`, so the anchor has to be there to follow.
      expect(GUIDE, `the suite can fail with "${part}:" and the guide has no ### ${part} to read`).toContain(
        `### \`${part}\``,
      )
    }
  })

  it('is what CONTRIBUTING.md sends a contributor to, with the command that starts them off', () => {
    expect(CONTRIBUTING).toContain('docs/providers.md')
    expect(CONTRIBUTING).toContain('pnpm provider:new')
    expect(GUIDE).toContain('pnpm provider:new')
  })
})

describe("README.md's Providers table", () => {
  it('names every Provider in the catalogue, with its CLI, its login and its usage answer', () => {
    const table = readmeRows()

    for (const entry of PROVIDER_CATALOGUE) {
      const row = table[entry.name]
      expect(row, `${entry.name} is in the catalogue and not in the table on the front page`).toBeDefined()
      expect(row![1], `${entry.name}'s row names the wrong CLI`).toBe(`\`${entry.command}\``)
      expect(row![2], `${entry.name}'s row and its catalogue entry disagree about how the boss signs in`).toBe(
        entry.auth.how,
      )
      expect(row![3], `${entry.name}'s row and its catalogue entry disagree about reading usage`).toBe(
        entry.readsUsage ? 'Yes' : 'No',
      )
    }
  })

  it('names no Provider the catalogue does not have', () => {
    const named = Object.keys(readmeRows()).filter((name) => name !== 'Provider' && !/^-+$/.test(name))

    expect(named.sort()).toEqual(PROVIDER_CATALOGUE.map((entry) => entry.name).sort())
  })
})
