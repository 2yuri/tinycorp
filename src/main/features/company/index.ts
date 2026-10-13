/**
 * A Company: making one, opening it, renaming it, moving its folder and forgetting it.
 *
 * The feature's front door. A Company is a folder with a SQLite database in it, so everything here
 * is about that folder: the row it keeps, the key its tickets are coded with, the boss profile every
 * Company shares (T79), the launcher's list and the move that takes the folder somewhere else
 * (decision 45). What a `Company` *is* is in `src/shared/company.ts`.
 */

export type { BossProfileStore } from './boss-profile'
export { createCompanyLogos } from './company-logo'
export { registerCompanyMoveIpc } from './company-move-ipc'
export {
  COMPANY_BOSS_PROFILE_MIGRATION,
  COMPANY_KEY_MIGRATION,
} from './company-profile'
export { COMPANY_VISITS_MIGRATION } from './company-summaries'
export type {
  BossFacade,
  CompanyChanged,
  CompanyFacade,
  CompanyMoveFacade,
  CurrentCompany,
  OwnFace,
} from './facade'
export { registerCompanyIpc } from './ipc'
export { pruneMissingCompanies } from './missing-folders'
export { missingMarksFile } from './missing-marks-file'
export { registerProfileIpc } from './profile-ipc'
export { type CompanyOptions, register as registerCompany } from './wire'
