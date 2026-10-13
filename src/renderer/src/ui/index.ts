/**
 * The kit: every component a screen is built from, the marks, the vendored logos, and the gallery.
 *
 * It names nothing in the renderer but `renderer/sprites`, which is the drawing an `Avatar` carries.
 * `./kit` is the kit's own barrel and stays the kit's business; this is the door the screens use.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { focusOnMount } from './autofocus'
export { useDismiss } from './dismiss'
export { forgeMark } from './forge-mark'
export { Gallery } from './gallery/Gallery'
export { RepoMarkIcon } from './icons'
export {
  ACCENTS,
  type Accent,
  Alert,
  Avatar,
  type AvatarPerson,
  type AvatarSize,
  AvatarStack,
  accentFor,
  Badge,
  Button,
  Card,
  CHOICE_INPUT,
  Checkbox,
  ChipToggleGroup,
  cx,
  DropdownMenu,
  EmptyState,
  IconButton,
  InputGroup,
  initialsOf,
  Kbd,
  MenuDivider,
  MenuItem,
  Progress,
  Radio,
  SEGMENTED_OFF,
  SEGMENTED_ON,
  SEGMENTED_OPTION,
  SEGMENTED_TRACK,
  SETTINGS_CARD,
  SETTINGS_CARD_HEAD,
  SETTINGS_CARD_SUB,
  SETTINGS_CARD_TIGHT,
  SETTINGS_CARD_TITLE,
  SETTINGS_DIVIDER,
  SETTINGS_LINE,
  SETTINGS_LINE_TEXT,
  SETTINGS_LINE_TITLE,
  Search,
  SegmentedControl,
  Select,
  SettingsCard,
  SettingsRow,
  SHELL_BUTTON,
  Tabs,
  Textarea,
  Toast,
  Toggle,
} from './kit'
export { Logo } from './logos/Logo'
export { PresetMark } from './logos/PresetMark'
export { ProviderMark } from './logos/ProviderMark'
