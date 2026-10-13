import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type FilePlace, placeId } from '../../../shared/files/files'
import { createPathLinks } from './path-links'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-path-links-'))
  folders.push(folder)
  return folder
}

/** The real disk, which is what the resolver is for; only the home is the test's own. */
function onDisk(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function place(path: string, repoName: string, ticketId: number | null = null): FilePlace {
  return {
    id: placeId(repoName, ticketId),
    repoId: repoName,
    repoName,
    path,
    ticketId,
    ticketKey: null,
    ticketTitle: null,
    holderName: null,
    branch: null,
    base: null,
    sessionRunning: false,
  }
}

/** A Company with two repos on disk, and a folder of screenshots that is neither. */
function company() {
  const root = temporary()
  const tinycorp = join(root, 'tinycorp')
  const web = join(root, 'web')
  const shots = join(root, 'shots')
  mkdirSync(join(tinycorp, 'src/shared/office'), { recursive: true })
  mkdirSync(join(web, 'src/format'), { recursive: true })
  mkdirSync(shots, { recursive: true })
  writeFileSync(join(tinycorp, 'src/shared/office/counter.ts'), 'export const one = 1\n')
  writeFileSync(join(tinycorp, 'README.md'), '# tinycorp\n')
  writeFileSync(join(web, 'src/format/currency.ts'), 'export const brl = 1\n')
  writeFileSync(join(shots, 'menu-portrait.png'), 'not really a png')
  const places = [place(tinycorp, 'tinycorp'), place(web, 'web')]
  const links = createPathLinks({ places: () => places, deps: { isFile: onDisk, home: () => root } })
  return { root, tinycorp, web, shots, links }
}

describe('A path an Employee wrote', () => {
  it('opens a repo-relative path in the place it is in', () => {
    const { links, tinycorp } = company()

    expect(links.links('I changed src/shared/office/counter.ts today')).toEqual([
      expect.objectContaining({
        text: 'src/shared/office/counter.ts',
        full: join(tinycorp, 'src/shared/office/counter.ts'),
        target: {
          kind: 'place',
          placeId: placeId('tinycorp', null),
          path: 'src/shared/office/counter.ts',
          line: null,
          column: null,
        },
      }),
    ])
  })

  it('carries the line and the column it was written with', () => {
    const { links } = company()

    expect(links.links('README.md:19:8')[0]?.target).toEqual(
      expect.objectContaining({ kind: 'place', path: 'README.md', line: 19, column: 8 }),
    )
  })

  it('takes the repo in front of a path as the place to look in', () => {
    const { links, web } = company()
    const [link] = links.links('web src/format/currency.ts:19 is where the rounding is')

    expect(link).toMatchObject({
      text: 'web src/format/currency.ts:19',
      full: join(web, 'src/format/currency.ts'),
      target: { kind: 'place', placeId: placeId('web', null), path: 'src/format/currency.ts', line: 19 },
    })
  })

  it('opens an absolute path inside a Company place as that place’s file', () => {
    const { links, tinycorp } = company()

    expect(links.links(`open ${join(tinycorp, 'README.md')} please`)[0]?.target).toEqual({
      kind: 'place',
      placeId: placeId('tinycorp', null),
      path: 'README.md',
      line: null,
      column: null,
    })
  })

  it('hands an absolute path outside every place to the opener instead', () => {
    const { links, shots } = company()
    const shot = join(shots, 'menu-portrait.png')

    expect(links.links(`compare ${shot} with the other one`)[0]?.target).toEqual({ kind: 'outside', path: shot })
    expect(links.links('the one at ~/shots/menu-portrait.png')[0]?.target).toEqual({ kind: 'outside', path: shot })
  })

  it('leaves a path that is not there as plain text, and a bare word too', () => {
    const { links } = company()

    expect(links.links('I changed src/shared/office/missing.ts today')).toEqual([])
    expect(links.links('the counter speaks now')).toEqual([])
  })

  it('locates one written path, and only when the whole of it is one', () => {
    const { links, shots } = company()

    expect(links.locate(` ${join(shots, 'menu-portrait.png')} `)).toBe(join(shots, 'menu-portrait.png'))
    expect(links.locate('src/shared/office/missing.ts')).toBeNull()
    expect(links.locate('open README.md for me')).toBeNull()
  })

  it('reads a file outside the Company for the viewer, whatever kind it is', () => {
    const { links, shots, root } = company()
    writeFileSync(join(shots, 'notes.txt'), 'nothing to draw')

    expect(links.open(join(shots, 'menu-portrait.png'))).toMatchObject({ kind: 'image' })
    expect(links.open(join(shots, 'notes.txt'))).toMatchObject({ kind: 'text', text: 'nothing to draw' })
    expect(() => links.open(join(root, 'nowhere.txt'))).toThrow(/no file/i)
  })

  it('finds nothing while no Company is open', () => {
    const links = createPathLinks({
      places: () => {
        throw new Error('No Company is open')
      },
    })

    expect(links.links('src/shared/office/counter.ts')).toEqual([])
  })
})
