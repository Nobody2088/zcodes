/**
 * 远端 identity 非空时按远端处理。
 * 这里曾要求 workspaceIdentity 能被当前解析器识别。远端 identity 新增格式或
 * 暂时非规范时，在 remoteSessionId 注入前会被误判为本地 workspace，使 host localPath
 * 直接走零复制交给远端 Agent。identity 只承担隔离语义；任意非空值都必须按远端 fail closed。
 */
export function isRemoteAttachmentTarget(target: {
  remoteSessionId?: string;
  workspaceIdentity?: string;
}): boolean {
  return Boolean(target.remoteSessionId?.trim() || target.workspaceIdentity?.trim());
}

/**
 * 桌面本地路径在非远端工作区零拷贝。
 * 从当前工作区文件服务点选的路径已经在 Agent 可读的文件系统上，远端工作区也不再 stage。
 */
export function shouldZeroCopyAttachmentPath(
  attachment: { localPath?: string; agentFilesystem?: boolean },
  target: { remoteSessionId?: string; workspaceIdentity?: string } | undefined,
): boolean {
  if (!attachment.localPath) return false;
  if (attachment.agentFilesystem) return true;
  return Boolean(target && !isRemoteAttachmentTarget(target));
}
