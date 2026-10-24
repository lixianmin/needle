import { Hono } from "hono";
import type { AppEnv } from "../env";

export const healthApi = new Hono<AppEnv>();

/** 探活；在 JWT 白名单里，匿名可访问。 */
healthApi.get("/health", (c) => c.json({ ok: true }));
