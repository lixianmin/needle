import { Hono } from "hono";
import { apiRoute } from "@needle/honox";

export const meApi = new Hono();

/** uid 由 JWT 中间件写进 context；没带 token 的请求根本到不了这里（门禁 401）。 */
meApi.get("/me", apiRoute((c) => c.json({ uid: c.get("uid") })));
