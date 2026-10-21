import { type TraceId } from "@zcode/shared";
interface ServiceLogSink {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
}
export interface ServiceLogger {
    debug: (traceId: TraceId | undefined, ...args: unknown[]) => void;
    info: (traceId: TraceId | undefined, ...args: unknown[]) => void;
    warn: (traceId: TraceId | undefined, ...args: unknown[]) => void;
    error: (traceId: TraceId | undefined, ...args: unknown[]) => void;
}
export declare function resolveServiceLoggerPid(explicitPid?: number, runtime?: {
    readonly pid?: number;
} | undefined): number;
export declare function createServiceLogger(scope: string, options?: {
    pid?: number;
    sink?: ServiceLogSink;
    isDebugEnabled?: boolean | (() => boolean);
}): ServiceLogger;
export {};
//# sourceMappingURL=serviceLogger.d.ts.map