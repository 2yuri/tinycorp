import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFolder } from '../../core/testing'
import { createCompanyLogos, LOGO_FILE, LOGO_MAX_SIDE } from './company-logo'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) removeFolder(folder)
})
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), 'company-logo-'))
  folders.push(made)
  return made
}

describe('A Company logo (T280)', () => {
  it('keeps the chosen image as one PNG in the Company folder and reads it back as a data URL', () => {
    const company = folder()
    const source = join(folder(), 'mark.jpg')
    writeFileSync(source, 'jpeg bytes')
    const asked: [string, number][] = []
    const logos = createCompanyLogos({
      toPng: (path, maxSide) => {
        asked.push([path, maxSide])
        return Buffer.from('png bytes')
      },
    })

    expect(logos.of(company)).toBeNull()
    const url = logos.set(company, source)

    expect(asked).toEqual([[source, LOGO_MAX_SIDE]])
    expect(readFileSync(join(company, LOGO_FILE), 'utf8')).toBe('png bytes')
    expect(url).toBe(`data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`)
    expect(logos.of(company)).toBe(url)
  })

  it('refuses a file that is not an image and keeps the logo it had', () => {
    const company = folder()
    const logos = createCompanyLogos({
      toPng: (path) => {
        if (path.endsWith('.txt')) throw new Error('not an image')
        return Buffer.from('png')
      },
    })
    const before = logos.set(company, 'a.png')

    expect(() => logos.set(company, 'notes.txt')).toThrow('not an image')
    expect(logos.of(company)).toBe(before)
  })

  it('takes the logo away, so the Company has none', () => {
    const company = folder()
    const logos = createCompanyLogos({ toPng: () => Buffer.from('png') })
    logos.set(company, 'a.png')

    logos.remove(company)

    expect(existsSync(join(company, LOGO_FILE))).toBe(false)
    expect(logos.of(company)).toBeNull()
  })
})
