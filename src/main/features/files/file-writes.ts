/**
 * The write side of the Files view (T122). It lives with the read, behind the same path checks:
 * a place the Company knows, no `..`, no symlink that points away, and never inside `.git`.
 *
 * Nothing here is overwritten by surprise. A save carries the digest the file had when it was
 * opened; when what is on disk no longer matches — the Employee wrote it while the boss typed —
 * the write stops and both versions come back for the boss to pick from.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { GIT_FOLDER, newFileRefusal } from '../../../shared/files/file-edits'

/** What a file's bytes are known by: sha-256, hex. Cheap, and never mistaken for the text. */
export function digestOf(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Refuses a path inside the folder git owns, wherever in the place it sits. */
export function refuseGitPath(path: string): void {
  if (path.split('/').includes(GIT_FOLDER))
    throw new Error(`Nothing is written into ${GIT_FOLDER} — that folder is git’s own`)
}

/** Refuses a path that could never be created; the same rules the boss's box already showed. */
export function refuseNewPath(path: string): void {
  const refusal = newFileRefusal(path)
  if (refusal) throw new Error(refusal)
}

/**
 * What is on disk now, when it is not what was opened; null when the save may go ahead. A file
 * that has gone underneath the boss counts as changed, with nothing as their version of it.
 */
export function changedUnderneath(full: string, digest: string): { text: string; digest: string } | null {
  let bytes: Buffer
  try {
    bytes = readFileSync(full)
  } catch {
    bytes = Buffer.alloc(0)
  }
  const now = digestOf(bytes)
  return now === digest ? null : { text: bytes.toString('utf8'), digest: now }
}

/** Writes the text to the file, making the folders above it that the place does not have yet. */
export function writeInside(full: string, text: string): void {
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, text, 'utf8')
}

/** Creates an empty file, refusing a name the place already has. */
export function createInside(full: string, path: string): void {
  if (existsSync(full)) throw new Error(`${path} already exists — pick another name`)
  mkdirSync(dirname(full), { recursive: true })
  // `wx` and not a plain write: two creates racing each other must not both think they won.
  writeFileSync(full, '', { encoding: 'utf8', flag: 'wx' })
}
