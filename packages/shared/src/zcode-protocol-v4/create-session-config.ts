import { z } from "zod";
import { dialogueModeSchema } from "../composer-role.js";
import { modelSelectionSchema } from "../model-selection.js";

export const createSessionRequestedConfigSchema = z.object({
  modelSelection: modelSelectionSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  thought: z.string().optional(),
  followupMode: z.enum(["queue", "guide"]).optional(),
  // Bugfix：createSession.config 表达“请求覆盖字段”，不能复用 snapshot 的
  // sessionConfigStateSchema.partial()；snapshot 为兼容旧快照给 mode 设了 default("build")，
  // 会把“没传 mode”误变成“请求切回 build”，覆盖 workspace 默认 yolo。
  mode: z.string().optional(),
  planEnabled: z.boolean().optional(),
  // 本 fork：作曲栏角色与对话模式随 createSession 一次性下发。
  roleId: z.string().min(1).optional(),
  dialogueMode: dialogueModeSchema.optional(),
});
