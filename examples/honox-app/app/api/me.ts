import { api } from "@needle/honox";

/** uid 由 JWT 中间件写进 context；没带 token 的请求根本到不了这里（门禁 401）。 */
export const meApi = api("/me", (c) => c.json({ uid: c.get("uid") }));
