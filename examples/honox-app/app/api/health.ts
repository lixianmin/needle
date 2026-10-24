import { api } from "@needle/honox";

/** 探活；在 JWT 白名单里，匿名可访问。 */
export const healthApi = api("/health", (c) => c.json({ ok: true }));
