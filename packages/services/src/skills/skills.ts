import type {
  ZCodeProvider,
  SkillsPromptContext,
  SkillsListResult,
  SkillGitHubInstallResult,
  SkillGroupMutation,
  SkillGroupScope,
  SkillGroupsDocument,
  SkillSourceUpdate,
  SkillTranslateDescriptionsResult,
  SkillTranslateTarget,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ISkillsService {
  list(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: ZCodeProvider;
  }): Promise<SkillsListResult>;
  setEnabled(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: ZCodeProvider;
    scope?: "workspace" | "user" | "plugin";
    skillId: string;
    enabled: boolean;
  }): Promise<void>;
  buildPromptContext(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    provider?: ZCodeProvider;
    prompt: string;
  }): Promise<SkillsPromptContext>;
  /** 将指定 skill 复制到通用目录（.zcode/skills），成功后返回新 skill 的路径。 */
  copyToCommon(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    skillId: string;
  }): Promise<{ newPath: string }>;
  /** 从通用目录中移除指定 skill（仅当 skill 位于 .zcode/skills 时有效）。 */
  removeFromCommon(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    skillId: string;
  }): Promise<void>;
  /**
   * 删除本地技能（仅 workspace/user 作用域；plugin 作用域拒绝）。
   * 删除技能所在目录，仅允许命中 .zcode/skills 或 .agents/skills 根，越界则拒绝。
   */
  deleteSkill(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    skillId: string;
  }): Promise<void>;
  listSkillGroups(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    scope: SkillGroupScope;
  }): Promise<SkillGroupsDocument>;
  mutateSkillGroups(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    scope: SkillGroupScope;
    mutation: SkillGroupMutation;
  }): Promise<SkillGroupsDocument>;
  installSkillsFromGitHub(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    scope: SkillGroupScope;
    url: string;
    groupId: string;
    activationKeywords?: readonly string[];
  }): Promise<SkillGitHubInstallResult>;
  checkSkillSourceUpdates(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    scope: SkillGroupScope;
  }): Promise<SkillSourceUpdate[]>;
  updateSkillSource(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    scope: SkillGroupScope;
    repo: string;
  }): Promise<SkillGitHubInstallResult>;
  /**
   * 将技能英文 description 翻译为中文并写入 descriptionZh。
   * 网络在 Host 侧执行；单条失败不影响整批已成功项。
   */
  translateSkillDescriptions(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    viewScope: SkillGroupScope;
    target: SkillTranslateTarget;
  }): Promise<SkillTranslateDescriptionsResult>;
}

export const ISkillsService = createServiceDescriptor<ISkillsService>(ServiceChannels.Skills);
