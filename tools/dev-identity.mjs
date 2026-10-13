/**
 * Names the development app after the product.
 *
 * `pnpm dev` runs inside Electron's own bundle, and macOS reads the menu bar's title and the
 * app-switcher's name from that bundle's `Info.plist`, not from `app.setName`. So in development the
 * app calls itself Electron however carefully the code sets its name. This rewrites the three keys
 * that show, in `node_modules` only: it is undone by any reinstall, which is why `predev` runs it
 * every time, and it changes nothing about a packaged build.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IDENTITY_SOURCE = new URL('../src/shared/app/app-name.ts', import.meta.url)

/**
 * The product name and the bundle identifier, read from the one file that holds them
 * (`src/shared/app/app-name.ts`). The identifier must not drift: macOS grants permission to post
 * notifications per bundle id, so a second spelling here would quietly ask the boss again as a
 * different application, and the permission he already gave would be gone (T126).
 */
export function appIdentity() {
  const source = readFileSync(fileURLToPath(IDENTITY_SOURCE), 'utf8')
  return { name: constant(source, 'APP_NAME'), id: constant(source, 'APP_ID') }
}

function constant(source, name) {
  const found = new RegExp(`export const ${name} = '([^']+)'`).exec(source)
  if (!found) throw new Error(`${name} is not in src/shared/app/app-name.ts`)
  return found[1]
}

/** Rewrites the development bundle's `Info.plist`; a no-op away from macOS. */
export function nameDevelopmentBundle() {
  const { name, id } = appIdentity()
  const require = createRequire(import.meta.url)
  const electron = dirname(require.resolve('electron'))
  const plist = join(electron, 'dist', 'Electron.app', 'Contents', 'Info.plist')

  if (process.platform !== 'darwin' || !existsSync(plist)) return false
  if (readFileSync(plist, 'utf8').includes(`<string>${name}</string>`)) return false

  for (const [key, value] of [
    ['CFBundleName', name],
    ['CFBundleDisplayName', name],
    ['CFBundleIdentifier', id],
  ]) {
    execFileSync('plutil', ['-replace', key, '-string', value, plist])
  }
  return true
}

// Only when run as `node tools/dev-identity.mjs`: importing it reads the identity and nothing more.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (nameDevelopmentBundle()) console.log(`dev app named ${appIdentity().name}`)
}
