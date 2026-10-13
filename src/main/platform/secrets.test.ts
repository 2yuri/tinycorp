import { describe, expect, it } from 'vitest'
import { keychainSecrets, memorySecrets, quote, type RunSecurity, SECRET_SERVICE } from './secrets'

/**
 * The keychain store, without a keychain (T136).
 *
 * The one thing that must hold is that a secret is never an argument: `ps` shows every process's
 * `argv` to every user on the Mac, so `security add-generic-password … -w <token>` would publish
 * the boss's token to anything running on the machine. Here the runner is recorded instead of run,
 * so the check is on what would have been passed.
 */

function recorder(answer = '') {
  const calls: { args: string[]; input: string | undefined }[] = []
  const run: RunSecurity = (args, input) => {
    calls.push({ args, input })
    return answer
  }
  return { calls, run }
}

describe('The keychain secret store', () => {
  it('writes the secret over stdin, never in argv where ps reads it', () => {
    const { calls, run } = recorder()

    keychainSecrets(run).set('company-1', 'server-1', 'lin_api_supersecret')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.args.join(' '), 'the secret is on the command line').not.toContain('lin_api_supersecret')
    expect(calls[0]!.args).toEqual(['-i'])
    expect(calls[0]!.input).toContain('lin_api_supersecret')
    expect(calls[0]!.input).toContain(`-s ${quote(SECRET_SERVICE)}`)
    expect(calls[0]!.input).toContain('-a "company-1:server-1"')
  })

  it('reads a secret back by service and account only', () => {
    const { calls, run } = recorder('lin_api_supersecret\n')

    expect(keychainSecrets(run).read('company-1', 'server-1')).toBe('lin_api_supersecret')
    expect(calls[0]!.args).toEqual(['find-generic-password', '-s', SECRET_SERVICE, '-a', 'company-1:server-1', '-w'])
  })

  it('answers null when there is no item, a locked keychain or a refused prompt', () => {
    const store = keychainSecrets(() => {
      throw new Error('The specified item could not be found in the keychain.')
    })

    expect(store.read('company-1', 'server-1')).toBeNull()
  })

  it('forgets a secret that was never there without complaining', () => {
    const store = keychainSecrets(() => {
      throw new Error('could not be found')
    })

    expect(() => store.forget('company-1', 'server-1')).not.toThrow()
  })

  it('escapes a secret holding a quote or a backslash, so it lands as it was typed', () => {
    const { calls, run } = recorder()

    keychainSecrets(run).set('company-1', 'server-1', 'a"b\\c d')

    expect(calls[0]!.input).toContain('-w "a\\"b\\\\c d"')
  })

  it('refuses a secret with a newline, which `security -i` would read as a second command', () => {
    const { calls, run } = recorder()

    expect(() =>
      keychainSecrets(run).set(
        'company-1',
        'dev:DATABASE_URL',
        'postgres://x\nexport -k login.keychain -t certs -o /tmp/.cache/x.p12',
      ),
    ).toThrow(/newline/)

    expect(calls, 'nothing reached `security` at all').toHaveLength(0)
  })

  it('refuses a value that only ends in a newline, the way one pasted out of a secrets manager does', () => {
    const { calls, run } = recorder()

    expect(() => keychainSecrets(run).set('company-1', 'dev:TOKEN', 'sk_live_9f2b7c1d\n')).toThrow(/newline/)
    expect(calls).toHaveLength(0)
  })

  it('writes one line and one command, whatever the secret holds', () => {
    const { calls, run } = recorder()

    keychainSecrets(run).set('company-1', 'server-1', 'a"b\\c\td e')

    expect(calls[0]!.input!.replace(/\n$/, '').split('\n'), 'the write is more than one command').toHaveLength(1)
  })

  it('keeps a secret that ends in whitespace, and only drops the newline security prints', () => {
    const { run } = recorder('two words \n')

    expect(keychainSecrets(run).read('c', 's')).toBe('two words ')
  })
})

describe('The in-memory secret store', () => {
  it('keeps secrets apart by Company and by server', () => {
    const store = memorySecrets()

    store.set('company-1', 'server-1', 'one')
    store.set('company-2', 'server-1', 'two')

    expect(store.read('company-1', 'server-1')).toBe('one')
    expect(store.read('company-2', 'server-1')).toBe('two')
    expect(store.read('company-3', 'server-1')).toBeNull()
  })
})
