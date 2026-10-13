import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DetectedRepo, StackConstraints } from '../../../shared/repos/repo'
import { type IsGitRepo, isGitRepoOnDisk } from './repos'

/** A file's text by its name inside the folder, or null when it is not there. */
export type FolderReader = (name: string) => string | null

/** Frameworks by the dependency that gives them away, most specific first. */
const FRAMEWORKS: [dependency: string, framework: string][] = [
  ['next', 'Next.js'],
  ['@remix-run/react', 'Remix'],
  ['astro', 'Astro'],
  ['nuxt', 'Nuxt'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['electron', 'Electron'],
  ['@angular/core', 'Angular'],
  ['@nestjs/core', 'NestJS'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['solid-js', 'Solid'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['hono', 'Hono'],
]

const LOCKFILES: [file: string, manager: string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

interface PackageJson {
  packageManager?: unknown
  scripts?: Record<string, unknown>
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
}

/** Whether `path` is a git repo, and the stack and commands its files declare. */
export function detectRepo(
  path: string,
  { read, isGitRepo }: { read: FolderReader; isGitRepo: IsGitRepo },
): DetectedRepo {
  const found = node(read) ?? cargo(read) ?? go(read)
  return { path, gitRepo: isGitRepo(path), stack: found?.stack ?? null, commands: found?.commands ?? [] }
}

/** Reads the folder on disk. */
export function detectRepoOnDisk(path: string): DetectedRepo {
  return detectRepo(path, {
    isGitRepo: isGitRepoOnDisk,
    read(name) {
      try {
        return readFileSync(join(path, name), 'utf8')
      } catch {
        return null
      }
    },
  })
}

type Found = { stack: Partial<StackConstraints>; commands: string[] } | null

function node(read: FolderReader): Found {
  const text = read('package.json')
  if (text === null) return null
  let pkg: PackageJson
  try {
    pkg = JSON.parse(text) as PackageJson
  } catch {
    return null
  }
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : undefined
  const manager = declared || LOCKFILES.find(([file]) => read(file) !== null)?.[1] || 'npm'
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const language = 'typescript' in deps || read('tsconfig.json') !== null ? 'TypeScript' : 'JavaScript'
  const framework = FRAMEWORKS.find(([dependency]) => dependency in deps)?.[1] ?? 'Node.js'
  const script = (name: string) => (typeof pkg.scripts?.[name] === 'string' ? (pkg.scripts[name] as string) : null)
  const commands = [
    `${manager} install`,
    script('build') !== null ? `${manager} build` : null,
    script('test'),
    script('lint'),
  ].filter((command): command is string => !!command)
  return { stack: { language, framework, packageManager: manager }, commands }
}

function cargo(read: FolderReader): Found {
  if (read('Cargo.toml') === null) return null
  return {
    stack: { language: 'Rust', framework: 'none', packageManager: 'cargo' },
    commands: ['cargo build', 'cargo test', 'cargo clippy'],
  }
}

function go(read: FolderReader): Found {
  if (read('go.mod') === null) return null
  return {
    stack: { language: 'Go', framework: 'none', packageManager: 'go' },
    commands: ['go build ./...', 'go test ./...', 'go vet ./...'],
  }
}
