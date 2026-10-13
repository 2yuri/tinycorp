import type { DiffFile } from './review-diff'

/**
 * A unified diff (a forge's own patch, `git diff base...head`) as the list of files it touches,
 * each with what happened to it and how many lines it gained and lost.
 *
 * **Only the list.** Since T243 the diff itself is drawn by Monaco, which is given the two sides of
 * a file and works out the rest, so nothing builds hunks any more: the list is what the screen
 * needs first and it is all that crosses IPC. Anything the parser does not understand is skipped,
 * so a patch with an unusual header still yields the files around it.
 */
export function diffFilesOf(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  /** True between a `@@` and the next header line: the +/− in there are the counted ones. */
  let counting = false

  // A patch ends in a newline; the empty string after it is not a blank context line.
  const lines = patch.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      current = blankFile(pathsOf(line)?.[1] ?? '')
      counting = false
      files.push(current)
      continue
    }
    if (current === null) continue
    if (line.startsWith('@@')) {
      counting = true
      continue
    }
    if (!counting) {
      readHeader(current, line)
      continue
    }
    // `\ No newline at end of file` belongs to the line before it, and counts as nothing.
    if (line.startsWith('\\')) continue
    if (line.startsWith('+')) current.additions++
    else if (line.startsWith('-')) current.deletions++
    // A blank line and a ` ` line are both context; anything else has left the hunks behind.
    else if (line !== '' && !line.startsWith(' ')) {
      counting = false
      readHeader(current, line)
    }
  }
  return files.filter((file) => file.path !== '')
}

function blankFile(path: string): DiffFile {
  return { path, previousPath: null, status: 'modified', additions: 0, deletions: 0, binary: false }
}

/** The header lines between `diff --git` and the first `@@`: status, rename and binary. */
function readHeader(file: DiffFile, line: string): void {
  if (line.startsWith('new file mode')) file.status = 'added'
  else if (line.startsWith('deleted file mode')) file.status = 'removed'
  else if (line.startsWith('rename from ')) {
    file.status = 'renamed'
    file.previousPath = line.slice('rename from '.length)
  } else if (line.startsWith('rename to ')) {
    file.status = 'renamed'
    file.path = line.slice('rename to '.length)
  } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) file.binary = true
  else if (line.startsWith('+++ ')) {
    const path = sidePath(line.slice('+++ '.length))
    if (path !== null) file.path = path
  } else if (line.startsWith('--- ')) {
    const path = sidePath(line.slice('--- '.length))
    if (path !== null && file.path === '') file.path = path
  }
}

/** `b/src/a.ts` as `src/a.ts`; `/dev/null` and a quoted path git escaped are left to the header. */
function sidePath(side: string): string | null {
  const path = side.replace(/\t.*$/, '').trim()
  if (path === '/dev/null' || path.startsWith('"')) return null
  return /^[ab]\//.test(path) ? path.slice(2) : path
}

/**
 * `diff --git a/x b/x` as its two paths. Git writes both sides unquoted and space-separated, so the
 * split is the one that makes both halves agree on their prefixes.
 */
function pathsOf(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length)
  const words = rest.split(' ')
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(' ')
    const right = words.slice(i).join(' ')
    if (left.startsWith('a/') && right.startsWith('b/')) return [left.slice(2), right.slice(2)]
  }
  return null
}
