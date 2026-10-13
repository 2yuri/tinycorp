import {
  Activity,
  BookOpen,
  Bug,
  ChartLine,
  CreditCard,
  Database,
  FolderTree,
  GitBranch,
  Globe,
  type LucideIcon,
  PenTool,
  Server,
  SquareKanban,
} from 'lucide-react'
import type { McpPreset, McpPresetIcon } from '../../../../shared/catalogue/mcp-presets'
import { Logo, type MarkProps } from './Logo'
import { logoUrl } from './logo-assets'

/**
 * The mark a preset tile draws when no logo is vendored for it, by the name its catalogue entry
 * gives (T242). It is a table keyed by a union rather than a lookup on a string: a preset that
 * names a mark nobody draws fails to compile, instead of drawing nothing.
 */
const presetMarks: Record<McpPresetIcon, LucideIcon> = {
  'git-branch': GitBranch,
  'square-kanban': SquareKanban,
  bug: Bug,
  'credit-card': CreditCard,
  database: Database,
  'book-open': BookOpen,
  globe: Globe,
  'folder-tree': FolderTree,
  'pen-tool': PenTool,
  activity: Activity,
  chart: ChartLine,
}

/** A preset, drawn: its service's logo where one is vendored, and its generic mark where not. */
export function PresetMark({ preset, size = 16, className }: { preset: McpPreset } & MarkProps) {
  if (preset.logo && logoUrl(preset.logo)) return <Logo name={preset.logo} size={size} className={className} />
  const Mark = presetMarks[preset.icon] ?? Server
  return <Mark size={size} aria-hidden className={className} />
}
