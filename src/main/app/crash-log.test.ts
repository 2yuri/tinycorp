import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { crashReport } from '../../shared/app/crash'
import { onDisk } from '../core/testing'
import { crashLog, guardProcess } from './crash-log'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-crash-log-'))
  folders.push(folder)
  return folder
}

function log() {
  const path = join(temporary(), 'logs', 'crashes.log')
  return { path, log: crashLog({ path, version: '1.4.0', platform: 'darwin' }) }
}

describe('the app’s crash log', () => {
  it('writes down what a boundary caught, in a folder it makes itself', () => {
    const { path, log: file } = log()

    file.record(
      crashReport({
        source: 'view',
        error: new TypeError('destroy_ is not a function'),
        componentStack: '    at FileTree (files/FileTree.tsx:48)',
        route: 'files',
        version: '1.4.0',
        platform: 'darwin',
        at: new Date(2026, 8, 21, 12, 41),
      }),
    )

    const written = readFileSync(path, 'utf8')
    expect(written).toContain('21 Sep 2026, 12:41')
    expect(written).toContain('TypeError: destroy_ is not a function')
    expect(written).toContain('screen files')
    expect(written).toContain('TinyCorp 1.4.0 · darwin')
  })

  it('keeps every crash, one after another', () => {
    const { path, log: file } = log()

    file.recordThrow(new Error('first'))
    file.recordThrow(new Error('second'))

    const written = readFileSync(path, 'utf8')
    expect(written).toContain('Error: first')
    expect(written).toContain('Error: second')
  })

  it('keeps no path off the boss’s disk', () => {
    const { path, log: file } = log()

    file.recordThrow(new Error("ENOENT, open onDisk('/Users/grace/work/acme/docs/spec.md')"))

    expect(readFileSync(path, 'utf8')).not.toContain(onDisk('/Users/grace'))
  })

  it('drops the oldest half rather than filling a disk', () => {
    const { path, log: file } = log()
    file.recordThrow(new Error('oldest'))
    writeFileSync(path, `oldest\n${'x'.repeat(600 * 1024)}\n`)

    file.recordThrow(new Error('newest'))

    const written = readFileSync(path, 'utf8')
    expect(written.length).toBeLessThan(400 * 1024)
    expect(written).not.toContain('oldest')
    expect(written).toContain('Error: newest')
  })

  it('never takes the app down over a log it cannot write', () => {
    const file = crashLog({ path: join(temporary(), 'crashes.log', 'nested', 'no.log'), version: '1.4.0' })

    expect(() => file.recordThrow(new Error('boom'))).not.toThrow()
  })
})

describe('the main process guard', () => {
  it('writes down a throw and a rejection nobody handled, and lets go again', () => {
    const { path, log: file } = log()
    const process = new EventEmitter()

    const stop = guardProcess(file, process)
    process.emit('uncaughtException', new Error('nobody caught this'))
    process.emit('unhandledRejection', new Error('nobody awaited this'))
    stop()
    process.emit('uncaughtException', new Error('after the guard went'))

    const written = readFileSync(path, 'utf8')
    expect(written).toContain('Error: nobody caught this')
    expect(written).toContain('Error: nobody awaited this')
    expect(written).not.toContain('after the guard went')
  })
})
