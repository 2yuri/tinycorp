import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../core/engine/migrations'
import { memorySecrets } from '../../platform'
import { createEnvironmentRuns } from './environment-runs'
import { createEnvironments } from './environments'

/**
 * `env_run` from an Employee inside a WSL distro (T259).
 *
 * The Employee was told its worktree is `/home/b/Acme/worktrees/ticket-tc-4`, because that is what it
 * is inside the distro — so that is the `cwd` it names. The app holds the same folder as
 * `\\wsl.localhost\Arch\home\b\Acme\worktrees\ticket-tc-4`, and `resolve` on Windows reads a Linux
 * path as relative to the drive the app is on: `C:\home\b\…`, which is inside nobody's worktree. The
 * tool refused every command an Employee in a distro could ever send.
 *
 * There is no distro here, and none is needed: the whole answer is `runtimePaths`, a pair of pure
 * translations that is deliberately free of `process.platform`, so this says the same thing on the
 * Windows runner, the Linux one and a Mac.
 */
describe('env_run with a cwd from inside a distro', () => {
  const worktree = '\\\\wsl.localhost\\Arch\\home\\b\\Acme\\worktrees\\ticket-tc-4'

  function runs() {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    db.prepare(
      `INSERT INTO repo (id, name, path, language, framework, package_manager, added_at)
       VALUES ('web', 'web', ?, 'TypeScript', 'none', 'pnpm', '2026-01-01T00:00:00.000Z')`,
    ).run(worktree)
    db.prepare(
      `INSERT INTO ticket (id, title, column_id, assignee_id, position) VALUES (4, 'Login', 'doing', 'e1', 0)`,
    ).run()
    db.prepare(
      `INSERT INTO worktree (ticket_id, repo_id, path, branch, base, created_at)
       VALUES (4, 'web', ?, 'ticket-tc-4', 'main', '2026-01-01T00:00:00.000Z')`,
    ).run(worktree)
    const commands: { cwd: string }[] = []
    const service = createEnvironmentRuns({
      db: () => db,
      environments: createEnvironments({
        current: () => ({ db, companyId: 'c1' }),
        secrets: memorySecrets(),
        notify: () => {},
        backend: () => 'keychain',
      }),
      approvals: { ask: () => ({ id: 'a1', status: 'granted' }) } as never,
      runtimeFor: () => ({ kind: 'wsl', distro: 'Arch' }),
      run: (input: { cwd: string }) => {
        commands.push({ cwd: input.cwd })
        return Promise.resolve({ code: 0, output: '' })
      },
    } as never)
    return { service, commands, db }
  }

  it('takes the Linux path the Employee was given and runs in the folder it names', async () => {
    const { service, commands } = runs()

    await service.run('e1', { command: 'pnpm build', environment: 'dev', cwd: '/home/b/Acme/worktrees/ticket-tc-4' })

    expect(commands.at(-1)?.cwd).toBe(worktree)
  })

  it('names the worktree in the Employee\u2019s own spelling when it refuses one', async () => {
    const { service } = runs()

    const refusal = await service
      .run('e1', { command: 'pnpm build', environment: 'dev', cwd: '/etc' })
      .then(() => null)
      .catch((error: unknown) => (error as Error).message)

    expect(refusal).toContain('/home/b/Acme/worktrees/ticket-tc-4')
    // The path it refused is in the Employee's spelling too, not the `\\wsl.localhost\…` it sent none of.
    expect(refusal).toContain('/etc is not inside')
    // Never the app's own spelling: an Employee in a distro cannot `cd` to a `\\wsl.localhost\…`.
    expect(refusal).not.toContain('wsl.localhost')
  })
})
