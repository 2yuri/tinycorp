import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createGitRunner, type GitRunner } from './git-runner'

/**
 * Keeping the files TinyCorp writes into a checkout out of that checkout's history.
 *
 * `.git/info/exclude` is the right place for it: it is the checkout's own ignore list, it is not
 * a tracked file, and a repo the boss shares carries none of it. This is git, so it lives with
 * the machine and not with whatever asked — a Provider's config folder, a Company's data folder,
 * a skill folder — all of which are above it (T186a).
 */

/**
 * Keeps injected files out of the repo when `cwd` is a git checkout.
 *
 * Through the app's one runner, because since T256 `cwd` can be a folder inside a WSL distro. Asked
 * from Windows that repo is refused outright as *dubious ownership*, and an exclude that quietly did
 * nothing would leave the Company's own files showing in the boss's repo; asked by the distro's own
 * git it simply answers, which is what the runner arranges (T259).
 *
 * The exclude file is then written with `node:fs` rather than by git, and that is deliberate even
 * inside a distro: this process reaches it over the share, and a whole extra `wsl.exe` to append
 * four lines would buy nothing. `mapPaths` is what makes it possible — the distro's git answers
 * `/home/b/acme/.git/info/exclude`, and the app needs the `\\wsl.localhost\…` it can open.
 */
export function excludeFromGit(cwd: string, patterns: string[], git: GitRunner = createGitRunner()): void {
  const exclude = git.tryText(cwd, ['rev-parse', '--git-path', 'info/exclude'], { mapPaths: true })?.trim()
  if (!exclude) return
  const file = resolve(cwd, exclude)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const lines = new Set(current.split('\n'))
  const missing = patterns.filter((p) => !lines.has(p))
  if (missing.length === 0) return
  mkdirSync(dirname(file), { recursive: true })
  const prefix = current && !current.endsWith('\n') ? '\n' : ''
  appendFileSync(file, `${prefix}${missing.join('\n')}\n`)
}
