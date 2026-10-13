import { describe, expect, it } from 'vitest'
import { createRedactor, REDACTION_MIN_LENGTH, redactedAs, valueForms } from './redaction'

/**
 * What stops a secret leaving through `env_run`'s output (T176).
 *
 * These are the shapes a value really comes back in: printed as it is, base64 in a header,
 * percent encoded in a URL, and cut in half by a pipe. Each one of them is a way a value reaches a
 * transcript, so each one has a test.
 */

const DATABASE_URL = 'postgres://app:h7fs8@db.internal:5432/billing'

describe('The redactor', () => {
  it('swaps a value for its name, wherever it is in the line', () => {
    const redactor = createRedactor([{ name: 'DATABASE_URL', value: DATABASE_URL }])

    expect(redactor.redact(`connecting with DATABASE_URL=${DATABASE_URL} …`)).toBe(
      'connecting with DATABASE_URL=‹DATABASE_URL› …',
    )
    expect(redactor.count).toBe(1)
  })

  it('catches the base64 of a value, which is how a header prints it', () => {
    const redactor = createRedactor([{ name: 'API_KEY', value: 'sk_live_9f2b7c1d' }])
    const base64 = Buffer.from('sk_live_9f2b7c1d').toString('base64')

    expect(redactor.redact(`authorization: Basic ${base64}`)).toBe('authorization: Basic ‹API_KEY›')
  })

  it('catches base64 without its padding, and the URL-safe alphabet', () => {
    const value = 'abcdefgh?/+'
    const redactor = createRedactor([{ name: 'TOKEN', value }])
    const padded = Buffer.from(value).toString('base64')

    expect(padded.endsWith('=')).toBe(true)
    expect(redactor.redact(padded.replace(/=+$/, ''))).toBe(redactedAs('TOKEN'))
    expect(redactor.redact(Buffer.from(value).toString('base64url'))).toBe(redactedAs('TOKEN'))
  })

  it('catches a value percent-encoded into a URL', () => {
    const redactor = createRedactor([{ name: 'DATABASE_URL', value: DATABASE_URL }])

    expect(redactor.redact(`GET /probe?dsn=${encodeURIComponent(DATABASE_URL)}`)).toBe('GET /probe?dsn=‹DATABASE_URL›')
  })

  it('catches a value split across two chunks, which a naive filter lets through', () => {
    const redactor = createRedactor([{ name: 'DATABASE_URL', value: DATABASE_URL }])
    const line = `connecting with ${DATABASE_URL}\n`
    const split = line.indexOf(DATABASE_URL) + 10

    const first = redactor.push(line.slice(0, split))
    const rest = redactor.push(line.slice(split)) + redactor.end()

    expect(first + rest).toBe('connecting with ‹DATABASE_URL›\n')
    expect(first).not.toContain('postgres')
    expect(redactor.count).toBe(1)
  })

  it('holds back only the tail that could still be a value, so a stream is not a buffer', () => {
    const redactor = createRedactor([{ name: 'TOKEN', value: 'sk_live_9f2b7c1d' }])

    const out = redactor.push('a'.repeat(1000))

    expect(out.length).toBeGreaterThan(900)
  })

  it('redacts one value split across many chunks, a character at a time', () => {
    const redactor = createRedactor([{ name: 'TOKEN', value: 'sk_live_9f2b7c1d' }])
    const line = `token is sk_live_9f2b7c1d, keep it\n`

    let out = ''
    for (const character of line) out += redactor.push(character)
    out += redactor.end()

    expect(out).toBe('token is ‹TOKEN›, keep it\n')
  })

  it('redacts every value when there are many, and names each one right', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `SECRET_${i}`,
      value: `value-number-${i}-${'x'.repeat(i)}`,
    }))
    const redactor = createRedactor(many)

    const out = redactor.redact(many.map(({ value }) => `one=${value}`).join('\n'))

    expect(out).toBe(many.map(({ name }) => `one=${redactedAs(name)}`).join('\n'))
    expect(redactor.count).toBe(40)
  })

  it('replaces the longest value first, so one inside another is not half redacted', () => {
    const redactor = createRedactor([
      { name: 'SHORT', value: 'abc123xyz' },
      { name: 'LONG', value: 'abc123xyz-and-more' },
    ])

    expect(redactor.redact('key=abc123xyz-and-more')).toBe(`key=${redactedAs('LONG')}`)
  })

  it('leaves ordinary words alone, and never matches a value too short to tell apart', () => {
    const redactor = createRedactor([{ name: 'NODE_ENV', value: 'dev' }])

    expect(redactor.redact('dev server ready in 1.8s')).toBe('dev server ready in 1.8s')
    expect(redactor.count).toBe(0)
    expect('dev'.length).toBeLessThan(REDACTION_MIN_LENGTH)
  })

  it('passes everything through when it holds no values at all', () => {
    const redactor = createRedactor([])

    expect(redactor.push('anything at all') + redactor.end()).toBe('anything at all')
  })
})

describe('The forms of a value', () => {
  it('are the raw one, base64 with and without padding, URL-safe base64 and percent encoding', () => {
    const forms = valueForms('a b/c+d')

    expect(forms).toContain('a b/c+d')
    expect(forms).toContain(Buffer.from('a b/c+d').toString('base64'))
    expect(forms).toContain(Buffer.from('a b/c+d').toString('base64url'))
    expect(forms).toContain(encodeURIComponent('a b/c+d'))
  })

  it('are sorted longest first and never repeat a shape', () => {
    const forms = valueForms('abcdefghij')

    expect(forms).toEqual([...forms].sort((a, b) => b.length - a.length))
    expect(new Set(forms).size).toBe(forms.length)
  })

  it('drops a form shorter than the minimum, so a scan never looks for a word', () => {
    expect(valueForms('ab').every((form) => form.length >= REDACTION_MIN_LENGTH)).toBe(true)
  })
})
