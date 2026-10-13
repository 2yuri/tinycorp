import { describe, expect, it } from 'vitest'
import type { WslOutcome, WslRunner } from './wsl'
import {
  bindAddresses,
  confirmMirrored,
  defaultGateway,
  HOOK_HEALTH_PATH,
  healthUrlOf,
  hostUrlFor,
  LOOPBACK,
  wslAdapterAddress,
  wslConfigPath,
  wslHost,
  wslNetworkingMode,
  wslReachesHook,
} from './wsl-network'

/**
 * Where a Session inside WSL dials, and where the receivers answer (T167).
 *
 * The two failures this guards against are opposite and both bad: a Session that cannot reach
 * TinyCorp at all, and a receiver that ends up on the office wifi.
 */

const GATEWAY = '172.29.16.1'
const HOOK = `http://${LOOPBACK}:4555/hook`

function answering(output: string): WslRunner {
  return () => ({ kind: 'output', code: 0, output }) as WslOutcome
}

describe('how this WSL is wired', () => {
  it('is NAT on a machine with no .wslconfig, which is most of them', () => {
    expect(wslNetworkingMode(null)).toBe('nat')
  })

  it('is mirrored when the file says so', () => {
    expect(wslNetworkingMode('[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\n')).toBe('mirrored')
    expect(wslNetworkingMode('[wsl2]\n  networkingMode = Mirrored\n')).toBe('mirrored')
  })

  it('is NAT for anything else the file says', () => {
    expect(wslNetworkingMode('[wsl2]\nnetworkingMode=nat\n')).toBe('nat')
    expect(wslNetworkingMode('[wsl2]\nmemory=8GB\n')).toBe('nat')
  })

  it('is in the boss’s profile folder', () => {
    // The separator is the platform's, so the assertion is too: this suite also runs on a Mac.
    expect(wslConfigPath({ USERPROFILE: 'C:\\Users\\b' })).toMatch(/^C:\\Users\\b[\\/]\.wslconfig$/)
    expect(wslConfigPath({})).toBeNull()
  })

  it('is confirmed by the distro when there is one awake to ask', () => {
    expect(confirmMirrored(answering('mirrored\n'), 'Ubuntu')).toBe(true)
    expect(confirmMirrored(answering('nat\n'), 'Ubuntu')).toBe(false)
    // An older WSL has no `wslinfo`: it says nothing, and the file's answer stands.
    expect(confirmMirrored(answering(''), 'Ubuntu')).toBeNull()
  })
})

describe('where the host is, from inside a distro', () => {
  it('is loopback in mirrored mode, where there is nothing to do', () => {
    expect(wslHost('mirrored', GATEWAY)).toEqual({ mode: 'mirrored', address: LOOPBACK })
  })

  it('is the WSL switch in NAT mode', () => {
    expect(wslHost('nat', GATEWAY)).toEqual({ mode: 'nat', address: GATEWAY })
  })

  it('is the vEthernet (WSL) adapter’s own address, read off this machine', () => {
    expect(
      wslAdapterAddress({
        'Wi-Fi': [{ address: '192.168.1.20', family: 'IPv4', internal: false } as never],
        'vEthernet (WSL (Hyper-V firewall))': [{ address: GATEWAY, family: 'IPv4', internal: false } as never],
      }),
    ).toBe(GATEWAY)
  })

  it('is nothing on a machine with no WSL switch', () => {
    expect(
      wslAdapterAddress({ 'Wi-Fi': [{ address: '192.168.1.20', family: 'IPv4', internal: false } as never] }),
    ).toBeNull()
  })

  it('reads the distro’s own default route, and only believes an address we hold', () => {
    const route = answering(`default via ${GATEWAY} dev eth0 proto kernel onlink\n`)
    expect(defaultGateway(route, 'Ubuntu', () => [LOOPBACK, GATEWAY])).toBe(GATEWAY)
    // An address this process does not hold cannot be bound, and would not be the WSL switch.
    expect(defaultGateway(route, 'Ubuntu', () => [LOOPBACK])).toBeNull()
  })
})

describe('the URLs a Session inside a distro is given', () => {
  it('stay on loopback in mirrored mode, where loopback is the host’s', () => {
    expect(hostUrlFor(HOOK, wslHost('mirrored', GATEWAY))).toBe(HOOK)
  })

  it('point at the host in NAT mode, where loopback is the distro itself', () => {
    expect(hostUrlFor(HOOK, wslHost('nat', GATEWAY))).toBe(`http://${GATEWAY}:4555/hook`)
  })

  it('keep the path and the port, which is how the MCP endpoint survives the swap', () => {
    const mcp = `http://${LOOPBACK}:7377/companies/c-acme/mcp`
    expect(hostUrlFor(mcp, wslHost('nat', GATEWAY))).toBe(`http://${GATEWAY}:7377/companies/c-acme/mcp`)
  })

  it('stay as they are for a Provider on Windows, and when nothing could be read', () => {
    expect(hostUrlFor(HOOK, null)).toBe(HOOK)
    expect(hostUrlFor(HOOK, wslHost('nat', null))).toBe(HOOK)
  })

  it('leave a URL that is not ours alone', () => {
    expect(hostUrlFor('https://api.example.com/x', wslHost('nat', GATEWAY))).toBe('https://api.example.com/x')
  })
})

describe('what the receivers bind', () => {
  it('is loopback, always', () => {
    expect(bindAddresses([])).toEqual([LOOPBACK])
  })

  it('adds the WSL switch, and nothing else', () => {
    expect(bindAddresses([wslHost('nat', GATEWAY)])).toEqual([LOOPBACK, GATEWAY])
  })

  it('adds nothing in mirrored mode, where loopback already reaches the distro', () => {
    expect(bindAddresses([wslHost('mirrored', GATEWAY)])).toEqual([LOOPBACK])
  })

  it('never says 0.0.0.0, whatever it is handed', () => {
    for (const host of [null, wslHost('nat', null), wslHost('nat', GATEWAY), wslHost('mirrored', LOOPBACK)]) {
      expect(bindAddresses([host])).not.toContain('0.0.0.0')
    }
  })
})

describe('the self-test', () => {
  it('curls the health path from inside the distro, with the app’s own token', () => {
    const asked: string[][] = []
    const run: WslRunner = (args) => {
      asked.push([...args])
      return { kind: 'output', code: 0, output: '' }
    }
    expect(wslReachesHook(run, 'Ubuntu', healthUrlOf(HOOK), 'probe-token', 'x-tinycorp-token')).toBe(true)
    const command = asked[0]!.at(-1)!
    expect(command).toContain(HOOK_HEALTH_PATH)
    expect(command).toContain('probe-token')
    expect(command).toContain('--max-time')
  })

  it('is blocked when nothing answers — which is the firewall, nine times out of ten', () => {
    expect(wslReachesHook(() => ({ kind: 'failed', output: '' }), 'Ubuntu', HOOK, 'tok', 'h')).toBe(false)
    expect(wslReachesHook(() => ({ kind: 'timeout' }), 'Ubuntu', HOOK, 'tok', 'h')).toBe(false)
  })

  it('asks the health path, never a fake hook', () => {
    expect(healthUrlOf(HOOK)).toBe(`http://${LOOPBACK}:4555${HOOK_HEALTH_PATH}`)
  })
})
