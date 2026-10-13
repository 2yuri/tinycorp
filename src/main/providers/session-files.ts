/**
 * The files an adapter writes for one Session, in the app's own `dataDir` — Claude Code's MCP
 * config, OpenCode's whole Session config — and the one place they are taken away again.
 *
 * Every one of them holds that Session's bearer token for the Company MCP server. `0600` keeps
 * out other accounts on the machine, and this threat model has none: every Employee is a process
 * of the *same* OS user as the app, so a file that outlives its Session is one Employee's token
 * sitting in a folder every other Employee can `cat` (T199, finding H5). So the file lives exactly
 * as long as the Session does — the engine calls the adapter's own `forgetSession` where it
 * ends one — and whatever a crash left behind goes at the next start, through
 * {@link clearSessionFiles}.
 *
 * That is a shorter window, not a boundary: while the Session runs, the file is readable by every
 * other Employee, and there is no mode and no folder that changes it. `SECURITY.md` says so out
 * loud rather than leaving the `0600` to look like an answer.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isProviderSessionId, requireProviderSessionId } from './provider-adapter'

/**
 * Writes one Session's file under `<dataDir>/<folder>/<sessionId>.json` and hands back its path.
 * The folder is the app's own and is created `0700`; the file is `0600`, because every secret this
 * Session holds is in it.
 */
export function writeSessionFile(dataDir: string, folder: string, sessionId: string, contents: string): string {
  // The id is a path component here, and it can have come back from a hook the Session itself
  // POSTed (T199, finding H1): one that is not a provider session id would name a file anywhere on
  // the disk — and, below, delete one.
  requireProviderSessionId(sessionId, `${folder} config`)
  const dir = join(dataDir, folder)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, `${sessionId}.json`)
  writeFileSync(path, contents, { mode: 0o600 })
  return path
}

/**
 * Takes that file away again. Called where a Session ends, for a Session that may never have had
 * one, so a file that is not there is not an error — and neither is a session id nothing could
 * have been written under.
 */
export function forgetSessionFile(dataDir: string, folder: string, sessionId: string): void {
  if (!isProviderSessionId(sessionId)) return
  rmSync(join(dataDir, folder, `${sessionId}.json`), { force: true })
}

/**
 * Everything every adapter wrote for a Session, gone. Called once at start-up, before the first
 * Session: what is in there belongs to Sessions that died with the last run of the app, and the
 * folder is the app's own — nothing but these files lives in it.
 */
export function clearSessionFiles(dataDir: string): void {
  rmSync(dataDir, { recursive: true, force: true })
}
