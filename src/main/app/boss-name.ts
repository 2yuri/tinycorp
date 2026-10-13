import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'

/** The account's full name where the OS keeps one (macOS `id -F`), else the login name. */
export function bossName(): string {
  if (process.platform === 'darwin') {
    try {
      const full = execFileSync('id', ['-F'], { encoding: 'utf8', timeout: 2000 }).trim()
      if (full) return full
    } catch {
      // Fall back to the login name.
    }
  }
  return userInfo().username
}
