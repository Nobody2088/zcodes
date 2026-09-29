import type { IZCodeSessionService } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useZCodeSessionService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IZCodeSessionService {
  // 两条分支都要调用：workspacePath 从空变成有值时不能改 hook 顺序，
  // 否则项目列表一恢复，渲染就会在 useCallback 依赖上中断，侧栏停在「尚未打开项目」。
  const workspaceServices = useWorkspaceServices(
    workspacePath,
    preferredRemoteSessionId,
    workspaceIdentity,
  );
  const appServices = useServices();
  const services = workspacePath ? workspaceServices : appServices;
  return services.zcodeSessionService;
}
