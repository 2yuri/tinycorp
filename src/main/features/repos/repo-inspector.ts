import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INSPECT_CAP } from '../../../shared/repos/found-repos'
import type { RepoInspection, StackConstraints } from '../../../shared/repos/repo'
import { createGitRunner, type GitRunner } from '../../platform'

/** What the inspector may read: git output (null on failure) and files in the checkout. */
export interface InspectorDeps {
  git(cwd: string, args: string[]): string | null
  readFile(path: string): string | null
  /** File names at the top of a folder; empty when it cannot be read. */
  list(folder: string): string[]
}

/**
 * The inspector over a real disk and the app's one git (T259): a repo inside a distro is read by the
 * distro's own git, which is also the only one that will answer for it at all — asked from Windows
 * over the share, every file under it has an owner this Windows refuses to trust.
 *
 * `mapPaths`, because the inspector reads a checkout's toplevel and its `origin`, and the toplevel
 * is a path the app goes on to store.
 */
export function diskInspector(git: GitRunner = createGitRunner()): InspectorDeps {
  return {
    git: (cwd, args) => git.tryText(cwd, args, { mapPaths: true })?.trim() ?? null,
    readFile(path) {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },
    list(folder) {
      try {
        return existsSync(folder) ? readdirSync(folder) : []
      } catch {
        return []
      }
    },
  }
}

/** The disk inspector every caller that has no runner of its own gets. */
export const diskInspectorDeps: InspectorDeps = diskInspector()

export type InspectRepo = (path: string) => RepoInspection

/** Reads a checkout's origin, default branch and history, and detects its stack. Never throws. */
export function createRepoInspector(deps: InspectorDeps = diskInspectorDeps): InspectRepo {
  return (path) => {
    const files = new Set(deps.list(path))
    const isGitRepo = files.has('.git')
    const empty: RepoInspection = {
      path,
      isGitRepo,
      remote: null,
      defaultBranch: null,
      commitCount: null,
      lastCommitAt: null,
      detected: detectStack(path, files, deps),
    }
    if (!isGitRepo) return empty
    const git = (...args: string[]) => deps.git(path, args) || null
    const remoteUrl = git('remote', 'get-url', 'origin')
    const originHead = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    const defaultBranch = originHead?.replace(/^origin\//, '') ?? git('rev-parse', '--abbrev-ref', 'HEAD')
    const ref = originHead ?? 'HEAD'
    const count = git('rev-list', '--count', ref)
    return {
      ...empty,
      remote: remoteUrl ? displayRemote(remoteUrl) : null,
      defaultBranch: defaultBranch === 'HEAD' ? null : defaultBranch,
      commitCount: count !== null && /^\d+$/.test(count) ? Number(count) : null,
      lastCommitAt: git('log', '-1', '--format=%cI', ref),
    }
  }
}

/**
 * Reads several checkouts, {@link INSPECT_CAP} at a time, handing the main process a turn between
 * batches. Inspecting is three `git` calls per repo, so a folder of 110 would fork 330 at once and
 * hold the window still; the rows the boss can see are asked for first and the rest as they scroll
 * into view (T168).
 */
export async function inspectMany(
  paths: readonly string[],
  inspect: InspectRepo,
  options: { cap?: number; breathe?(): Promise<void> } = {},
): Promise<Record<string, RepoInspection>> {
  const cap = Math.max(1, options.cap ?? INSPECT_CAP)
  const breathe = options.breathe ?? (() => new Promise<void>((done) => setImmediate(done)))
  const read: Record<string, RepoInspection> = {}
  for (let from = 0; from < paths.length; from += cap) {
    if (from > 0) await breathe()
    for (const path of paths.slice(from, from + cap)) read[path] = inspect(path)
  }
  return read
}

/** `git@github.com:acme/web.git` and `https://github.com/acme/web.git` both read `github.com/acme/web`. */
export function displayRemote(url: string): string {
  const trimmed = url.trim()
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(trimmed)
  const bare = scp ? `${scp[1]}/${scp[2]}` : trimmed.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '')
  return bare.replace(/\.git$/, '').replace(/\/+$/, '')
}

interface PackageJson {
  packageManager?: unknown
  scripts?: Record<string, unknown>
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
}

const LOCKFILES: [file: string, manager: string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

/** Dependency → framework, most specific first. */
const FRAMEWORKS: [dependency: string, framework: string][] = [
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['electron', 'Electron'],
  ['@angular/core', 'Angular'],
  ['@remix-run/react', 'Remix'],
  ['svelte', 'Svelte'],
  ['vue', 'Vue'],
  ['react', 'React'],
  ['@nestjs/core', 'NestJS'],
  ['fastify', 'Fastify'],
  ['hono', 'Hono'],
  ['express', 'Express'],
]

/** Stack fields read from lockfiles, package.json and linter configs; only what was found. */
export function detectStack(
  folder: string,
  files: Set<string>,
  deps: Pick<InspectorDeps, 'readFile'>,
): Partial<StackConstraints> {
  if (files.has('package.json')) return detectNode(folder, files, deps)
  if (files.has('go.mod')) {
    return {
      language: 'Go',
      packageManager: 'go modules',
      install: 'go mod download',
      build: 'go build ./...',
      test: 'go test ./...',
      lint: 'go vet ./...',
    }
  }
  if (files.has('Cargo.toml')) {
    return {
      language: 'Rust',
      packageManager: 'cargo',
      install: 'cargo fetch',
      build: 'cargo build',
      test: 'cargo test',
      lint: 'cargo clippy',
    }
  }
  return {}
}

function detectNode(
  folder: string,
  files: Set<string>,
  deps: Pick<InspectorDeps, 'readFile'>,
): Partial<StackConstraints> {
  let pkg: PackageJson = {}
  try {
    pkg = JSON.parse(deps.readFile(join(folder, 'package.json')) ?? '{}') as PackageJson
  } catch {
    // An unreadable package.json still tells us it is a Node project.
  }
  const declared = typeof pkg.packageManager === 'string' ? /^([\w-]+)@(\d+)/.exec(pkg.packageManager) : null
  const manager = declared?.[1] ?? LOCKFILES.find(([file]) => files.has(file))?.[1] ?? 'npm'
  const scripts = pkg.scripts ?? {}
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  const run = (script: string) =>
    manager === 'npm' && script !== 'test' ? `npm run ${script}` : `${manager} ${script}`

  const stack: Partial<StackConstraints> = {
    language: files.has('tsconfig.json') || 'typescript' in allDeps ? 'TypeScript' : 'JavaScript',
    packageManager: manager,
    install: `${manager} install`,
  }
  if (declared?.[2] !== undefined) stack.packageManagerVersion = declared[2]
  const framework = FRAMEWORKS.find(([dependency]) => dependency in allDeps)?.[1]
  if (framework) stack.framework = framework
  if (typeof scripts['build'] === 'string') stack.build = run('build')
  if (typeof scripts['test'] === 'string') stack.test = run('test')
  if (typeof scripts['lint'] === 'string') stack.lint = run('lint')
  else if (files.has('biome.json') || files.has('biome.jsonc')) stack.lint = 'biome check .'
  else if ([...files].some((file) => file.startsWith('eslint.config') || file.startsWith('.eslintrc'))) {
    stack.lint = 'eslint .'
  }
  return stack
}
