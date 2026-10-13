import { describe, expect, it } from 'vitest'
import {
  completeSlash,
  invokesSkill,
  parseSlash,
  SLASH_COMMANDS,
  type SlashOptions,
  skillHolder,
  skillSuggestions,
  slashArguments,
  slashAt,
  slashAttempt,
  slashSuggestions,
} from './slash-commands'

const options: SlashOptions = {
  people: [
    { id: 'e-hera', name: 'Hera' },
    { id: 'e-hermes', name: 'Hermes Vale' },
    { id: 'e-orion', name: 'Orion' },
  ],
  roles: [
    { id: 'r-fe', name: 'Frontend engineer' },
    { id: 'r-fs', name: 'Full-stack engineer' },
    { id: 'r-pm', name: 'Product manager' },
  ],
}

describe('what counts as a command', () => {
  it('reads the name of the first token', () => {
    expect(slashAttempt('/pause')).toBe('pause')
    expect(slashAttempt('/Ticket Login page')).toBe('ticket')
  })

  it('leaves a path alone, so a message that starts with one posts as written', () => {
    expect(slashAttempt('/Users/yuri/notes.md is where I put it')).toBeNull()
    expect(slashAttempt('/usr/local/bin')).toBeNull()
  })

  it('is not a command in the middle of a sentence', () => {
    expect(slashAttempt('and then /pause')).toBeNull()
  })

  it('is an attempt even when nothing answers to the name, so it shows a hint', () => {
    expect(slashAttempt('/deploy now')).toBe('deploy')
    expect(parseSlash('/deploy now', options)).toEqual({
      ok: false,
      hint: '/deploy is not a command. Type / to see them all.',
    })
  })
})

describe('the palette as it is typed', () => {
  it('opens on the bare slash with every command', () => {
    const hit = slashAt('/', 1)

    expect(hit).toEqual({ start: 0, query: '', command: null })
    expect(slashSuggestions(hit!.query)).toHaveLength(SLASH_COMMANDS.length)
  })

  it('narrows as the name is typed, names that start with it first', () => {
    // Then a name that holds it, or a line with a word that starts with it (T264).
    expect(slashSuggestions('re').map((c) => c.name)).toEqual(['reject', 'resume', 'approve', 'hire', 'pause'])
    expect(slashSuggestions('rej').map((c) => c.name)).toEqual(['reject'])
  })

  it('stays shut before the slash and where no command begins the text', () => {
    expect(slashAt('/pause', 0)).toBeNull()
    expect(slashAt('talk /pause', 11)).toBeNull()
  })

  it('completes a name over what was typed, leaving the rest of the line', () => {
    const hit = slashAt('/tic page', 4)!

    expect(completeSlash('/tic page', hit.start, 4, '/ticket ')).toEqual({ text: '/ticket page', caret: 8 })
  })

  it('moves on to the argument once the name is whole', () => {
    const hit = slashAt('/dm He', 6)!

    expect(hit).toEqual({ start: 4, query: 'He', command: expect.objectContaining({ name: 'dm' }) })
    expect(slashArguments(hit.command!, hit.query, options)).toEqual([
      { value: 'Hera', label: 'Hera' },
      { value: 'Hermes Vale', label: 'Hermes Vale' },
    ])
    expect(completeSlash('/dm He', hit.start, 6, 'Hermes Vale ')).toEqual({ text: '/dm Hermes Vale ', caret: 16 })
  })

  it('completes a role for /hire and nothing for a command that takes free text', () => {
    expect(slashArguments(slashAt('/hire F', 7)!.command!, 'F', options).map((a) => a.value)).toEqual([
      'Frontend engineer',
      'Full-stack engineer',
    ])
    expect(slashAt('/ticket Log', 11)).toBeNull()
  })
})

describe('parsing each command', () => {
  const parse = (text: string) => parseSlash(text, options)

  it('takes the commands that need nothing', () => {
    expect(parse('/pause')).toEqual({ ok: true, command: { kind: 'pause' } })
    expect(parse('/resume')).toEqual({ ok: true, command: { kind: 'resume' } })
    expect(parse('/approve')).toEqual({ ok: true, command: { kind: 'approve' } })
  })

  it('reads the longest name a DM begins with, and the rest is the message', () => {
    expect(parse('/dm Hermes Vale can you take #12?')).toEqual({
      ok: true,
      command: { kind: 'dm', employeeId: 'e-hermes', text: 'can you take #12?' },
    })
  })

  it('opens a DM with nothing in it when only the name is given', () => {
    expect(parse('/dm hera')).toEqual({ ok: true, command: { kind: 'dm', employeeId: 'e-hera', text: '' } })
  })

  it('says so when nobody answers to the name', () => {
    expect(parse('/dm Zed hello')).toEqual({ ok: false, hint: 'Nobody here is called “Zed”.' })
  })

  it('keeps the whole line as a ticket title and as a goal', () => {
    expect(parse('/ticket Login page keeps the boss out')).toEqual({
      ok: true,
      command: { kind: 'ticket', title: 'Login page keeps the boss out' },
    })
    expect(parse('/goal ship the billing rewrite')).toEqual({
      ok: true,
      command: { kind: 'goal', text: 'ship the billing rewrite' },
    })
  })

  it('needs a reason to reject, and keeps it whole', () => {
    expect(parse('/reject the tests are red')).toEqual({
      ok: true,
      command: { kind: 'reject', reason: 'the tests are red' },
    })
    expect(parse('/reject')).toEqual({ ok: false, hint: '/reject needs one more word: /reject <why>' })
  })

  it('asks for the word each command is missing', () => {
    expect(parse('/ticket')).toEqual({ ok: false, hint: '/ticket needs one more word: /ticket <title>' })
    expect(parse('/dm')).toEqual({ ok: false, hint: '/dm needs one more word: /dm <employee>' })
    expect(parse('/goal  ')).toEqual({ ok: false, hint: '/goal needs one more word: /goal <text>' })
  })

  it('hires on a role named in full, or on the only one the words begin', () => {
    expect(parse('/hire product manager')).toEqual({ ok: true, command: { kind: 'hire', roleId: 'r-pm' } })
    expect(parse('/hire Front')).toEqual({ ok: true, command: { kind: 'hire', roleId: 'r-fe' } })
  })

  it('asks which role when the words could be two of them', () => {
    expect(parse('/hire F')).toEqual({
      ok: false,
      hint: '“F” could be Frontend engineer, Full-stack engineer. Name one.',
    })
    expect(parse('/hire designer')).toEqual({ ok: false, hint: 'No role is called “designer”.' })
  })
})

describe('whose skills a draft can invoke (T264)', () => {
  const people = [
    { id: 'e-hera', name: 'Hera' },
    { id: 'e-orion', name: 'Orion' },
  ]

  it('is the Employee a DM is with', () => {
    expect(skillHolder('dm:boss:e-orion', '/', people)).toBe('e-orion')
  })

  it('is the one Employee a channel draft mentions, and nobody otherwise', () => {
    expect(skillHolder('tech', '/review @Orion please', people)).toBe('e-orion')
    expect(skillHolder('tech', '/', people)).toBeNull()
    expect(skillHolder('tech', '/review @Orion and @Hera', people)).toBeNull()
    expect(skillHolder('tech', '/review @channel @Orion', people)).toBeNull()
  })

  it('matches a skill by its name first, then by a word of what it does', () => {
    const skills = [
      { name: 'deploy-runbook', description: 'How a release goes out', missing: false },
      { name: 'review-checklist', description: 'The checks before a pull request', missing: false },
    ]

    expect(skillSuggestions('re', skills).map((s) => s.name)).toEqual(['review-checklist', 'deploy-runbook'])
    expect(skillSuggestions('pull', skills).map((s) => s.name)).toEqual(['review-checklist'])
  })

  it('reads a message that opens with a held skill as one, and a command as a command', () => {
    const group = { owner: 'Orion', skills: [{ name: 'pause', description: '', missing: false }] }

    expect(invokesSkill('/pause now', group)).toBe(true)
    expect(invokesSkill('/ticket Login', group)).toBe(false)
    expect(invokesSkill('/pause', null)).toBe(false)
  })
})
