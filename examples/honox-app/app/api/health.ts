import { createApi } from "@needle/honox";

export const healthApi = createApi();

/** 探活；在 JWT 白名单里，匿名可访问。 */
healthApi.get("/health", (c) => c.json({ ok: true }));
