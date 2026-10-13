import { FolderGit2 } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { FORGE_ICON, type Forge, type ForgeIcon } from '../../../shared/forges'
import { RepoMarkIcon } from './icons'

/**
 * The mark a repo card draws for its forge, by the name a catalogue entry gives its own (`icon`).
 * This is the whole of what the renderer knows about forges: which drawing goes with which name.
 *
 * A forge that names a mark nobody draws — and a repo whose remote is on no catalogued forge at
 * all — gets the plain git mark. So a new forge renders the day its catalogue entry lands, and the
 * pull request that adds the drawing adds a drawing, not a product name.
 */
export type ForgeMark = ComponentType<{ size?: number } & SVGProps<SVGSVGElement>>

const MARKS: Partial<Record<ForgeIcon, ForgeMark>> = {
  cat: RepoMarkIcon,
  git: FolderGit2,
}

const PLAIN_GIT: ForgeMark = FolderGit2

/** The mark for a forge id, or the plain git mark for a repo on no forge the app knows. */
export function forgeMark(forge: string | null): ForgeMark {
  const named = forge ? (FORGE_ICON as Partial<Record<string, ForgeIcon>>)[forge as Forge] : undefined
  return (named && MARKS[named]) ?? PLAIN_GIT
}
