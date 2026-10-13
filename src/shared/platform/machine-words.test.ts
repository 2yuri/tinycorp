import { describe, expect, it } from 'vitest'
import { inMachineWords, machineWords } from './machine-words'

describe('the machine’s words', () => {
  it('are the Mac’s on a Mac — the words the Pen frames are drawn with', () => {
    expect(machineWords('darwin')).toEqual({
      machine: 'this Mac',
      reveal: 'Reveal in Finder',
      fileManager: 'Finder',
      secretStore: 'the keychain',
      secretStoreTitle: 'Keychain',
      modifier: 'Cmd',
    })
  })

  it('are a PC’s on Windows, where the store is DPAPI and not a keychain', () => {
    expect(machineWords('win32')).toEqual({
      machine: 'this PC',
      reveal: 'Show in File Explorer',
      fileManager: 'File Explorer',
      secretStore: 'the encrypted store',
      secretStoreTitle: 'Encrypted store',
      modifier: 'Ctrl',
    })
  })

  it('name no product on Linux, which has no one file manager', () => {
    expect(machineWords('linux')).toEqual({
      machine: 'this computer',
      reveal: 'Show in folder',
      fileManager: 'your file manager',
      secretStore: 'the keyring',
      secretStoreTitle: 'Keyring',
      modifier: 'Ctrl',
    })
    expect(machineWords('freebsd')).toEqual(machineWords('linux'))
  })

  it('go into a catalogue sentence where it wrote their names', () => {
    const text = 'One folder on {machine}; the token goes to {secretStore}.'

    expect(inMachineWords(text, 'darwin')).toBe('One folder on this Mac; the token goes to the keychain.')
    expect(inMachineWords(text, 'win32')).toBe('One folder on this PC; the token goes to the encrypted store.')
    expect(inMachineWords(text, 'linux')).toBe('One folder on this computer; the token goes to the keyring.')
  })
})
