import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The one file of Claude Code's own that TinyCorp reads and, for a folder it made, writes (T263):
 * `.claude.json` inside a config folder, where the CLI keeps its onboarding, its trusted folders
 * and the account it signed in as. The login itself is never in it — that is `.credentials.json`
 * or the keychain — and nothing here touches either.
 */
export const CLAUDE_CONFIG_FILE = '.claude.json'

/**
 * Marks `folder` trusted in the `.claude.json` inside `configDir`, so a sign-in run there is never
 * stopped by *Do you trust the files in this folder?*.
 *
 * Only ever called for a config folder TinyCorp made under its own data folder, about the empty
 * folder TinyCorp runs its sign-ins in. The key is the folder as the CLI spells it; on Windows the
 * CLI has written both separators over its versions, so both are written.
 */
export function trustClaudeFolder(configDir: string, folder: string): void {
  const file = join(configDir, CLAUDE_CONFIG_FILE)
  const config = readConfig(file) ?? {}
  const projects = isRecord(config['projects']) ? { ...config['projects'] } : {}
  for (const key of new Set([folder, folder.replace(/\\/g, '/')])) {
    const existing = isRecord(projects[key]) ? projects[key] : {}
    projects[key] = { ...existing, hasTrustDialogAccepted: true }
  }
  writeFileSync(file, `${JSON.stringify({ ...config, projects }, null, 2)}\n`)
}

/**
 * The address Claude Code wrote for the account it signed in as, or null. `configFile` is the
 * `.claude.json` to read: inside an account's own folder, or `~/.claude.json` for the default one.
 */
export function claudeEmailIn(configFile: string): string | null {
  const account = readConfig(configFile)?.['oauthAccount']
  const email = isRecord(account) ? account['emailAddress'] : null
  return typeof email === 'string' && email.trim() !== '' ? email.trim() : null
}

function readConfig(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
