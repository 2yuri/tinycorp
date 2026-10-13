/**
 * A Provider's adapter, running inside a WSL distro (T167).
 *
 * The machine's half of this is `main/platform/wsl-runtime.ts` — the `wsl.exe` line, the path
 * translation, the wrapped `spawnPty` and `runCli`. What is left here is the half that is about a
 * *Provider*: the one command an adapter hands back for the boss's own terminal, and the RTK its
 * Sessions are spawned with. It sits in `providers` rather than in `platform` because it names a
 * {@link ProviderAdapter}, and the machine is below every Provider, never above one (T186a).
 */

import { WSL_COMMAND, type WslRuntimeOptions, wslCommand, wslEnv } from '../platform'
import { isDefaultDir, type ProviderAdapter } from './provider-adapter'

/**
 * The adapter, running inside a distro.
 *
 * `spawn`, `injectMcp` and `checkCli` are already taken care of underneath — the adapter was built
 * with a wrapped `spawnPty` and a wrapped `runCli` — so what is left is the two commands the adapter
 * hands *back*, for a terminal rather than for the app: `handoffCommand` (T164), which the boss
 * pastes into their own terminal, and which has to run where the Session runs — so it comes back as
 * the `wsl.exe` line that does that and not as a `claude` Windows has never heard of.
 *
 * The sign-in is not one of them any more (T263): it runs in a terminal inside the app, spawned
 * through the same wrapped PTY a Session is, so it is in the distro for the reason a Session is.
 */
export function wslAdapter(adapter: ProviderAdapter, options: WslRuntimeOptions): ProviderAdapter {
  /**
   * The same spawn, with the RTK swapped for the one inside the distro (T179). The adapter is
   * handed a binary its own Session can really run; a distro with no RTK is handed none at all, and
   * its Employees read what their commands print. Nothing at all where no one has looked
   * (`rtkPath` left out), which is every machine that is not a Windows with WSL.
   */
  const inside: ProviderAdapter =
    options.rtkPath === undefined
      ? adapter
      : {
          ...adapter,
          spawn(request) {
            if (!request.rtk) return adapter.spawn(request)
            const { rtk, ...rest } = request
            const path = options.rtkPath
            return adapter.spawn(path ? { ...rest, rtk: { ...rtk, path } } : rest)
          },
        }
  const signIn = inside.accounts
  const configDirEnv = inside.configDirEnv
  const withLogin: ProviderAdapter = signIn
    ? {
        ...inside,
        accounts: () => {
          const support = signIn.call(adapter)
          const email = support.email
          return {
            ...support,
            // The default folder in here is the distro's own, in a home this side reads over UNC;
            // the Windows one `defaultDir` names is not the login the Sessions run on (T257).
            ...(email && {
              email: (configDir: string) => (isDefaultDir(support, configDir) ? null : email(configDir)),
            }),
          }
        },
        // The account's own folder is on this PC, and a `C:\Users\…` names no folder in the distro:
        // the login would write the sign-in somewhere the CLI in there never reads (T257). `WSLENV`
        // is what makes `wsl.exe` translate it, and it is the same rule a Session's spawn uses.
        ...(configDirEnv && {
          configDirEnv: (configDir: string) => wslEnv(configDirEnv.call(adapter, configDir), {}),
        }),
      }
    : inside
  if (!withLogin.handoffCommand) return withLogin
  const handoff = withLogin.handoffCommand.bind(adapter)
  return {
    ...withLogin,
    handoffCommand(employee, providerSessionId) {
      const command = handoff(employee, providerSessionId)
      if (!command || command.length === 0) return command
      const [file, ...args] = command
      return inDistro(file!, args, options)
    },
  }
}

/** One command as the line that runs it inside the distro, for a terminal of the boss's own. */
function inDistro(command: string, args: readonly string[], options: WslRuntimeOptions): string[] {
  return [
    WSL_COMMAND,
    ...wslCommand({
      distro: options.distro,
      cwd: null,
      command,
      args,
      ...(options.automountRoot && { automountRoot: options.automountRoot }),
      path: options.path ?? null,
    }),
  ]
}
