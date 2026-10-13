import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../../shared/domain/providers'

/**
 * The main process names no Provider where it is choosing one.
 *
 * `no-provider-names.test.ts` makes this promise for the renderer, where it can be absolute: a
 * screen draws from the catalogue and nothing else. Main cannot be absolute — an adapter is a
 * product, and the Usage reader talks to one product's endpoint with one product's keychain item.
 * What main can promise is narrower and is the thing T169 was about: **no id of a Provider is
 * written down outside the places that are allowed to know one**.
 *
 * So this looks for the id and not for the prose: `'claude'`, `"codex"`, `PROVIDER_MODELS.claude`.
 * That is the shape a default takes — `PROVIDER_MODELS.claude` in HR's hiring tools was how a boss
 * with only Codex was offered Claude's models — and it is the shape a table keyed by one product
 * takes. A sentence in a comment or in a docs link is not one, and is left alone.
 *
 * Every exception is named in {@link ALLOWED} with the reason. A new one is a line in that list
 * and a sentence saying why that file is entitled to know a product's name.
 */

const MAIN = join(import.meta.dirname, '..')

/**
 * The files that are allowed to name a Provider id, and why. Each one is either the product's own
 * corner of the app or a thing that only exists because one product works the way it does.
 */
const ALLOWED: { path: string; because: string }[] = [
  // One folder per Provider, plus the template a new one is copied from. Derived from the
  // catalogue, so the Provider somebody adds tomorrow is exempt without anyone remembering to say so.
  ...[...PROVIDERS, 'example'].map((id) => ({
    path: `src/main/providers/${id}/`,
    because: 'an adapter is one product: its folder is where knowing its name is the whole job',
  })),
  {
    path: 'src/main/providers/provider-registry.ts',
    because: 'the two lines that bind each catalogue entry to its adapter (decision 56)',
  },
  {
    path: 'src/main/providers/provider-conformance.ts',
    because: 'the suite every adapter runs; its fixtures stand in for one concrete Provider',
  },
  {
    path: 'src/main/features/usage/provider-usage.ts',
    because: 'only one Provider reports usage: its endpoint, its keychain item, its words (T80)',
  },
  {
    path: 'src/main/features/usage/provider-logins.ts',
    because: 'where each product keeps the login the meter reads: its file, its folder, its keychain item (T257)',
  },
  {
    path: 'src/main/providers/integration/',
    because: 'the real-CLI credentials `pnpm test:claude` needs, one file per product',
  },
  {
    path: 'src/main/features/catalogue/mcp-import.ts',
    because: 'the reader of one product’s own config: its file, its JSON shape, its name (T235)',
  },
  {
    path: 'src/main/features/catalogue/mcp-sources.ts',
    because: 'where six tools each keep their own MCP config, which is six products’ own paths (T242)',
  },
  {
    path: 'src/main/features/catalogue/skill-sources.ts',
    because: 'where each agent keeps its own skill folders, which is each product’s own path (T253)',
  },
]

describe('The main process', () => {
  it('writes no Provider id outside the adapters, the registry and the places that own one', () => {
    const offenders = sources().flatMap(([file, text]) =>
      lines(text)
        .filter(([, line]) => ids(line).length > 0)
        .map(([number, line]) => `${file}:${number} names ${ids(line).join(', ')} — ${line.trim()}`),
    )

    expect(
      offenders,
      'a default that writes a Provider id down is a default the boss’s own machine cannot change. ' +
        'Read it from `shared/providers.ts` instead: `pickDefaultProvider` for what a new Employee ' +
        'starts on, `PROVIDER_CATALOGUE` for a table over all of them. If the file really is about ' +
        'one product, add it to ALLOWED with the reason',
    ).toEqual([])
  })

  it('has something to look for, so the check cannot pass by finding nothing', () => {
    expect(PROVIDERS.length).toBeGreaterThan(1)
    expect(sources().length).toBeGreaterThan(50)
    // The guard the test is for: the way the ids used to be written down.
    expect(ids('PROVIDER_MODELS.claude.map((m) => m.id)')).toEqual(['claude'])
    expect(ids("const provider = input.provider ?? 'codex'")).toEqual(['codex'])
    expect(ids(' * so it is stripped from every `claude` the app spawns')).toEqual([])
    expect(ids("export const INJECTED_PATHS = ['CLAUDE.md', '.claude/'] as const")).toEqual([])
  })
})

/**
 * The Provider ids this line writes down as a value: quoted on their own, or read off an object
 * keyed by them (`PROVIDER_MODELS.claude`). Two things deliberately do not count — a backticked
 * word in a comment, which is prose about a command rather than a choice, and a path such as
 * `.claude/`, which is a folder on disk and not a Provider being picked.
 */
function ids(line: string): string[] {
  const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '')
  return PROVIDERS.filter((id) => new RegExp(`(['"]${id}['"]|[\\w\\])]\\.${id}\\b)`).test(code))
}

function lines(text: string): [number, string][] {
  return text.split('\n').map((line, index) => [index + 1, line])
}

/** Every main-process source that ships. Tests, the real-CLI tests and the allowlist are not. */
function sources(): [string, string][] {
  return walk(MAIN).filter(
    ([file]) => !/\.(test|itest)\.tsx?$/.test(file) && !ALLOWED.some((entry) => file.startsWith(entry.path)),
  )
}

function walk(root: string, prefix = 'src/main'): [string, string][] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    const shown = `${prefix}/${name}`
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, shown)
    if (!/\.tsx?$/.test(name)) return []
    return [[shown, readFileSync(path, 'utf8')] as [string, string]]
  })
}
