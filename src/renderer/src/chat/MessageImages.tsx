import { useEffect, useState } from 'react'
import { fileName, isImageFile, type OpenedFile } from '../../../shared/files/files'
import type { PathLink } from '../../../shared/files/path-links'
import { usePathLinks } from '../paths'
import { ImagePreview } from './Lightbox'
import '../ui/tailwind.css'

/**
 * The images an Employee only wrote the path of (T236). A path in a message is already a link
 * (T114); when it is a picture the app can draw, the message draws it too, under the text, with
 * the same thumbnail and the same lightbox an attachment gets.
 *
 * It asks for nothing the message did not already ask for: the links are the answer `Written` has
 * cached for this text, so the row costs one read per image and nothing at all for a message with
 * no picture in it.
 */
export function MessageImages({ text }: { text: string }) {
  const images = imageLinks(usePathLinks(text))
  if (images.length === 0) return null
  return (
    <div className="flex flex-wrap items-start gap-8">
      {images.map((link) => (
        <PathImage key={link.full} link={link} />
      ))}
    </div>
  )
}

/** How many pictures one message draws: a screenshot or two, never a contact sheet. */
export const MOST_IMAGES = 4

/**
 * The image paths of a message, at most {@link MOST_IMAGES} of them and each one only once: the
 * same file named twice in a sentence is one picture, not two.
 */
export function imageLinks(links: readonly PathLink[]): PathLink[] {
  const seen = new Set<string>()
  const images: PathLink[] = []
  for (const link of links) {
    if (!isImageFile(link.path) || seen.has(link.full)) continue
    seen.add(link.full)
    images.push(link)
    if (images.length === MOST_IMAGES) break
  }
  return images
}

function PathImage({ link }: { link: PathLink }) {
  const file = useFileAt(link)
  if (!file?.dataUrl) return null
  return <ImagePreview image={{ name: fileName(link.path), dataUrl: file.dataUrl, size: file.size, path: link.full }} />
}

/** What was read for each path, kept while the Company is open: scrolling reads nothing twice. */
const read = new Map<string, Promise<OpenedFile | null>>()
/** Installed once: another Company has other places, so nothing read here holds there. */
let _forgetting: (() => void) | null = null

/**
 * One image read from the main process, once per absolute path. A file of a place is read through
 * the place, and one from anywhere else through the path reader the Files view already uses (T121)
 * — the renderer never names a path the main process has not resolved for it.
 */
function useFileAt(link: PathLink): OpenedFile | null {
  const full = link.full
  const [file, setFile] = useState<OpenedFile | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the absolute path is what identifies the read; the link object around it is rebuilt on every draw.
  useEffect(() => {
    const api = window.tinyCorp
    if (!api) return
    _forgetting ??= api.company?.onChanged(() => read.clear()) ?? null
    let pending = read.get(full)
    if (!pending) {
      const target = link.target
      const asked = target.kind === 'place' ? api.files.open(target.placeId, target.path) : api.paths.open(target.path)
      pending = asked.then((result) => (result.ok ? result.value : null))
      read.set(full, pending)
    }
    let live = true
    void pending.then((value) => {
      if (live) setFile(value)
    })
    return () => {
      live = false
    }
  }, [full])
  return file
}
