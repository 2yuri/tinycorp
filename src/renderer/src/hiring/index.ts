/**
 * Hiring: the modal, the fields and the frame it is made of, and the one way to open it from
 * anywhere.
 *
 * The class lists are part of the front door since T210f. The two Employee modals are one anatomy
 * over different data, and `hire-modal.css` was one stylesheet both of them imported; these are that
 * stylesheet, as the lists the frames measure.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { HeadcountSetting } from './HeadcountSetting'
export { HireEmployeeModal } from './HireEmployeeModal'
export { LookField } from './LookField'
export {
  AreasField,
  CANCEL,
  CLOSE,
  DIVIDER,
  ERROR,
  FIELD,
  FIELDS,
  FOOTER,
  FORM,
  GrantChips,
  HEADER,
  HEADER_TEXT,
  HELP,
  IDENTITY,
  LABEL,
  LABEL_ROW,
  MODAL,
  NameInput,
  NOTE,
  NOTE_TEXT,
  OVERLAY,
  PermissionField,
  RepoAccess,
  RoleGrid,
  roleIcon,
  ShutOutWarning,
  SUBMIT,
  SUBTITLE,
  skillChips,
  TEXTAREA,
  TITLE,
} from './modal-fields'
export { onOpenHire, openHire } from './open-hire'
