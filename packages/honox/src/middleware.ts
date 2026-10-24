import type { Logger } from "@needle/logo";
import type { Hono, MiddlewareHandler } from "hono";
import { createAuth, type AuthOptions } from "./auth.js";
import type { HonoxEnv, PublicEntry } from "./types.js";
import type { Snowflake } from "./id.js";

/** 入站请求可以自带 rid：`x-rid` 优先，其次是网关常见的 `x-request-id`。 */
const RID_HEADERS = ["x-rid", "x-request-id"] as const;

/**
 * 接受外部 rid 的形状：只放行不会破坏日志行的字符。
 * 不加这道限制，请求头里塞换行就能伪造日志行（log injection）。
 */
const RID_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;

function resolveRid(
  header: (name: string) => string | undefined,
  ids: Snowflake,
): string {
  for (const name of RID_HEADERS) {
    const value = header(name);
    if (value !== undefined && RID_PATTERN.test(value)) {
      return value;
    }
  }
  // 自己生成时是 13 位 Snowflake 字符串：定长、字典序 = 生成顺序。
  return ids.next();
}

/** 保留 1 位小数：毫秒精度够定位慢请求，也不会让日志字段变成浮点长尾。 */
function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

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
export function createRequestLog(log: Logger): MiddlewareHandler<HonoxEnv> {
  return async function requestLog(c, next) {
    // 直接用传进来的 logger（默认就是全局 logo），不派生子 logger：
    // rid 作为字段带上就够了，多一个对象只会让「日志从哪来」多一层。
    const rid = c.get("rid");
    const path = c.req.path;
    const started = performance.now();
    // 路由注册时记下的位置（没包 apiRoute 就是 undefined，退回自动抓的中间件行）。
    // 进的那一行还在 handler 之前，拿不到；出的那一行在 finally 里读，能拿到。
    function origin(): { site?: string; fn?: string } {
      const where = c.get("api");
      return where === undefined ? {} : { site: where.site, fn: where.fn };
    }

    log.info({ rid, path, ...origin() });
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
          ...origin(),
          // 没 finalize 时 c.res 的 getter 会造一个 200 的空响应，那会把失败记成功。
          status: c.finalized ? c.res.status : 500,
          durationMs: elapsedMs(started),
          uid: c.get("uid"),
        },
      );
    }
  };
}

export interface MiddlewareOptions {
  /** rid 生成器（没带 x-rid 时用）。 */
  ids: Snowflake;
  log: Logger;
  /** 解 token 的密钥、claim、token 来源。 */
  auth: AuthOptions;
  /** 已合并 Shell 路径的白名单；数组引用共享，后续 append 的条目即生效。 */
  public: readonly PublicEntry[];
}

/**
 * 依次装上 rid → 请求日志 → JWT → 门禁，顺序由库固定。
 *
 * 顺序不能交给业务：日志排在门禁前面，401 才有结束行；JWT 排在门禁前面，
 * 门禁才看得到 uid。这两个顺序错一个，症状都很隐蔽（"日志偶尔少一行"）。
 */
export function installMiddleware(app: Hono<HonoxEnv>, options: MiddlewareOptions): void {
  app.use("*", async (c, next) => {
    // 调用方带了就用它的（网关/上游的链路 id 才能串起来），没带才自己生成。
    const rid = resolveRid((name) => c.req.header(name), options.ids);
    c.set("rid", rid);
    await next();
    c.header("x-rid", rid);
  });

  app.use("*", createRequestLog(options.log));
  app.use("*", createAuth(options.auth, options.public));
}
