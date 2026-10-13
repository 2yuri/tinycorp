/**
 * A path with the user's home folder written as `~`.
 *
 * The three shapes a home folder has on the three platforms, and nothing else: a path somewhere
 * else — `/srv/acme`, a UNC share — is written out in full rather than half-abbreviated.
 */
export function tildePath(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/, '~')
}
