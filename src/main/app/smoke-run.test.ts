import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appImage,
  crashes,
  nodeProbeArgs,
  nodeProbeEnv,
  packagedApp,
  RAN_AS_NODE,
  ranAsNode,
  saidItLoaded,
  smokeArgs,
  smokeEnv,
  SMOKE_ENV as TOOL_ENV,
  SMOKE_READY as TOOL_READY,
  SMOKE_READY_FILE as TOOL_READY_FILE,
  verdict,
} from '../../../tools/smoke-packaged.mjs'
import { SMOKE_ENV, SMOKE_READY, SMOKE_READY_FILE, smokeRun } from './smoke-run'

/**
 * The packaged app and the script that starts it agree on one word and one line (T166). They are
 * written twice — the app is TypeScript the bundler compiles, the runner is a plain script CI calls
 * before anything is compiled — so this is what keeps them the same.
 */

describe('smokeRun', () => {
  it('is off unless the variable says otherwise', () => {
    expect(smokeRun({})).toBe(false)
    expect(smokeRun({ [SMOKE_ENV]: '' })).toBe(false)
    expect(smokeRun({ [SMOKE_ENV]: '  ' })).toBe(false)
    expect(smokeRun({ [SMOKE_ENV]: '1' })).toBe(true)
  })
})

describe('the runner and the app', () => {
  it('name the same variable, the same line and the same file', () => {
    expect(TOOL_ENV).toBe(SMOKE_ENV)
    expect(TOOL_READY).toBe(SMOKE_READY)
    expect(TOOL_READY_FILE).toBe(SMOKE_READY_FILE)
  })
})

describe('saying it loaded', () => {
  it('is the line on stdout, or the file the run also writes', () => {
    const folder = mkdtempSync(join(tmpdir(), 'smoke-ready-'))
    try {
      expect(saidItLoaded(folder, `starting\n${SMOKE_READY}\n`)).toBe(true)
      expect(saidItLoaded(folder, 'starting\n')).toBe(false)
      // A Windows GUI process is not always given the console its parent reads.
      writeFileSync(join(folder, SMOKE_READY_FILE), `${SMOKE_READY}\n`)
      expect(saidItLoaded(folder, 'starting\n')).toBe(true)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('verdict', () => {
  const ok = { code: 0, loaded: true, crashLog: '' }

  it('passes a run that exited 0, said it loaded and wrote down no crash', () => {
    expect(verdict(ok)).toBeNull()
  })

  it('fails a non-zero exit, and a run that never answered at all', () => {
    expect(verdict({ ...ok, code: 1 })).toContain('exited with 1')
    expect(verdict({ ...ok, code: null })).toContain('no code')
  })

  it('fails a run that exited 0 without ever loading a window', () => {
    expect(verdict({ ...ok, loaded: false })).toContain('never said')
  })

  it('fails a run that loaded and then wrote to its crash log', () => {
    expect(verdict({ ...ok, crashLog: 'TypeError: nope' })).toContain('crash log')
  })

  /**
   * A binary that answered the probe as Node exited 0 and never loaded a window, so it would
   * otherwise be reported as a window that failed to open — which is the wrong sentence for an app
   * that is still a general-purpose Node interpreter (T199, H4).
   */
  it('fails a run that answered as Node, before it says anything about the window', () => {
    expect(verdict({ code: 0, loaded: false, crashLog: '', ranAsNode: true })).toContain('runAsNode fuse')
  })
})

/**
 * The half of the fuses that no configuration can prove: the built binary is asked, the way an
 * attacker would ask it, whether `ELECTRON_RUN_AS_NODE` still means anything (T199, finding H4).
 */
describe('the node probe', () => {
  it('evaluates a script and nothing else, because Node exits 9 on an option it does not know', () => {
    expect(nodeProbeArgs()).toEqual(['-e', `console.log(${JSON.stringify(RAN_AS_NODE)})`])
    expect(nodeProbeArgs().some((argument) => argument.startsWith('--'))).toBe(false)
  })

  it('asks for Node, and keeps the app half of the answer out of the real profile', () => {
    const environment = nodeProbeEnv('/tmp/home', 'darwin', {})
    expect(environment['ELECTRON_RUN_AS_NODE']).toBe('1')
    expect(environment[SMOKE_ENV]).toBe('1')
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME']) {
      expect(environment[key], `${key} still points at the real profile`).toBe('/tmp/home')
    }
  })

  it('reads the answer off what the binary printed, and nothing else', () => {
    expect(ranAsNode(`hello\n${RAN_AS_NODE}\n`)).toBe(true)
    expect(ranAsNode(`${SMOKE_READY}\n`)).toBe(false)
  })
})

describe('the packaged app it looks for', () => {
  it('is nothing at all on a platform nothing is built for', () => {
    expect(packagedApp('aix' as NodeJS.Platform)).toBeNull()
  })

  it('reads no crash log where no run has left one', () => {
    expect(crashes(import.meta.dirname)).toBe('')
  })

  /**
   * On Linux the thing a boss downloads is the AppImage, not the unpacked folder beside it, so
   * that is what the smoke run has to start — and it is found by looking, because its name carries
   * the version (T177).
   */
  it('is the AppImage on Linux, whatever version it was built as', () => {
    const root = mkdtempSync(join(tmpdir(), 'smoke-release-'))
    try {
      expect(appImage(root)).toBeNull()
      expect(packagedApp('linux', root)).toBeNull()
      mkdirSync(join(root, 'release'))
      writeFileSync(join(root, 'release', 'TinyCorp-9.9.9-x64.AppImage'), '')
      expect(appImage(root)).toBe(join(root, 'release', 'TinyCorp-9.9.9-x64.AppImage'))
      expect(packagedApp('linux', root)).toBe(appImage(root))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * Two things a Linux runner needs and no other platform does: Chromium's sandbox off, because the
 * helper inside an extracted AppImage cannot be setuid root, and the AppImage runtime told to
 * unpack rather than mount, because a GitHub runner has no FUSE. Without either the app exits
 * before any window and the smoke run blames the build (T177).
 */
describe('how the run is started', () => {
  it("turns Chromium's sandbox off on Linux and leaves it alone everywhere else", () => {
    expect(smokeArgs('/tmp/u', 'linux')).toEqual(['--user-data-dir=/tmp/u', '--no-sandbox'])
    expect(smokeArgs('/tmp/u', 'darwin')).toEqual(['--user-data-dir=/tmp/u'])
    expect(smokeArgs('/tmp/u', 'win32')).toEqual(['--user-data-dir=/tmp/u'])
  })

  it('asks the AppImage to extract itself, so it starts on a runner with no FUSE', () => {
    expect(smokeEnv('linux', {})).toEqual({ [SMOKE_ENV]: '1', APPIMAGE_EXTRACT_AND_RUN: '1' })
    expect(smokeEnv('darwin', {})).toEqual({ [SMOKE_ENV]: '1' })
  })
})
