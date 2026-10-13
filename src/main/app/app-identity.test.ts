import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { setName: vi.fn(), setAppUserModelId: vi.fn(), isPackaged: false, dock: undefined, getPath: () => '/tmp' },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
}))

const { APP_ID, APP_NAME, applyAppIdentity } = await import('./app-identity')
const { appIdentity } = await import('../../../tools/dev-identity.mjs')
const electron = (await import('electron')) as unknown as {
  app: { setName: (n: string) => void; setAppUserModelId: (id: string) => void }
}

describe('The app identity', () => {
  it('names the app so the switcher and menu bar do not say Electron', () => {
    applyAppIdentity()
    expect(APP_NAME).toBe('TinyCorp')
    expect(electron.app.setName).toHaveBeenCalledWith('TinyCorp')
  })

  it('claims the identifier notifications are granted against', () => {
    applyAppIdentity()

    expect(electron.app.setAppUserModelId).toHaveBeenCalledWith('dev.tinycorp.app')
  })

  it('gives the development bundle the identifier the packaged app will use, from one place', () => {
    // A second spelling of the id would ask macOS for notification permission as a new app (T126).
    expect(APP_ID).toBe('dev.tinycorp.app')
    expect(appIdentity()).toEqual({ name: APP_NAME, id: APP_ID })
  })

  // What the menu holds is `menu/app-menu.test.ts`; the identity only has to name the app.
})
