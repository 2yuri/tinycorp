import { describe, expect, it } from 'vitest'
import { onDisk } from '../../core/testing'
import { detectRepo, type FolderReader } from './stack-detection'

function folder(files: Record<string, string>, git = true): { read: FolderReader; isGitRepo: () => boolean } {
  return { read: (name) => files[name] ?? null, isGitRepo: () => git }
}

describe('stack detection', () => {
  it('reads a pnpm TypeScript project with its scripts', () => {
    const repo = folder({
      'package.json': JSON.stringify({
        packageManager: 'pnpm@11.9.0',
        scripts: { build: 'vite build', test: 'vitest run', lint: 'biome check' },
        dependencies: { react: '^19' },
        devDependencies: { typescript: '^7' },
      }),
    })

    expect(detectRepo(onDisk('/code/web'), repo)).toEqual({
      path: onDisk('/code/web'),
      gitRepo: true,
      stack: { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' },
      commands: ['pnpm install', 'pnpm build', 'vitest run', 'biome check'],
    })
  })

  it('takes the package manager from the lockfile and skips scripts that are missing', () => {
    const repo = folder({
      'package.json': JSON.stringify({ scripts: { test: 'jest' }, dependencies: { express: '^5' } }),
      'yarn.lock': '',
    })

    expect(detectRepo(onDisk('/code/api'), repo)).toMatchObject({
      stack: { language: 'JavaScript', framework: 'Express', packageManager: 'yarn' },
      commands: ['yarn install', 'jest'],
    })
  })

  it('prefers the most specific framework', () => {
    const repo = folder({
      'package.json': JSON.stringify({ dependencies: { next: '15', react: '19' } }),
      'tsconfig.json': '{}',
    })

    expect(detectRepo(onDisk('/code/site'), repo).stack).toEqual({
      language: 'TypeScript',
      framework: 'Next.js',
      packageManager: 'npm',
    })
  })

  it('recognises Rust and Go projects', () => {
    expect(detectRepo(onDisk('/code/cli'), folder({ 'Cargo.toml': '[package]' }))).toMatchObject({
      stack: { language: 'Rust', framework: 'none', packageManager: 'cargo' },
      commands: ['cargo build', 'cargo test', 'cargo clippy'],
    })
    expect(detectRepo(onDisk('/code/svc'), folder({ 'go.mod': 'module x' }))).toMatchObject({
      stack: { language: 'Go', framework: 'none', packageManager: 'go' },
      commands: ['go build ./...', 'go test ./...', 'go vet ./...'],
    })
  })

  it('reports a folder it cannot read as having no stack', () => {
    expect(detectRepo(onDisk('/code/empty'), folder({}, false))).toEqual({
      path: onDisk('/code/empty'),
      gitRepo: false,
      stack: null,
      commands: [],
    })
    expect(detectRepo(onDisk('/code/broken'), folder({ 'package.json': '{oops' })).stack).toBeNull()
  })
})
