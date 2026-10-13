import { Assets, Rectangle, Texture } from 'pixi.js'
import { type Box, type SheetStyle, sliceSheet } from '../sprites'

/**
 * One green-chroma sheet, sliced and keyed: a texture cut to each cell's drawing, and the box that
 * texture came from, so a cell can be measured as well as drawn. Rows first, as the sheet reads.
 */
export interface Sheet {
  /** The sheet's pixels with the green taken out, for whatever has to be measured off the art. */
  pixels: Uint8ClampedArray
  width: number
  height: number
  boxes: (Box | null)[][]
  /** `Texture.EMPTY` where the cell has nothing drawn in it. */
  textures: Texture[][]
}

/** Loads a sheet, slices it into its cells and keys the green out of the one texture they share. */
export async function loadSheet(url: string, style: SheetStyle = {}): Promise<Sheet> {
  const loaded = await Assets.load<Texture>(url)
  const { width, height } = loaded.source
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(loaded.source.resource as CanvasImageSource, 0, 0)
  const image = context.getImageData(0, 0, width, height)
  const boxes = sliceSheet(image.data, width, height, style)
  context.putImageData(image, 0, 0)
  const source = Texture.from(canvas).source
  source.scaleMode = 'nearest'
  const textures = boxes.map((row) =>
    row.map((box) => (box ? new Texture({ source, frame: new Rectangle(box.x, box.y, box.w, box.h) }) : Texture.EMPTY)),
  )
  return { pixels: image.data, width, height, boxes, textures }
}
