import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFolder } from '../../core/testing'
import { CLAUDE_CONFIG_FILE, claudeEmailIn, trustClaudeFolder } from './account-config'

/**
 * `.claude.json` in an account folder TinyCorp made (T263): trusted for the empty folder sign-ins
 * run in, so the question never stops one, and read for the address the CLI signed in as.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) removeFolder(folder)
})

function accountFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'claude-account-'))
  folders.push(folder)
  return folder
}

describe('the trust entry', () => {
  it('marks the sign-in folder trusted and keeps everything else the CLI wrote', () => {
    const dir = accountFolder()
    writeFileSync(
      join(dir, CLAUDE_CONFIG_FILE),
      JSON.stringify({ theme: 'dark', projects: { '/work/acme': { allowedTools: ['Bash'] } } }),
    )

    trustClaudeFolder(dir, '/mnt/c/Users/b/AppData/Roaming/TinyCorp/sign-in/claude')

    expect(JSON.parse(readFileSync(join(dir, CLAUDE_CONFIG_FILE), 'utf8'))).toEqual({
      theme: 'dark',
      projects: {
        '/work/acme': { allowedTools: ['Bash'] },
        '/mnt/c/Users/b/AppData/Roaming/TinyCorp/sign-in/claude': { hasTrustDialogAccepted: true },
      },
    })
  })

  it('writes a Windows folder under both of the separators the CLI has used', () => {
    const dir = accountFolder()
    trustClaudeFolder(dir, 'C:\\Users\\b\\sign-in\\claude')

    const projects = JSON.parse(readFileSync(join(dir, CLAUDE_CONFIG_FILE), 'utf8')).projects
    expect(Object.keys(projects)).toEqual(['C:\\Users\\b\\sign-in\\claude', 'C:/Users/b/sign-in/claude'])
  })
})

describe('the address', () => {
  it('is the one the CLI wrote beside its login, and nothing where it wrote none', () => {
    const dir = accountFolder()
    const file = join(dir, CLAUDE_CONFIG_FILE)
    expect(claudeEmailIn(file)).toBeNull()

    writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: 'boss@example.com' } }))
    expect(claudeEmailIn(file)).toBe('boss@example.com')
  })
})
