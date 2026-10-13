/**
 * Files: what is in a worktree, what changed in it, and what opens it.
 *
 * One module because it is one screen. The tree and the reader (`files.ts`), the diff against the
 * branch point (`file-changes.ts`), the code intelligence behind it (`language.ts`, `lsp-client.ts`),
 * the `file:line` links the chat turns into something clickable (`path-links.ts`) and the desktop
 * editors that open a path (`editors.ts`) are all the same question asked from different screens.
 *
 * This is the module's front door. Writing, path resolution, the LSP wire protocol and the parsers
 * stay inside; the tests name them directly, and so does the Files capture's dev server — reaching
 * for the readers alone, because this door also opens on `electron`, which in plain Node is the
 * path to a binary rather than a module (T209).
 */

export { editorChoiceFile } from './editor-choice-file'
export { createEditors } from './editors'
export { registerEditorsIpc } from './editors-ipc'
export type { FilesFacade, LanguageFacade, PathLinksFacade } from './facade'
export { desktopFileTools, desktopPathTools } from './file-tools'
export { IMAGE_TYPES } from './files'
export { registerFilesIpc } from './files-ipc'
export { registerLanguageIpc } from './language-ipc'
export { registerPathsIpc } from './paths-ipc'
export { register as registerFiles } from './wire'
