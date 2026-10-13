/**
 * Git for Windows' `bash.exe`, and why a Windows machine without it is a Windows machine where a
 * team running on Windows cannot work at all (T249).
 *
 * A Provider that runs its shell tools through `bash` has no `bash` on a stock Windows, and git
 * itself comes from the same install. So a boss whose team runs on Windows without Git for Windows
 * gets Sessions that start, answer, and then fail at their first command — which reads as the
 * product being broken rather than as a missing install. That is why the first launch will not let
 * Continue through until either it is installed or the team is moved into WSL, where none of it
 * applies.
 *
 * `\\Windows\\System32\\bash.exe` is not this. That is the WSL launcher Windows ships, and it is
 * on the `PATH` of every machine that has ever enabled the feature — taking it for Git Bash is how
 * a check like this reports success on precisely the machines it exists to warn.
 *
 * Nothing here is node code and nothing here names a Provider: the words are the renderer's, the
 * shape is what the engine fills in, and which products need it comes from the catalogue
 * (`PROVIDER_NEEDS_GIT_BASH`). `src/main/platform/git-bash.ts` is the machine half.
 */

/** Whether Git for Windows' `bash.exe` is on this machine, and everywhere that was looked. */
export interface GitBashCheck {
  /** The full path of `bash.exe`, or null when nothing here is one. */
  path: string | null
  /** Everywhere that was looked, in the words the card prints: `PATH`, then the folders. */
  lookedIn: readonly string[]
}

/** A machine nobody has asked about — off Windows, or before the first answer. */
export const NO_GIT_BASH_CHECK: GitBashCheck = { path: null, lookedIn: [] }

/** The row's label in Your profile (frame `t1VDYQ`). */
export const GIT_BASH_TITLE = 'Git Bash'

/** The badge beside it, either way. */
export const GIT_BASH_FOUND = 'Found'
export const GIT_BASH_MISSING = 'Not installed'

/** The notice's own title on the first-launch step (frame `QFh5u`). */
export const GIT_BASH_NOTICE_TITLE = 'Git for Windows is not installed'

/**
 * Why it matters, on the step that will not let the boss past it. `names` is whichever Providers
 * the catalogue says need it, so the sentence stays true as the catalogue changes.
 */
export function gitBashNotice(names: readonly string[]): string {
  return `${sentenceOf(names)} its commands in Git Bash on Windows. Install it, then continue — or let your team run in WSL instead.`
}

/** The same fact in Your profile, where nothing is being blocked (frame `t1VDYQ`). */
export function gitBashHint(names: readonly string[]): string {
  return `${sentenceOf(names)} its commands in Git Bash on Windows. Needed only while your team runs on Windows.`
}

/** `Claude Code runs` / `Claude Code and Codex run` — the subject and its verb. */
function sentenceOf(names: readonly string[]): string {
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'Some CLIs')
  return `${list} ${names.length === 1 ? 'runs' : 'run'}`
}

/** The one-line install the command box prints. */
export const GIT_BASH_COMMAND = 'winget install --id Git.Git -e'

/** `Looked in: PATH · C:\Program Files\Git\bin` (frame `QFh5u`). */
export function gitBashLookedIn(lookedIn: readonly string[]): string {
  return lookedIn.length > 0 ? `Looked in: ${lookedIn.join(' · ')}` : ''
}

/** The button beside it, which walks the machine again. */
export const GIT_BASH_RECHECK = 'Check again'

/** What the footer says while Continue cannot be pressed (frame `QFh5u`). */
export const GIT_BASH_BLOCKS = 'Install Git for Windows and check again — or run your team in WSL.'
