import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The repo every cell of `pnpm bench:tokens` is run against (T190).
 *
 * The fixture is a real application pinned by commit, not a toy: a benchmark on a seeded stub
 * measures how a model writes one file, and what this ticket asks about — what RTK saves, what a
 * voice costs — only shows up when the agent has to read a codebase to find where the change goes.
 *
 * Two layers, and the split is the whole design:
 *
 * - **Prepared once**, in a cache under `os.tmpdir()`: the clone at its pinned commit and its
 *   `node_modules`. Installing 451 MB of dependencies in every one of eighty cells would measure
 *   npm, and doing it over the network would measure the network.
 * - **Fresh per run**: a copy of the working tree, its own `git init` and base commit, and a link
 *   to that one `node_modules`. Nothing an agent writes survives into another cell, and nothing an
 *   agent reads was left there by one.
 *
 * The link is the one thing shared between runs, so {@link installMarker} is read before and after
 * every cell: an agent that installed a package despite being told not to has changed the cache
 * under the next cell, and the run says so instead of quietly carrying it.
 */

/** Where the prepared clones and the run folders live. Wiped by a reboot, rebuilt on demand. */
export const BENCH_TMP = join(tmpdir(), 'tinycorp-bench')

/**
 * The fixtures this bench knows. One for now; the shape is here so a second is a row and not a
 * rewrite.
 *
 * `root` is a subdirectory because `bulletproof-react` is a monorepo of three apps and only one of
 * them is the fixture: cloning the repo and working inside `apps/react-vite` also means the
 * monorepo's own `AGENTS.md` is above the session's cwd and not read by it.
 */
export const FIXTURES = {
  'bulletproof-react': {
    id: 'bulletproof-react',
    name: 'alan2207/bulletproof-react (apps/react-vite)',
    url: 'https://github.com/alan2207/bulletproof-react.git',
    commit: '9506629ed003a561c6627735480cce4994244bb4',
    /** The app inside the clone, POSIX-spelled and joined with `node:path` at use. */
    root: ['apps', 'react-vite'],
    /** What makes the app runnable at all. Copied, never written by an agent, never in the diff. */
    seed: { '.env': '.env.example' },
    install: ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'],
    /** The fixture's own suite. Must be green before the bench spends anything. */
    test: ['vitest', 'run', '--reporter=dot'],
    /** What the workspace copy leaves behind. `node_modules` is linked, not copied. */
    skip: ['node_modules', '.git'],
  },
}

/** The fixture called `id`, or throws naming the ones there are. */
export function fixtureOf(id) {
  const one = FIXTURES[id]
  if (!one) throw new Error(`no fixture ${id}; this bench knows ${Object.keys(FIXTURES).join(', ')}`)
  return one
}

/** Where a fixture's prepared clone sits: named by commit, so moving the pin never reuses a tree. */
export function fixtureCache(one, root = BENCH_TMP) {
  return join(root, 'fixtures', `${one.id}-${one.commit.slice(0, 12)}`)
}

/** The app inside that clone — the directory a cell is actually copied from. */
export function fixtureRoot(one, root = BENCH_TMP) {
  return join(fixtureCache(one, root), ...one.root)
}

/**
 * What a cell has to agree about `node_modules` before and after it runs. npm writes every
 * installed tree's resolution into this file, so it changes the moment a package is added, removed
 * or moved — which is the thing the shared link makes possible and the rules forbid.
 */
export function installMarker(one, root = BENCH_TMP) {
  return join(fixtureRoot(one, root), 'node_modules', '.package-lock.json')
}

/** Bytes of the install marker, or null when it is not there. Compared, never parsed. */
export function installFingerprint(one, root = BENCH_TMP) {
  const file = installMarker(one, root)
  if (!existsSync(file)) return null
  return `${readFileSync(file, 'utf8').length}`
}

function run(command, args, cwd, env = process.env) {
  const out = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: false })
  if (out.error) throw out.error
  return { code: out.status, output: `${out.stdout ?? ''}${out.stderr ?? ''}` }
}

/**
 * The prepared clone, made if it is not there yet.
 *
 * `git init` plus a depth-1 fetch of the pinned sha rather than `clone`: a clone brings the whole
 * history down and then throws it away to check out one commit, and the pin is the point.
 *
 * Idempotent and cheap on the second call, which is what lets `--dry-run` and a resumed run share
 * one tree. `onStep` is how the CLI says what is taking the minutes.
 */
export function prepareFixture(one, { root = BENCH_TMP, onStep = () => {} } = {}) {
  const cache = fixtureCache(one, root)
  const app = fixtureRoot(one, root)
  if (!existsSync(join(cache, '.git'))) {
    onStep(`cloning ${one.name} at ${one.commit.slice(0, 12)}`)
    rmSync(cache, { recursive: true, force: true })
    mkdirSync(cache, { recursive: true })
    execFileSync('git', ['init', '-q', '.'], { cwd: cache, stdio: 'ignore' })
    execFileSync('git', ['remote', 'add', 'origin', one.url], { cwd: cache, stdio: 'ignore' })
    execFileSync('git', ['fetch', '-q', '--depth', '1', 'origin', one.commit], { cwd: cache, stdio: 'inherit' })
    execFileSync('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: cache, stdio: 'ignore' })
  }
  for (const [name, from] of Object.entries(one.seed)) {
    if (!existsSync(join(app, name))) cpSync(join(app, from), join(app, name))
  }
  if (!existsSync(installMarker(one, root))) {
    onStep('installing the fixture’s dependencies (once; every run links to this one tree)')
    const installed = run('npm', one.install, app)
    if (installed.code !== 0) throw new Error(`the fixture would not install:\n${installed.output.slice(-2000)}`)
  }
  return app
}

/**
 * The fixture's own suite, run where it is asked. Used twice: once on the prepared clone before
 * anything is spent, so a red fixture is found for free, and once per cell afterwards.
 *
 * `npx` rather than a path into `node_modules/.bin`, because that path is `.cmd` on Windows and
 * `npx` is the one spelling all three platforms agree on.
 *
 * The timeout is the ceiling a suite an agent has broken into an infinite loop hits, not a time
 * anything is expected to take: the fixture's own suite runs in five seconds.
 */
export function runFixtureTests(one, cwd, { timeout = 300_000 } = {}) {
  const started = Date.now()
  const out = spawnSync('npx', one.test, {
    cwd,
    encoding: 'utf8',
    timeout,
    shell: process.platform === 'win32',
    env: { ...process.env, CI: '1' },
  })
  return {
    passed: out.status === 0,
    code: out.status,
    ms: Date.now() - started,
    // The whole tail, kept in the run folder. What the committed JSONL keeps is decided once, in
    // `bench-tokens.mjs`, where the published record is written.
    output: `${out.stdout ?? ''}${out.stderr ?? ''}`.slice(-4000),
  }
}

/**
 * One cell's workspace: a copy of the prepared tree with its own history, and a link to the one
 * installed `node_modules`.
 *
 * `git init` here rather than copying the fixture's `.git`, so `git diff` against the base commit
 * is exactly what this agent did and nothing else. `info/exclude` rather than a `.gitignore` the
 * agent would see in its own diff: what the bench adds to a workspace should not read as part of
 * the repo the agent was handed.
 */
export function makeWorkspace(one, dir, { root = BENCH_TMP } = {}) {
  const from = fixtureRoot(one, root)
  mkdirSync(dir, { recursive: true })
  const skip = new Set(one.skip)
  for (const entry of readdirSync(from)) {
    if (skip.has(entry)) continue
    cpSync(join(from, entry), join(dir, entry), { recursive: true, verbatimSymlinks: true })
  }
  // A junction on Windows, which needs no elevation; a plain symlink everywhere else.
  symlinkSync(join(from, 'node_modules'), join(dir, 'node_modules'), 'junction')
  execFileSync('git', ['init', '-q', '.'], { cwd: dir, stdio: 'ignore' })
  const exclude = join(dir, '.git', 'info', 'exclude')
  mkdirSync(join(dir, '.git', 'info'), { recursive: true })
  writeFileSync(exclude, 'node_modules\n')
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync(
    'git',
    ['-c', 'user.email=bench@tinycorp.local', '-c', 'user.name=bench', 'commit', '-q', '-m', 'base', '--no-verify'],
    { cwd: dir, stdio: 'ignore' },
  )
  return dir
}

/**
 * What the agent left, as `git diff --numstat` counts it: lines added and removed, and the files.
 *
 * Lockfiles and generated files are dropped, because a `routeTree.gen.ts` regenerated by a tool is
 * not code anyone wrote and one of them outweighs every real line in the diff.
 */
export const GENERATED = ['-lock', '.lock', 'lock.json', '.gen.ts', '.gen.tsx']

export function diffStat(dir) {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  const out = execFileSync('git', ['diff', '--cached', '--numstat', 'HEAD'], { cwd: dir, encoding: 'utf8' })
  return readNumstat(out)
}

/** `git diff --numstat` output, read. Binary files (`-`) and generated ones do not count. */
export function readNumstat(text) {
  let added = 0
  let removed = 0
  const files = []
  for (const line of text.split('\n')) {
    const parts = line.split('\t')
    if (parts.length !== 3) continue
    const [plus, minus, path] = parts
    if (plus === '-' || minus === '-') continue
    if (path.split('/').includes('node_modules')) continue
    if (GENERATED.some((mark) => path.includes(mark))) continue
    added += Number.parseInt(plus, 10) || 0
    removed += Number.parseInt(minus, 10) || 0
    files.push(path)
  }
  return { added, removed, files }
}
