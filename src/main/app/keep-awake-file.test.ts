import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keepAwakeFile } from './keep-awake-file'

function file() {
  return join(mkdtempSync(join(tmpdir(), 'tinycorp-keep-awake-')), 'keep-awake.json')
}

describe('the keep-awake mode on disk', () => {
  it("remembers the boss's choice across runs", () => {
    const path = file()
    keepAwakeFile(path).write('on')
    expect(keepAwakeFile(path).read()).toBe('on')
  })

  it('has no mode before the boss has chosen one', () => {
    expect(keepAwakeFile(file()).read()).toBeNull()
  })

  it('ignores a file that says something else', () => {
    const path = file()
    writeFileSync(path, '{"mode":"always"}')
    expect(keepAwakeFile(path).read()).toBeNull()
    writeFileSync(path, 'not json')
    expect(keepAwakeFile(path).read()).toBeNull()
  })
})
