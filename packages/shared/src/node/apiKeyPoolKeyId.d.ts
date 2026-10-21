/**
 * 号池 keyId。Host 分组与子代理换钥必须用同一算法：密钥 UTF-8 SHA-256 的 hex 前 16 位。
 * 这不是明文，日志可以记它，但不能把它当成可逆的密钥。
 */
export declare function apiKeyPoolKeyId(secret: string): string;
//# sourceMappingURL=apiKeyPoolKeyId.d.ts.map