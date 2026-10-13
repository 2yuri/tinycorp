/**
 * The Files screen: the tree, the tabs, the diffs, and the markdown body other screens reuse.
 *
 * The editor it draws a file and a diff in is `src/renderer/src/editor`, which the Review screen
 * draws its diff with too (T243).
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { FilesView } from './FilesView'
export { MarkdownBody } from './Viewers'
