/** Folders the OS may empty on restart (decision 45). The OS temp dir is added by the main process. */
export const TEMPORARY_ROOTS = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders'] as const

export const TEMPORARY_FOLDER_WARNING = 'This company lives in a temporary folder and can be lost on restart'

/** Whether `folder` is one of the temporary roots or inside one. */
export function isTemporaryFolder(folder: string, roots: readonly string[]): boolean {
  return isUnderAnyRoot(folder, roots)
}

/** Whether `folder` is one of `roots` or inside one. Windows paths compare without case. */
export function isUnderAnyRoot(folder: string, roots: readonly string[]): boolean {
  const path = normalise(folder)
  return roots.some((root) => {
    const base = normalise(root)
    return base !== '' && (path === base || path.startsWith(`${base}/`))
  })
}

function normalise(path: string): string {
  const windows = /^[a-zA-Z]:|\\/.test(path)
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return windows ? slashed.toLowerCase() : slashed
}
