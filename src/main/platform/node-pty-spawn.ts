import { accessSync, chmodSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { cliInvocation } from './cli-command'
import type { SpawnPty } from './pty'

/** node-pty, loaded on first use so tests never need the native module. */
export const nodePtySpawn: SpawnPty = (file, args, options) => {
  const require = createRequire(import.meta.url)
  const pty = require('node-pty') as typeof import('node-pty')
  ensureSpawnHelperExecutable(require)
  const { file: image, args: argv, verbatim } = cliInvocation(file, args, options.env)
  // node-pty on Windows takes a string as the command line to append as it stands, which is the
  // only way to hand `cmd.exe` a line it has already quoted (T166). Everywhere else it is a list.
  const term = pty.spawn(image, verbatim ? argv.join(' ') : argv, { name: 'xterm-256color', ...options })
  return {
    write: (data) => term.write(data),
    onData: (listener) => {
      const subscription = term.onData(listener)
      return () => subscription.dispose()
    },
    onExit: (listener) => {
      const subscription = term.onExit(({ exitCode }) => listener({ exitCode }))
      return () => subscription.dispose()
    },
    kill: () => term.kill(),
    resize: (cols, rows) => term.resize(cols, rows),
  }
}

/** pnpm installs node-pty's prebuilt spawn-helper without the execute bit (spike v0, finding 8). */
function ensureSpawnHelperExecutable(require: NodeJS.Require): void {
  if (process.platform === 'win32') return
  const root = dirname(require.resolve('node-pty/package.json'))
  const helper = join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
  if (!existsSync(helper)) return
  try {
    accessSync(helper, constants.X_OK)
  } catch {
    chmodSync(helper, 0o755)
  }
}
