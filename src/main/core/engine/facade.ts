import type { ActivityFacade } from '../../features/activity'
import type { ApprovalsFacade } from '../../features/approvals'
import type { BoardFacade } from '../../features/board'
import type { McpFacade, SkillsFacade } from '../../features/catalogue'
import type { ChatFacade, VoiceFacade } from '../../features/chat'
import type { CodeFacade } from '../../features/code'
import type { BossFacade, CompanyFacade, CompanyMoveFacade } from '../../features/company'
import type { EnvironmentsFacade } from '../../features/environments'
import type { FilesFacade, LanguageFacade, PathLinksFacade } from '../../features/files'
import type { HiringFacade } from '../../features/hiring'
import type { AnswererFacade, InboxFacade } from '../../features/inbox'
import type { CompanyMemoryFacade, NotesFacade } from '../../features/memory'
import type { NotificationsFacade } from '../../features/notifications'
import type { OfficeFacade } from '../../features/office'
import type { OnboardingFacade } from '../../features/onboarding'
import type { DigestFacade, PlanningFacade } from '../../features/planning'
import type { ReposFacade } from '../../features/repos'
import type { RestorePointsFacade } from '../../features/restore-points'
import type { ReviewFacade } from '../../features/review'
import type { RtkFacade } from '../../features/rtk'
import type { SandboxFacade } from '../../features/sandbox'
import type {
  BuildStyleFacade,
  CapacityFacade,
  CavemanFacade,
  SessionsFacade,
  SpawnSettingsFacade,
  TerminalsFacade,
} from '../../features/sessions'
import type { StaffFacade } from '../../features/staff'
import type { TestingFacade } from '../../features/testing'
import type { UsageFacade } from '../../features/usage'
import type { McpCaller } from './mcp-caller'

export type { McpCaller }

/**
 * The Company engine: the only holder of domain state in the app, and the composition of every
 * feature's face.
 *
 * There is no list of members here on purpose (T188). Each feature declares what it puts on the
 * engine — `BoardFacade`, `ChatFacade`, `ReviewFacade` — and its own IPC module names that one
 * rather than this, so what a screen can reach never widens because another feature grew a member.
 * What is left below is the engine's own: opening and closing Companies is a lifecycle no feature
 * owns, and `mcpCaller` is the other process's way in.
 *
 * The renderer (over IPC) and Employees (over MCP) are thin clients of it.
 */
export interface CompanyEngine
  extends ActivityFacade,
    AnswererFacade,
    ApprovalsFacade,
    BoardFacade,
    BossFacade,
    BuildStyleFacade,
    CapacityFacade,
    CavemanFacade,
    ChatFacade,
    CodeFacade,
    CompanyFacade,
    CompanyMemoryFacade,
    CompanyMoveFacade,
    DigestFacade,
    EnvironmentsFacade,
    FilesFacade,
    HiringFacade,
    InboxFacade,
    LanguageFacade,
    McpFacade,
    NotesFacade,
    NotificationsFacade,
    OfficeFacade,
    OnboardingFacade,
    PathLinksFacade,
    PlanningFacade,
    ReposFacade,
    RestorePointsFacade,
    ReviewFacade,
    RtkFacade,
    SandboxFacade,
    SessionsFacade,
    SkillsFacade,
    SpawnSettingsFacade,
    StaffFacade,
    TerminalsFacade,
    TestingFacade,
    UsageFacade,
    VoiceFacade {
  /** Who is calling the Company MCP server of `companyId` with `token`, or null for a stranger. */
  mcpCaller(companyId: string, token: string): McpCaller | null
  /** The app is quitting: every Session, every child process and every Company let go. */
  close(): void
}
