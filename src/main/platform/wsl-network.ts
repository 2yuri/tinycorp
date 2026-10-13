import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { shellQuote, type WslRunner } from './wsl'

/**
 * How a Session inside WSL reaches TinyCorp (T167) — the hard half of running a Provider there.
 *
 * The app listens on `127.0.0.1`: the hook receiver, so every Session can say what it is doing,
 * and the Company MCP server, which is the Session's hands. Inside a WSL2 distro on the default
 * NAT network `127.0.0.1` is **the distro itself**, so a hook POSTs into the void and the MCP
 * config points at nothing. A Session starts, looks alive and can do nothing at all — the exact
 * failure this file exists to prevent.
 *
 * Two networking modes, two answers:
 *
 * - **mirrored** (`networkingMode=mirrored` in `.wslconfig`, Windows 11 22H2 and later): the
 *   distro shares the host's interfaces, `127.0.0.1` is the host's loopback, and there is nothing
 *   to do. The URLs go across as they are and the receivers keep listening on loopback alone.
 * - **NAT** (the default): the distro is behind a virtual switch and the host is its **default
 *   gateway**. That gateway address is the Windows side of the `vEthernet (WSL)` adapter — so it
 *   is both the address the distro must call and an address this process can bind. The URLs are
 *   rewritten to it, and the receivers listen on it *as well as* loopback.
 *
 * Two rules that are not negotiable:
 *
 * - **Never `0.0.0.0`.** Binding every interface would put the Company MCP server — chat, the
 *   board, approvals, the repos — on the boss's office wifi. The receivers bind loopback and the
 *   one vEthernet address and nothing else, and a test says so.
 * - **The token checks stay.** Every hook carries its Session's token and every MCP call its
 *   bearer; widening the bind widens nothing about who is answered.
 *
 * `$(hostname).local` is the other address people use for this, and it is not used here: it needs
 * the distro's resolver to answer for a name the host has to be publishing, and it is empty or
 * wrong on a machine with mDNS off. The gateway is a number the distro already routes through.
 */

/** How this WSL is wired to the host. */
export type WslNetworkingMode = 'nat' | 'mirrored'

/** Where the Windows host is, seen from inside a distro. */
export interface WslHost {
  mode: WslNetworkingMode
  /**
   * The host's address as the distro must dial it: `127.0.0.1` in mirrored mode, the default
   * gateway in NAT. Null when NAT is in force and nothing could be read — the caller then leaves
   * the URLs on loopback and the row says the Session cannot reach the app, which is at least
   * true.
   */
  address: string | null
}

/** The address the app listens on, and the one that means something else inside a NAT distro. */
export const LOOPBACK = '127.0.0.1'

/** Mirrored mode needs nothing: loopback is the host's own. */
const MIRRORED: WslHost = { mode: 'mirrored', address: LOOPBACK }

/**
 * Whether this Windows runs WSL in mirrored mode, read from `.wslconfig` in the boss's profile
 * folder — the file that decides it, and the only way to find out without starting a distro.
 *
 * It is read rather than asked because the answer is needed before anything is started: the
 * receivers have to know what to bind before the first window draws, and starting Ubuntu to find
 * out would put seconds on every launch. {@link confirmMirrored} is the distro's own answer, asked
 * later, when something is being probed in there anyway.
 *
 * Anything unreadable, missing or unset is NAT, because NAT is what WSL does by default.
 */
export function wslNetworkingMode(text: string | null): WslNetworkingMode {
  if (!text) return 'nat'
  const setting = /^\s*networkingMode\s*=\s*(\w+)/im.exec(text)?.[1]
  return setting?.toLowerCase() === 'mirrored' ? 'mirrored' : 'nat'
}

/** Where `.wslconfig` lives: the boss's profile folder, per WSL's own documentation. */
export function wslConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const home = env['USERPROFILE'] ?? env['HOME']
  return home ? join(home, '.wslconfig') : null
}

/**
 * `wslinfo --networking-mode` from inside the distro: WSL's own answer, which beats the file
 * because it accounts for a `.wslconfig` that was edited after the distro last started, and for an
 * older WSL that has no mirrored mode to be in. Asked only when a distro is being probed anyway.
 * A `wslinfo` that is not there says nothing, and the file's answer stands.
 */
export function confirmMirrored(run: WslRunner, distro: string): boolean | null {
  const outcome = run(['-d', distro, '-e', 'sh', '-lc', 'wslinfo --networking-mode 2>/dev/null'])
  if (outcome.kind !== 'output' || outcome.output.trim() === '') return null
  return /mirrored/i.test(outcome.output)
}

/**
 * The Windows side of the WSL virtual switch — `vEthernet (WSL)`, or the `(Hyper-V firewall)`
 * spelling newer builds use. It is the address a NAT distro's default route points at, and this
 * process holds it, so it is both what the URLs are rewritten to and what the receivers bind.
 *
 * Read from this machine's own interfaces rather than from inside a distro, for the same reason as
 * above: it costs nothing and starts nothing. {@link defaultGateway} is the distro's own answer
 * and is used to check this one when there is a distro awake to ask.
 */
export function wslAdapterAddress(interfaces = networkInterfaces()): string | null {
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!/wsl/i.test(name)) continue
    const ipv4 = (entries ?? []).find((entry) => entry.family === 'IPv4' && !entry.internal)
    if (ipv4) return ipv4.address
  }
  return null
}

/** Where the host is, from the mode and the address of the virtual switch. */
export function wslHost(mode: WslNetworkingMode, address: string | null): WslHost {
  return mode === 'mirrored' ? MIRRORED : { mode: 'nat', address }
}

/** `default via 172.29.16.1 dev eth0 proto kernel` — the address the distro sends everything to. */
const VIA = /\bdefault\b[^\n]*?\bvia\s+(\d+\.\d+\.\d+\.\d+)/

/**
 * The host's address as the distro itself routes to it, checked against this machine's interfaces.
 *
 * The check is the point. The answer is about to be handed to `server.listen()`, and an address
 * this process does not hold either fails to bind or binds something that is not the WSL adapter.
 * An address that is not one of ours is refused, and the caller keeps whatever
 * {@link wslAdapterAddress} found.
 */
export function defaultGateway(run: WslRunner, distro: string, own = localAddresses): string | null {
  const route = run(['-d', distro, '-e', 'sh', '-lc', 'ip route show default'])
  if (route.kind !== 'output' && route.kind !== 'failed') return null
  const address = VIA.exec(route.output)?.[1] ?? null
  if (!address) return null
  return own().includes(address) ? address : null
}

/** Every IPv4 address this machine holds, loopback included. */
export function localAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4')
    .map((entry) => entry.address)
}

/**
 * One of the app's own URLs, as a Session inside the distro has to dial it: the same URL with the
 * host swapped for {@link WslHost.address}. A URL that is not on loopback is left alone — it is
 * not one of ours — and so is one with no address to swap in.
 */
export function hostUrlFor(url: string, host: WslHost | null): string {
  if (!host?.address || host.address === LOOPBACK) return url
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== LOOPBACK && parsed.hostname !== 'localhost') return url
    parsed.hostname = host.address
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Every address the receivers must listen on for this set of runtimes: loopback always, and the
 * host address of each distro a Provider actually runs in. Never `0.0.0.0`, and never an address
 * that is not this machine's own.
 */
export function bindAddresses(hosts: readonly (WslHost | null)[]): string[] {
  const addresses = new Set<string>([LOOPBACK])
  for (const host of hosts) {
    if (host?.address && host.address !== LOOPBACK) addresses.add(host.address)
  }
  return [...addresses]
}

/** The path the receiver answers a self-test on, so a probe never has to POST a fake hook. */
export const HOOK_HEALTH_PATH = '/health'

/**
 * The self-test: from inside the distro, `curl` the hook receiver's health path with a token, and
 * see whether anything answers.
 *
 * It is the only thing that tells the two failures apart. A Session that goes quiet because the
 * firewall ate its hooks looks exactly like a Session that is thinking, and the boss has no way to
 * find out which. So the app asks before the first Session does, and the row says what it found —
 * `ok`, or the firewall sentence.
 *
 * `--max-time` because a blocked port does not refuse, it hangs; `-f` so an HTTP error is a
 * failure and not a body; `-s -o /dev/null` because nothing is read back but the exit code.
 */
export function wslReachesHook(
  run: WslRunner,
  distro: string,
  healthUrl: string,
  token: string,
  header: string,
): boolean {
  const command = `curl -sf -o /dev/null --max-time 4 -H ${shellQuote(`${header}: ${token}`)} ${shellQuote(healthUrl)}`
  const outcome = run(['-d', distro, '-e', 'sh', '-lc', command])
  return outcome.kind === 'output'
}

/** The health URL of a hook receiver, from the URL its hooks POST to. */
export function healthUrlOf(hookUrl: string): string {
  try {
    const parsed = new URL(hookUrl)
    parsed.pathname = HOOK_HEALTH_PATH
    return parsed.toString()
  } catch {
    return hookUrl
  }
}
