import { useEffect, useRef } from "react";
import type { ModelSelection } from "@zcode/shared";
import { modelSelectionSchema } from "@zcode/shared";
import { submissionModeSchema, type SubmissionMode } from "@zcode/shared/zcode-protocol-v4";
import { useOptionalServices } from "@/hooks/useServices.js";
import type { V4ComposerDraft } from "@/v4/composer/composerDraftStore.js";

export const SHARED_COMPOSER_CONFIG_CHANNEL = "composer:shared-config";

interface SharedComposerConfig {
  workspaceKey: string;
  scopeId: string;
  mode: SubmissionMode | null;
  planEnabled: boolean;
  modelSelection: ModelSelection | null;
}

function sameModelSelection(
  left: ModelSelection | null | undefined,
  right: ModelSelection | null | undefined,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.options?.reasoningLevel === right.options?.reasoningLevel
  );
}

function readSharedComposerConfig(payload: unknown): SharedComposerConfig | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    workspaceKey?: unknown;
    scopeId?: unknown;
    mode?: unknown;
    planEnabled?: unknown;
    modelSelection?: unknown;
  };
  if (typeof record.workspaceKey !== "string" || typeof record.scopeId !== "string") return null;
  const mode = submissionModeSchema.safeParse(record.mode);
  const model =
    record.modelSelection == null
      ? null
      : modelSelectionSchema.safeParse(record.modelSelection);
  if (record.modelSelection != null && !model?.success) return null;
  return {
    workspaceKey: record.workspaceKey,
    scopeId: record.scopeId,
    mode: mode.success ? mode.data : null,
    planEnabled: record.planEnabled === true,
    modelSelection: model && model.success ? model.data : null,
  };
}

/**
 * 桌面和手机各有一份 localStorage 草稿。模型、推理档和模式改选后广播给同一 Host 的另一端。
 * 挂载时不广播，避免后打开的一端把旧选择盖回去。正文不在这份广播里。
 */
export function useSharedComposerConfigSync(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  scopeId: string;
  draft: V4ComposerDraft;
  updateComposerDraft: (update: (current: V4ComposerDraft) => V4ComposerDraft) => void;
}): void {
  const services = useOptionalServices();
  const lastSentRef = useRef("");
  const mountedRef = useRef(false);
  const workspaceKey = params.workspaceIdentity?.trim() || params.workspacePath;
  const payload: SharedComposerConfig = {
    workspaceKey,
    scopeId: params.scopeId,
    mode: params.draft.mode ?? null,
    planEnabled: params.draft.planEnabled === true,
    modelSelection: params.draft.modelSelection ?? null,
  };
  const encoded = JSON.stringify(payload);

  useEffect(() => {
    const broadcast = services?.broadcastService;
    if (!broadcast) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      lastSentRef.current = encoded;
      return;
    }
    if (encoded === lastSentRef.current) return;
    lastSentRef.current = encoded;
    void broadcast.send({ channel: SHARED_COMPOSER_CONFIG_CHANNEL, payload });
  }, [encoded, services]);

  useEffect(() => {
    const broadcast = services?.broadcastService;
    if (!broadcast) return;
    const subscription = broadcast.onMessage((message) => {
      if (message.channel !== SHARED_COMPOSER_CONFIG_CHANNEL) return;
      const incoming = readSharedComposerConfig(message.payload);
      if (!incoming || incoming.workspaceKey !== workspaceKey || incoming.scopeId !== params.scopeId) {
        return;
      }
      const incomingEncoded = JSON.stringify(incoming);
      if (incomingEncoded === lastSentRef.current) return;
      lastSentRef.current = incomingEncoded;
      params.updateComposerDraft((current) => {
        const sameMode = (current.mode ?? null) === incoming.mode;
        const samePlan = (current.planEnabled === true) === incoming.planEnabled;
        if (sameMode && samePlan && sameModelSelection(current.modelSelection, incoming.modelSelection)) {
          return current;
        }
        return {
          ...current,
          ...(incoming.mode ? { mode: incoming.mode } : {}),
          planEnabled: incoming.planEnabled,
          ...(incoming.modelSelection ? { modelSelection: incoming.modelSelection } : {}),
          updatedAt: Date.now(),
        };
      });
    });
    return () => subscription.dispose();
  }, [params.scopeId, params.updateComposerDraft, services, workspaceKey]);
}
