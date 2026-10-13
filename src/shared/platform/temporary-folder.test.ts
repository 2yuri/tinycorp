import { describe, expect, it } from 'vitest'
import { isTemporaryFolder, TEMPORARY_ROOTS } from './temporary-folder'

describe('Temporary folders', () => {
  it('knows the Unix temporary roots and what is inside them', () => {
    for (const folder of [
      '/tmp',
      '/tmp/acme',
      '/private/tmp/acme',
      '/var/folders/xy/T/acme',
      '/private/var/folders/a/b',
    ]) {
      expect(isTemporaryFolder(folder, TEMPORARY_ROOTS)).toBe(true)
    }
  })

  it('leaves ordinary folders and look-alikes alone', () => {
    for (const folder of ['/Users/ada/acme', '/tmpfiles/acme', '/var/lib/acme', '/home/tmp']) {
      expect(isTemporaryFolder(folder, TEMPORARY_ROOTS)).toBe(false)
    }
  })

  it('takes the OS temp dir, trailing slashes and Windows paths', () => {
    expect(
      isTemporaryFolder('C:\\Users\\Ada\\AppData\\Local\\Temp\\acme', ['c:\\users\\ada\\appdata\\local\\temp\\']),
    ).toBe(true)
    expect(isTemporaryFolder('/scratch/t/acme', ['/scratch/t/'])).toBe(true)
    expect(isTemporaryFolder('/acme', [''])).toBe(false)
  })
})
