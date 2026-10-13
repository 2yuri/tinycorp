import { useEffect, useState } from 'react'
import { sliceSheet } from './sprite-sheet'

/** Where the office assets are served from; the same folder `Office.tsx` loads its textures from. */
const ASSET_BASE = './office/'
/** The column of `characters.png` that stands facing the viewer — what a character looks like. */
const IDLE_COLUMN = 0

/** One character sheet's standing frame, chroma-keyed and trimmed to the drawing. */
export interface CharacterLook {
  /** A PNG data URL, ready for an `<img>`; empty for a sheet that draws nothing. */
  src: string
  width: number
  height: number
}

let looks: Promise<CharacterLook[]> | null = null

/**
 * The standing frame of every sheet in `office/characters.png`, keyed and trimmed exactly as the
 * office does it (`chroma-key.ts` through `sprite-sheet.ts`), so a character previewed outside the
 * office is the one who walks into it. Decoded once per window and shared.
 */
export function loadCharacterLooks(base = ASSET_BASE): Promise<CharacterLook[]> {
  looks ??= cutLooks(base).catch((error) => {
    // A failed decode must not poison the cache: the next caller tries again.
    looks = null
    throw error
  })
  return looks
}

async function cutLooks(base: string): Promise<CharacterLook[]> {
  const sheet = await decode(`${base}characters.png`)
  const { width, height } = sheet
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(sheet, 0, 0)
  const pixels = context.getImageData(0, 0, width, height)
  // Keys the green out in place, so the cut cells come out transparent.
  const cells = sliceSheet(pixels.data, width, height)
  context.putImageData(pixels, 0, 0)

  return cells.map((row) => {
    const box = row[IDLE_COLUMN]
    if (!box) return { src: '', width: 0, height: 0 }
    const cut = document.createElement('canvas')
    cut.width = box.w
    cut.height = box.h
    cut.getContext('2d')!.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
    return { src: cut.toDataURL('image/png'), width: box.w, height: box.h }
  })
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not read ${src}`))
    image.src = src
  })
}

/** The character looks once they are decoded, or null while they are not. Never throws at the caller. */
export function useCharacterLooks(): CharacterLook[] | null {
  const [decoded, setDecoded] = useState<CharacterLook[] | null>(null)
  useEffect(() => {
    let live = true
    void loadCharacterLooks().then(
      (all) => live && setDecoded(all),
      () => {},
    )
    return () => {
      live = false
    }
  }, [])
  return decoded
}
