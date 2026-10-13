import type { CodeFacade } from '../code'
import type { CompanyChanged } from '../company'
import type { FilesReader } from './files'
import type { LanguageReader } from './language'
import type { PathLinksReader } from './path-links'
import type { FileChanges } from './wire'

/**
 * The Files view's face on the engine (T113, T188).
 *
 * It carries the code flow because a place *is* a ticket worktree or a connected repo, and only the
 * flow knows where a ticket's worktrees are.
 */
export interface FilesFacade extends CompanyChanged, CodeFacade {
  /** The current Company's repos and ticket worktrees, read file by file. */
  files: FilesReader
  /**
   * What `git status` says in each of those places, and the boss's own stage, discard, commit and
   * push over it (T160). A discard takes a restore point first, where the place is a worktree.
   */
  fileChanges: FileChanges
}

/** The code viewer's face: one language server per place (T115). */
export interface LanguageFacade {
  language: LanguageReader
}

/** The paths an Employee wrote, turned into links over the Company's own places (T114). */
export interface PathLinksFacade {
  pathLinks: PathLinksReader
}
