import type { Logger } from "@needle/logo";
import type { MiddlewareHandler } from "hono";
import type { HonoxEnv } from "./types.js";

/** 保留 1 位小数：毫秒精度够定位慢请求，也不会让日志字段变成浮点长尾。 */
function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

/**
 * 每请求两行：`-->` 进、`<--` 出。
 *
 * 结束行放在 finally 里，并读 `c.res.status`——这样门禁短路、404、抛错
 * 三种情况都有结束行；没有它，日志里会出现"有进无出"，看不出请求是卡住还是失败。
 *
 * 错误有两个来源：`c.error`（Error 抛出被 compose 就地交给 onError）和 catch
 * （非 Error 抛出、onError 自身抛错、自定义 notFound 抛错都会真的穿过来）。
 * 少了 catch 那一路，日志会漏掉错误；而 `c.res` 在没 finalize 时读到的是惰性 200，
 * 会把 500 记成 200。500 的响应体长什么样仍由业务决定，本库不插手。
 */
export function createRequestLog(log: Logger): MiddlewareHandler<HonoxEnv> {
  return async function requestLog(c, next) {
    // 直接用传进来的 logger（默认就是全局 logo），不派生子 logger：
    // rid 作为字段带上就够了，多一个对象只会让「日志从哪来」多一层。
    const rid = c.get("rid");
    const path = c.req.path;
    const started = performance.now();

    log.info({ rid, path }, "-->");
    try {
      await next();
      if (c.error !== undefined) {
        log.error(c.error);
      }
    } catch (error) {
      log.error(error);
      throw error;
    } finally {
      log.info(
        {
          rid,
          path,
          // 没 finalize 时 c.res 的 getter 会造一个 200 的空响应，那会把失败记成功。
          status: c.finalized ? c.res.status : 500,
          durationMs: elapsedMs(started),
          uid: c.get("uid"),
        },
        "<--",
      );
    }
  };
}
