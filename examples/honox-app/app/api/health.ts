import { Hono } from "hono";
import { apiRoute } from "@needle/honox";

export const healthApi = new Hono();

/** 探活；在 JWT 白名单里，匿名可访问。 */
healthApi.get("/health", apiRoute((c) => c.json({ ok: true })));
