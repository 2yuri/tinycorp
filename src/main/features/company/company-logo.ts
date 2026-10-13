import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The Company's logo, in its own folder beside `company.sqlite` (T280). */
export const LOGO_FILE = 'logo.png'

/** The longest side a logo is kept at: the rail's tile and the office's widest wall are both far under it. */
export const LOGO_MAX_SIDE = 256

export interface CompanyLogosOptions {
  /**
   * The image at `path` as PNG bytes, its longest side at most `maxSide`. Throws when the file is not
   * an image it can read. The app hands in Electron's `nativeImage`; a test hands in anything.
   */
  toPng(path: string, maxSide: number): Buffer
}

/**
 * Each Company's logo (T280): chosen by the boss, kept as one PNG in the Company's folder so it moves
 * and is deleted with it, and read back as a `data:` URL, which is what the window's policy lets an
 * image be. A read is kept until the file changes, so drawing the rail does not read the disk.
 */
export interface CompanyLogos {
  /** The logo in `folder` as a `data:` URL, or null when the Company has none. */
  of(folder: string): string | null
  /** Makes the image at `source` the logo of the Company in `folder`, and answers it as `of` would. */
  set(folder: string, source: string): string
  remove(folder: string): void
}

export function createCompanyLogos({ toPng }: CompanyLogosOptions): CompanyLogos {
  const read = new Map<string, { at: number; url: string }>()

  function of(folder: string): string | null {
    const file = join(folder, LOGO_FILE)
    if (!existsSync(file)) {
      read.delete(folder)
      return null
    }
    const at = statSync(file).mtimeMs
    const known = read.get(folder)
    if (known?.at === at) return known.url
    const url = `data:image/png;base64,${readFileSync(file).toString('base64')}`
    read.set(folder, { at, url })
    return url
  }

  return {
    of,
    set(folder, source) {
      writeFileSync(join(folder, LOGO_FILE), toPng(source, LOGO_MAX_SIDE))
      read.delete(folder)
      return of(folder) as string
    },
    remove(folder) {
      rmSync(join(folder, LOGO_FILE), { force: true })
      read.delete(folder)
    },
  }
}
