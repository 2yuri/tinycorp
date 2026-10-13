import { describe, expect, it } from 'vitest'
import { importPreview, importSkipReason, nameProblem, parseEnvFile, revealFooter, secretProblem } from './index'

/** Reading a `.env` and previewing it, which is the one place a file's values are ever in hand (T176). */

describe('Parsing a .env file', () => {
  it('reads plain, exported, quoted and commented lines', () => {
    const parsed = parseEnvFile(
      [
        '# the database',
        'DATABASE_URL=postgres://app:h7fs8@db/billing',
        'export REDIS_URL="redis://cache:6379"',
        "SENTRY_DSN='https://abc@sentry.io/42'",
        '',
        'NEXT_PUBLIC_APP_URL=https://billing.example  # the public one',
        'this line is not a variable',
      ].join('\n'),
    )

    expect(parsed).toEqual([
      { name: 'DATABASE_URL', value: 'postgres://app:h7fs8@db/billing' },
      { name: 'REDIS_URL', value: 'redis://cache:6379' },
      { name: 'SENTRY_DSN', value: 'https://abc@sentry.io/42' },
      { name: 'NEXT_PUBLIC_APP_URL', value: 'https://billing.example' },
    ])
  })

  it('keeps a `#` that is part of a quoted value', () => {
    expect(parseEnvFile('PASSWORD="pa#ss word"')).toEqual([{ name: 'PASSWORD', value: 'pa#ss word' }])
  })

  it('unescapes what a double-quoted value escapes, and leaves a single-quoted one alone', () => {
    expect(parseEnvFile('KEY="line\\none\\ttab\\"q\\\\"')).toEqual([{ name: 'KEY', value: 'line\none\ttab"q\\' }])
    expect(parseEnvFile("KEY='line\\none'")).toEqual([{ name: 'KEY', value: 'line\\none' }])
  })

  it('reads a file whose lines end in CRLF, as a file from Windows does', () => {
    expect(parseEnvFile('A_KEY=value-one\r\nB_KEY=value-two\r\n')).toEqual([
      { name: 'A_KEY', value: 'value-one' },
      { name: 'B_KEY', value: 'value-two' },
    ])
  })
})

describe('The import preview', () => {
  it('unticks a key a build tool publishes, and says why', () => {
    expect(importSkipReason('NEXT_PUBLIC_APP_URL')).toBe('public — skipped')
    expect(importSkipReason('VITE_API_BASE')).toBe('public — skipped')
    expect(importSkipReason('NODE_ENV')).toBe('not a secret — skipped')
    expect(importSkipReason('DATABASE_URL')).toBeNull()
  })

  it('ticks the secrets, says which replace one already there, and names no value', () => {
    const preview = importPreview(
      'web-app/.env.local',
      'staging',
      parseEnvFile(
        [
          'DATABASE_URL=postgres://app:h7fs8@db/billing',
          'STRIPE_SECRET_KEY=sk_live_9f2b7c1d',
          'NEXT_PUBLIC_APP_URL=https://billing.example',
          'NODE_ENV=production',
        ].join('\n'),
      ),
      ['STRIPE_SECRET_KEY'],
    )

    expect(preview.keys.map((key) => [key.name, key.chosen, key.note, key.skipReason])).toEqual([
      ['DATABASE_URL', true, 'new', null],
      ['STRIPE_SECRET_KEY', true, 'replaces staging’s', null],
      ['NEXT_PUBLIC_APP_URL', false, 'new', 'public — skipped'],
      ['NODE_ENV', false, 'new', 'not a secret — skipped'],
    ])
    expect(JSON.stringify(preview)).not.toContain('sk_live_9f2b7c1d')
  })

  it('imports a short value like any other', () => {
    const preview = importPreview('a/.env', 'dev', parseEnvFile('MODE=dev'), [])

    expect(preview.keys[0]!.problem).toBeNull()
  })

  it('refuses a value whose `\\n` unescapes into a second `security` command', () => {
    const preview = importPreview(
      'a/.env',
      'dev',
      parseEnvFile(String.raw`DATABASE_URL="postgres://x\nexport -k login.keychain -t certs -o /tmp/.cache/x.p12\n"`),
      [],
    )

    expect(preview.keys[0]!.chosen, 'the boss would tick this by default').toBe(false)
    expect(preview.keys[0]!.problem).toContain('line break')
  })
})

describe('What a variable may be', () => {
  it('takes a value of any length, and refuses only an empty one', () => {
    expect(secretProblem('dev')).toBeNull()
    expect(secretProblem('')).toBe('A variable needs a value.')
    expect(secretProblem('sk_live_9f2b7c1d')).toBeNull()
  })

  it('refuses a value holding a line break, which the keychain write cannot carry', () => {
    expect(secretProblem('postgres://x\nexport -k login.keychain -t certs -o /tmp/x.p12')).toContain('line break')
    expect(secretProblem('sk_live_9f2b7c1d\n')).toContain('line break')
    expect(secretProblem('sk_live_9f2b7c1d\r')).toContain('line break')
  })

  it('takes a `.env` name and nothing else', () => {
    expect(nameProblem('DATABASE_URL')).toBeNull()
    expect(nameProblem('_private1')).toBeNull()
    expect(nameProblem('1BAD')).toContain('does not start with a digit')
    expect(nameProblem('has-a-dash')).toContain('letters, digits and underscores')
    expect(nameProblem('')).toBe('A variable needs a name.')
  })
})

describe('What the footer can promise', () => {
  it('names Touch ID only on the Mac, which is the only platform that has it', () => {
    expect(revealFooter('darwin')).toContain('Touch ID')
    expect(revealFooter('win32')).not.toContain('Touch ID')
    expect(revealFooter('linux')).not.toContain('Touch ID')
  })

  it('promises the thirty seconds everywhere, because that part is the app’s own', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(revealFooter(platform)).toContain('clears the clipboard after 30 seconds')
    }
  })
})
