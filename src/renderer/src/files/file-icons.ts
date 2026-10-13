/** The icon a file is drawn with — the kind it will open as — shared by the tree and the tabs. */

import type { LucideIcon } from 'lucide-react'
import { Braces, FileCode2, FileText, Image } from 'lucide-react'
import { extensionOf, IMAGE_EXTENSIONS, LANGUAGE_BY_EXTENSION } from '../../../shared/files/files'

export function fileIconFor(path: string): LucideIcon {
  const extension = extensionOf(path)
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return Image
  if (extension === 'json') return Braces
  return LANGUAGE_BY_EXTENSION[extension] ? FileCode2 : FileText
}
