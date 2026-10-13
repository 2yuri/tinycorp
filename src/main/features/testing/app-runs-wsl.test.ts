import { describe, expect, it } from 'vitest'
import { shellInvocation } from '../../platform'

/**
 * `Run it` where the team runs (T259).
 *
 * `spawnRunCommand` has taken a runtime since T167, and `createAppRuns` has had the option; nothing
 * ever handed one in, so a boss whose team is in a distro pressed **Run it** and got a Windows shell
 * in a worktree on a WSL share. `pnpm dev` there is the wrong `node_modules` — installed against the
 * distro's libc — and often no `pnpm` at all.
 */
/**
 * And what that runtime does to the command line, which is `shell-command.ts`'s and is what makes the
 * distro's own login shell the thing that parses `pnpm dev` (T166, T167).
 */
describe('the command line a distro runtime produces', () => {
  it('runs inside the distro, in the worktree as the distro names it', () => {
    const invocation = shellInvocation('pnpm dev', {
      cwd: '\\\\wsl.localhost\\Arch\\home\\b\\Acme\\worktrees\\t-4',
      runtime: { kind: 'wsl', distro: 'Arch' },
      platform: 'win32',
      env: {},
    })
    expect(invocation.file).toBe('wsl.exe')
    expect(invocation.args.slice(0, 4)).toEqual(['-d', 'Arch', '--cd', '/home/b/Acme/worktrees/t-4'])
    expect(invocation.args.slice(-3)).toEqual(['sh', '-c', 'pnpm dev'])
  })

  it('is the platform shell when the team runs on this PC', () => {
    const posix = shellInvocation('pnpm dev', { cwd: '/repo', runtime: null, platform: 'darwin', env: {} })
    expect(posix).toMatchObject({ file: '/bin/sh', args: ['-c', 'pnpm dev'] })
  })
})
