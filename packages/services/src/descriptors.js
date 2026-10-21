/**
 * ServiceDescriptor — 以频道名称标识服务并通过泛型关联类型。
 *
 * 利用 TypeScript 允许同名 interface + const（类型和值在不同命名空间）的特性，
 * 让调用方使用同一个名称引用服务类型和运行时描述符。
 */
export function createServiceDescriptor(channelName) {
    return { channelName };
}
