import type { Logger } from "@needle/logo";
import type { Hono, MiddlewareHandler } from "hono";
import { type AuthOptions } from "./auth.js";
import type { HonoxEnv, PublicEntry } from "./types.js";
import type { Snowflake } from "./id.js";
/**
 * 每请求两行：进的那行只有 rid / path，出的一行额外带 status / durationMs / uid。
 *（曾经用 `-->` / `<--` 当 msg，后来去掉：字段本身已经说明方向，箭头是噪音。）
 *
 * 结束行放在 finally 里，并读 `c.res.status`——这样门禁短路、404、抛错
 * 三种情况都有结束行；没有它，日志里会出现"有进无出"，看不出请求是卡住还是失败。
 *
 * 错误有两个来源：`c.error`（Error 抛出被 compose 就地交给 onError）和 catch
 * （非 Error 抛出、onError 自身抛错、自定义 notFound 抛错都会真的穿过来）。
 * 少了 catch 那一路，日志会漏掉错误；而 `c.res` 在没 finalize 时读到的是惰性 200，
 * 会把 500 记成 200。500 的响应体长什么样仍由业务决定，本库不插手。
 *
 * 导出它是为了单独测日志行为；业务侧应该只调 installMiddleware。
 */
export declare function createRequestLog(log: Logger): MiddlewareHandler<HonoxEnv>;
export interface MiddlewareOptions {
    /** rid 生成器（没带 x-rid 时用）。 */
    ids: Snowflake;
    log: Logger;
    /** 解 token 的密钥、claim、token 来源。 */
    auth: AuthOptions;
    /** 已合并 Shell 路径的完整白名单。 */
    public: readonly PublicEntry[];
}
/**
 * 依次装上 rid → 请求日志 → JWT → 门禁，顺序由库固定。
 *
 * 顺序不能交给业务：日志排在门禁前面，401 才有结束行；JWT 排在门禁前面，
 * 门禁才看得到 uid。这两个顺序错一个，症状都很隐蔽（"日志偶尔少一行"）。
 */
export declare function installMiddleware(app: Hono<HonoxEnv>, options: MiddlewareOptions): void;
//# sourceMappingURL=middleware.d.ts.map