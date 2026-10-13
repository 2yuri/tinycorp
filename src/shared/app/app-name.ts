/** What the app calls itself, wherever it has to name itself — the Dock, the menu bar, `Quit`. */
export const APP_NAME = 'TinyCorp'

/**
 * The app's bundle identifier, written in one place and read everywhere it is needed: the
 * development bundle `tools/dev-identity.mjs` renames, the packaged build (#226), and the System
 * Settings pane the boss is sent to. macOS grants permission to post a banner per identifier, so
 * the moment this string moves the app asks the system as a new application and every permission
 * the boss already gave is gone (T126).
 */
export const APP_ID = 'dev.tinycorp.app'
