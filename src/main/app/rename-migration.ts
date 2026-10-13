import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** What the app was called before it became TinyCorp; its userData folder is still on disk. */
export const FORMER_USER_DATA_DIR = 'better-office'

/**
 * Carries a boss's Companies and Sessions over from the old `better-office` userData folder the
 * first time TinyCorp runs. Electron derives userData from the package name, so the rename would
 * otherwise show an empty Launcher. Copies, never moves: the old folder stays as a fallback.
 */
export function adoptFormerUserData(userData: string, formerDir = FORMER_USER_DATA_DIR): boolean {
  const former = join(dirname(userData), formerDir)
  if (userData === former || !existsSync(former)) return false
  const fresh = !existsSync(join(userData, 'recent-companies.json'))
  if (!fresh) return false
  mkdirSync(userData, { recursive: true })
  let adopted = false
  for (const entry of ['recent-companies.json', 'sessions']) {
    const from = join(former, entry)
    if (!existsSync(from) || existsSync(join(userData, entry))) continue
    cpSync(from, join(userData, entry), { recursive: true })
    adopted = true
  }
  return adopted && readdirSync(userData).length > 0
}
