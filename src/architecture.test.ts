import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The architecture, as a test.
 *
 * `ARCHITECTURE.md` says what the modules are and which way they are allowed to point;
 * `docs/architecture/modules.md` says which file belongs to which module. This reads both and
 * checks five rules against every import in the repo, so a boundary that is only written down
 * stops being a boundary the first time somebody is in a hurry (T184).
 *
 * It reads the source as text rather than through the TypeScript compiler on purpose: the rules
 * are about which file names which file, the answer has to be the same on three platforms, and a
 * regex over 1,100 files runs in under a second.
 *
 * Every rule holds outright. There is no allowlist: T182 to T188 put a front door on every module
 * in the main process and T202 put one on every folder in the renderer, so what is left is three
 * named exceptions in this file — `DELIBERATE_REACHES` and `CAPTURE_HARNESSES` below, and the
 * capture harnesses and tests that rule 3 skips — each of which says in one place why it is there.
 * A list of counts could only ever say how much debt was left.
 */

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')

/** Sanity floors. A check that scanned nothing passes every rule it has. */
const LEAST_FILES = 1000
const LEAST_IMPORTS = 3000
const LEAST_TESTS = 300
const LEAST_CAPTURES = 20

describe('src/shared', () => {
  it('imports nothing from a process: it is what the two of them agree on', () => {
    const offenders = graph()
      .filter((edge) => edge.from.startsWith('shared/') && !edge.to.startsWith('shared/'))
      .map(
        (edge) =>
          `${edge.from}:${edge.line} imports ${edge.to}; shared is what the main process and the renderer agree on, ` +
          'so it may name neither — see ARCHITECTURE.md',
      )

    expect(offenders).toEqual([])
  })
})

describe('The two processes', () => {
  it('never import each other: the only thing they share is src/shared and the preload contract', () => {
    const offenders = graph()
      .filter((edge) => crosses(edge.from, edge.to))
      .filter((edge) => !CAPTURE_HARNESSES.includes(edge.from))
      .map(
        (edge) =>
          `${edge.from}:${edge.line} imports ${edge.to}; the main process and the renderer are two programs, ` +
          'and what they share goes in src/shared — see ARCHITECTURE.md',
      )

    expect(offenders).toEqual([])
  })

  it('name every capture harness that is allowed to cross, and none that no longer does', () => {
    const crossing = new Set(
      graph()
        .filter((edge) => crosses(edge.from, edge.to))
        .map((edge) => edge.from),
    )

    for (const file of CAPTURE_HARNESSES) {
      expect(
        crossing.has(file),
        `${file} is allowed to import across the process boundary and no longer does; take it out of ` +
          'src/architecture.test.ts',
      ).toBe(true)
    }
  })
})

describe('A module', () => {
  it('is reached through its front door, or through src/shared', () => {
    const offenders = reaches().map((edge) => {
      const to = moduleOf(edge.to)
      return (
        `${edge.from}:${edge.line} imports ${edge.to}; ${to} is reached only through ${to}/index.ts or ` +
        'src/shared. See ARCHITECTURE.md'
      )
    })

    expect(offenders).toEqual([])
  })

  it('names the reaches that are deliberate, and none that is no longer there', () => {
    const imports = new Set(graph().map((edge) => `${edge.from} -> ${edge.to}`))

    for (const reach of DELIBERATE_REACHES) {
      expect(
        imports.has(reach),
        `${reach} is named as a deliberate reach in src/architecture.test.ts and is not in the tree; ` + 'take it out',
      ).toBe(true)
    }
  })
})

describe('The dependency direction', () => {
  it('is down only: app → features → core/providers/forges → platform, and everyone → shared', () => {
    const offenders = wrongWay().flatMap(({ pair, from, to, edges }) =>
      edges.map(
        (edge) =>
          `${edge.from}:${edge.line} imports ${edge.to}; ${pair.split(' -> ')[0]} is ${LAYER_NAME[from]} and ` +
          `${pair.split(' -> ')[1]} is ${LAYER_NAME[to]}, so this points up. See ARCHITECTURE.md`,
      ),
    )

    expect(offenders).toEqual([])
  })
})

describe('The import graph', () => {
  it('has no runtime cycle: a module that is half-built when another one reads it is a bug nobody can see', () => {
    expect(cycles()).toEqual([])
  })

  it('is big enough to be the real one, so no rule above can pass by finding nothing', () => {
    expect(sources().length).toBeGreaterThan(LEAST_FILES)
    expect(graph().length).toBeGreaterThan(LEAST_IMPORTS)
    expect(MODULES.size).toBeGreaterThan(30)
    // Rule 3 skips tests and capture harnesses, so both have to be found by the names they have.
    expect(sources().filter(isTest).length).toBeGreaterThan(LEAST_TESTS)
    expect(sources().filter(isCapture).length).toBeGreaterThan(LEAST_CAPTURES)
  })

  it('knows which module every file that ships belongs to', () => {
    const unplaced = sources().filter((file) => !isTest(file) && moduleOf(file) === null)

    expect(
      unplaced,
      'every file outside the renderer is a line in docs/architecture/modules.md; add it to the module that owns it',
    ).toEqual([])
  })
})

/** One import, as the rules read it: who names whom, and on which line. */
interface Edge {
  from: string
  to: string
  line: number
  /** `import type` / `export type`, which no bundler emits and no cycle can go through. */
  erased: boolean
}

/** Whether these two files are in different processes. `src/shared` and `src/preload` are neither. */
function crosses(from: string, to: string): boolean {
  const side = (file: string) => (file.startsWith('main/') ? 'main' : file.startsWith('renderer/') ? 'renderer' : null)
  const a = side(from)
  const b = side(to)
  return a !== null && b !== null && a !== b
}

/**
 * Every cross-module import that goes round the front door.
 *
 * Only files that ship. A test may reach for the module it tests and for the fakes and in-memory
 * databases the engine's own test kit hands out; what the rule protects is the graph the app is
 * built from. Rules 1, 2 and 4 hold for tests too.
 *
 * A capture harness is skipped for the same reason (`isCapture`), and the imports in
 * `DELIBERATE_REACHES` are skipped because they are argued for here rather than counted.
 */
function reaches(): Edge[] {
  return graph().filter((edge) => {
    if (isTest(edge.from) || isCapture(edge.from)) return false
    if (edge.to.startsWith('shared/')) return false
    if (/\/index\.tsx?$/.test(edge.to)) return false
    if (DELIBERATE_REACHES.includes(`${edge.from} -> ${edge.to}`)) return false
    const from = moduleOf(edge.from)
    const to = moduleOf(edge.to)
    return from !== null && to !== null && from !== to
  })
}

/**
 * The reaches this repo makes on purpose, each one named as the single import it is.
 *
 * The first is the composition root naming a test kit. `main/index.ts` starts the app on
 * the fake adapters when `TINYCORP_E2E` is set, and no module here publishes its fakes through its
 * front door: a fake on the front door is a fake every consumer of that module can see. So the root
 * names the kit directly, and a packaged build never takes that branch (`src/main/app/e2e-mode.ts`).
 * Teaching rule 3 that a `testing.ts` is a second front door would put a fake within reach of
 * everything, which is the thing this line exists to avoid.
 *
 * The second is `cx` (T226). Every class list in the renderer goes through it, `CharacterPortrait`
 * included — it takes a caller's `className` and puts it on the same element as its own list, which
 * is the tie `cx` exists to untie. `sprites` sits below both the office and the kit and names
 * nothing else in the renderer, and the kit's front door cannot be what it names: `ui/index.ts`
 * reaches back into `sprites` through `Avatar`, so the barrel would close a cycle that both this
 * file and Biome fail on. `ui/kit/cx.ts` is a leaf — `tailwind-merge` and four scales, importing
 * nothing of this app — so naming the file closes nothing.
 */
const DELIBERATE_REACHES: readonly string[] = [
  'main/index.ts -> main/providers/testing.ts',
  'renderer/src/sprites/CharacterPortrait.tsx -> renderer/src/ui/kit/cx.ts',
]

/**
 * Whether a file is a capture harness: anything under a folder named for a capture.
 *
 * A capture draws one screen over real data so the Pen frame and the app can be compared side by
 * side (the design audit notes). It is a dev-server entry, it ships in nothing, and its job is to
 * stand exactly where a screen stands — which means reaching for the fixture another capture
 * already wrote, and for the screen it is a capture of. Rule 3 skips it for the same reason it
 * skips a test. Rule 2 does not: crossing between the two processes is a different promise, and the
 * one harness that does it is named a file at a time in `CAPTURE_HARNESSES`.
 */
function isCapture(file: string): boolean {
  return /(^|\/)[a-z-]*capture[a-z-]*\//.test(file)
}

/**
 * The capture harnesses that are allowed to import the other process (rule 2).
 *
 * The Files capture serves its data out of the engine itself: its whole point is that the tree, the
 * diffs and the hovers are this checkout's own, not a fixture. It is a dev-server config, it ships
 * in nothing, and it is named here one file at a time so a capture folder never becomes a hole in
 * the rule.
 */
const CAPTURE_HARNESSES: readonly string[] = ['renderer/src/files/capture/vite.config.mts']

/**
 * The layers of `ARCHITECTURE.md`'s diagram, and who each one may name.
 *
 * `platform` is the machine and names nothing above it. `providers` and `forges` are the two seams
 * and name only the machine and what a Company is. A feature may name the layers below it and its
 * peers — sideways is rule 3's business, not this rule's — and never the composition root. `app`
 * wires everything and so may name everything.
 *
 * `core` naming a feature is allowed, and it is the composition root doing it: `core/engine`
 * registers every feature against the context they share. What is not allowed is the other half of
 * that — a feature reaching the engine — and it cannot happen, because the engine is behind a front
 * door of its own that nothing below it names (T188).
 */
type Layer = 'platform' | 'core' | 'seam' | 'feature' | 'app'

const LAYER_NAME: Record<Layer, string> = {
  platform: 'the machine',
  core: 'what a Company is',
  seam: 'a seam',
  feature: 'a feature',
  app: 'the composition root',
}

const MAY_NAME: Record<Layer, readonly Layer[]> = {
  platform: [],
  core: ['platform', 'core', 'seam', 'feature'],
  seam: ['platform', 'core'],
  feature: ['platform', 'core', 'seam', 'feature'],
  app: ['platform', 'core', 'seam', 'feature', 'app'],
}

/**
 * The layer a module sits in, or null when the diagram does not place it: the renderer, which has
 * a shape of its own, and the few modules that are only `src/shared` or only tooling.
 */
function layerOf(module: string): Layer | null {
  if (module === 'platform' || module === 'core' || module === 'app') return module
  if (module === 'providers' || module === 'forges') return 'seam'
  return mainModules().has(module) ? 'feature' : null
}

/** Every module with at least one file in the main process; the rest are shared, preload or tooling. */
const mainModules = once(
  () => new Set([...MODULES].filter(([file]) => file.startsWith('main/')).map(([, module]) => module)),
)

/**
 * Every import that points up, grouped by `from -> to`.
 *
 * Only files that ship, as rule 3 counts them, and never an import of `src/shared`: everyone may
 * name what the two processes agree on, whichever layer wrote it.
 */
function wrongWay(): Inverted[] {
  const byPair = new Map<string, Inverted>()
  for (const edge of graph()) {
    if (isTest(edge.from)) continue
    if (edge.to.startsWith('shared/')) continue
    const fromModule = moduleOf(edge.from)
    const toModule = moduleOf(edge.to)
    if (fromModule === null || toModule === null || fromModule === toModule) continue
    const from = layerOf(fromModule)
    const to = layerOf(toModule)
    if (from === null || to === null) continue
    if (MAY_NAME[from].includes(to)) continue
    const pair = `${fromModule} -> ${toModule}`
    const found = byPair.get(pair)
    byPair.set(pair, { pair, from, to, edges: [...(found?.edges ?? []), edge] })
  }
  return [...byPair.values()].sort((a, b) => a.pair.localeCompare(b.pair))
}

/** One `from -> to` that points up the diagram, with the layer each side sits in. */
interface Inverted {
  pair: string
  from: Layer
  to: Layer
  edges: Edge[]
}

/** Every import cycle, as the chain that closes it. Type-only imports are not in the graph. */
function cycles(): string[] {
  const out: string[] = []
  const next = new Map<string, string[]>()
  for (const edge of graph()) {
    if (edge.erased) continue
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to])
  }
  const state = new Map<string, 'open' | 'done'>()
  const stack: string[] = []
  const walk = (file: string) => {
    state.set(file, 'open')
    stack.push(file)
    for (const to of next.get(file) ?? []) {
      if (state.get(to) === 'done') continue
      if (state.get(to) === 'open') out.push([...stack.slice(stack.indexOf(to)), to].join(' -> '))
      else walk(to)
    }
    stack.pop()
    state.set(file, 'done')
  }
  for (const file of sources()) if (!state.has(file)) walk(file)
  return out
}

const TEST = /\.(test|itest)\.tsx?$/

function isTest(file: string): boolean {
  return TEST.test(file)
}

/** The module a file belongs to, or null when the map does not place it. */
function moduleOf(file: string): string | null {
  if (file.startsWith('renderer/src/')) {
    // A file directly under `src/renderer/src/` — App.tsx, main.tsx — is the renderer's own
    // composition root, the way `app` is the main process's.
    const rest = file.slice('renderer/src/'.length)
    const slash = rest.indexOf('/')
    return slash === -1 ? 'renderer' : `renderer/${rest.slice(0, slash)}`
  }
  const named = MODULES.get(file)
  if (named) return named
  if (!isTest(file)) return null
  const stem = file.replace(/\.(dom\.)?(i)?test\.tsx?$/, '')
  return MODULES.get(`${stem}.ts`) ?? MODULES.get(`${stem}.tsx`) ?? null
}

/** `docs/architecture/modules.md`, read as a table: every file it names, and its module. */
function readModules(): Map<string, string> {
  const text = readFileSync(join(ROOT, 'docs', 'architecture', 'modules.md'), 'utf8')
  const table = new Map<string, string>()
  let module: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const heading = /^### ([\w-]+) \((\d+)\)$/.exec(line)
    if (heading?.[1]) {
      module = heading[1]
      continue
    }
    if (module === null || !line.startsWith('`')) continue
    for (const file of line.split(', ')) table.set(file.replace(/`/g, ''), module)
    module = null
  }
  return table
}

const MODULES = readModules()

/** Every import in the repo that names another file in it, in file order. */
const graph = once(() =>
  sources().flatMap((file) => {
    const text = readFileSync(join(SRC, file), 'utf8')
    return [...text.matchAll(SPECIFIER)].flatMap((match) => {
      const spec = (match[2] ?? match[3] ?? match[4] ?? '').split('?')[0] ?? ''
      const to = resolveImport(file, spec)
      if (to === null) return []
      return [
        {
          from: file,
          to,
          line: lineOf(text, match.index),
          erased: /(^|[\n;])\s*(?:import|export)\s+type\b/.test(match[0]),
        },
      ]
    })
  }),
)

/**
 * A module specifier, wherever one can appear: `from '…'`, a bare `import '…'`, and the dynamic
 * `import('…')`. Anchored on a line start or a `;` so a string in prose or in a fixture, which
 * happens in this repo's tests, is never mistaken for one.
 */
const SPECIFIER =
  /(^|[\n;])\s*(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|(^|[\n;])\s*import\s*['"]([^'"]+)['"]/g

/** Where `spec` really points, relative to `src/` and with `/` on every platform, or null. */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(join(SRC, from)), spec)
  const found = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx']
    .map((extension) => base + extension)
    .find((path) => existsSync(path) && statSync(path).isFile())
  if (!found) return null
  const posix = relative(SRC, found).split(sep).join('/')
  return /\.(ts|tsx|mts)$/.test(posix) ? posix : null
}

function lineOf(text: string, at: number): number {
  let line = 1
  for (let index = 0; index < at; index++) if (text[index] === '\n') line++
  return line
}

/** Every TypeScript file under `src/`, relative to it, with `/` on every platform. */
const sources = once(() => walk(SRC, ''))

function walk(dir: string, prefix: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, `${prefix}${name}/`)
      return /\.(ts|tsx|mts)$/.test(name) ? [`${prefix}${name}`] : []
    })
}

/** Reads the tree and the 1,100 files once per worker, not once per assertion. */
function once<T>(make: () => T): () => T {
  let value: T | undefined
  return () => {
    if (value === undefined) value = make()
    return value
  }
}
