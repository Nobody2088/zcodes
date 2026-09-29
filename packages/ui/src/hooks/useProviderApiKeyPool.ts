import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IProviderApiKeyPoolService,
  ProviderApiKeyPoolAddResult,
  ProviderApiKeyPoolView,
} from "@zcode/services";
import { logger } from "@/logger.js";
import { useServices } from "@/hooks/useServices.js";

export type ProviderApiKeyPoolStatus = "loading" | "ready" | "error";

export function useProviderApiKeyPool(providerId: string) {
  const { providerApiKeyPoolService } = useServices();
  const [view, setView] = useState<ProviderApiKeyPoolView | null>(null);
  const [status, setStatus] = useState<ProviderApiKeyPoolStatus>("loading");
  const [mutating, setMutating] = useState(false);
  const serviceRef = useRef(providerApiKeyPoolService);
  serviceRef.current = providerApiKeyPoolService;

  const applyView = useCallback((next: ProviderApiKeyPoolView) => {
    setView((current) => {
      if (current && current.providerId === next.providerId && current.revision > next.revision) {
        return current;
      }
      return next;
    });
    setStatus("ready");
  }, []);

  useEffect(() => {
    const service = providerApiKeyPoolService;
    if (!service) {
      setStatus("error");
      setView(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const subscription = service.onDidChange((next) => {
      if (!cancelled && next.providerId === providerId) applyView(next);
    });
    void service
      .getView(providerId)
      .then((next) => {
        if (!cancelled) applyView(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.warn("[useProviderApiKeyPool] 加载密钥池失败", error);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      subscription.dispose();
    };
  }, [applyView, providerApiKeyPoolService, providerId]);

  const run = useCallback(async <T>(work: (service: IProviderApiKeyPoolService) => Promise<T>) => {
    const service = serviceRef.current;
    if (!service) throw new Error("API Key 池服务不可用");
    setMutating(true);
    try {
      return await work(service);
    } finally {
      setMutating(false);
    }
  }, []);

  const addKeys = useCallback(
    (text: string) => run((service) => service.addKeys(providerId, text)),
    [providerId, run],
  );
  const deleteKeys = useCallback(
    (keyIds: readonly string[]) => run((service) => service.deleteKeys(providerId, keyIds)),
    [providerId, run],
  );
  const probeKeys = useCallback(
    (keyIds?: readonly string[]) => run((service) => service.probeKeys(providerId, keyIds)),
    [providerId, run],
  );
  const revealKey = useCallback(
    (keyId: string) => {
      const service = serviceRef.current;
      if (!service) return Promise.reject(new Error("API Key 池服务不可用"));
      return service.revealKey(providerId, keyId);
    },
    [providerId],
  );
  const selectActiveKey = useCallback(
    (keyId: string) => run((service) => service.selectActiveKey(providerId, keyId)),
    [providerId, run],
  );
  const reload = useCallback(() => {
    const service = serviceRef.current;
    if (!service) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    void service
      .getView(providerId)
      .then(applyView)
      .catch((error: unknown) => {
        logger.warn("[useProviderApiKeyPool] 重试加载密钥池失败", error);
        setStatus("error");
      });
  }, [applyView, providerId]);

  return {
    view,
    status,
    mutating,
    addKeys,
    deleteKeys,
    probeKeys,
    revealKey,
    selectActiveKey,
    reload,
  };
}

export type { ProviderApiKeyPoolAddResult };
