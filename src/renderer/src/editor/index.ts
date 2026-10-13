/**
 * Monaco — VS Code's own editor — as the app reaches it (T222, T243).
 *
 * It is a module of its own because two screens draw it: the Files view edits a file in it, and
 * both the Review screen and the Files view's Changes tab read a diff in it. Whichever arrives
 * first pulls the one lazy chunk, and the other finds it already there.
 *
 * **Nothing here is on the startup bundle, and this barrel is why.** `CodeEditor` and `DiffEditor`
 * are the two seams: each is a frame that imports its Monaco half lazily. The editor itself
 * (`monaco.ts`), the runtime pieces around it and the two `*Monaco.tsx` components are *not*
 * exported, because a barrel that named them would make every importer of this folder eager — the
 * one thing the whole split exists to prevent. What is exported besides the seams is plain data:
 * which language a path is drawn in, how a diff is laid out, what hangs under a line.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { CodeEditor, type CodeServer } from './CodeEditor'
export { DiffControlBar, type DiffControls, DiffEditor, useDiffControls } from './DiffEditor'
export { DIFF_LAYOUT_KEY, type DiffMark } from './diff-model'
