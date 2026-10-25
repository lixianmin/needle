import { logo, type Logger } from "@needle/logo";
import { ResponseX } from "@needle/shell";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HonoxEnv } from "./types.js";

/**
 * 请求绑定的日志出口。
 *
 * 四个级别方法返回 trace 自己，所以可以一行同时"建 trace + 打第一条日志"：
 *
 * ```ts
 * const trace = traceOf(ctx).info(request);
 * ```
 *
 * `json` 与四个失败出口（`badRequest` / `notFound` / `internalError` /
 * `unavailable`）是响应出口：记的那一行就是它返回的响应（`{status, result}`），
 * 只有一个参数。业务想额外记什么，用 `.info(...)` 显式加——链式天然支持。
 *
 * 失败出口把状态码、code 一起锁死（与 `ResponseX` 同一套契约），业务只给
 * message：不用每个 handler 都自己拼 `{code, message}` 再手写状态码。
 */
export interface Trace {
  debug(...args: unknown[]): Trace;
  info(...args: unknown[]): Trace;
  warn(...args: unknown[]): Trace;
  error(...args: unknown[]): Trace;
  /**
   * 记一条 info（`{status, result}`）并返回 JSON 响应。
   * 不想记这一条就用 `ctx.json`——日志和响应在这里被绑在一起，是为了让
   * "每个出口都留一行"成为默认动作，而不是要剥夺选择。
   */
  json(body: unknown, status?: ContentfulStatusCode): Response;
  /** 记一条 info（`{status: 400, result: {code, message}}`）并返回 400。 */
  badRequest(message?: string): Response;
  /** 记一条 info（`{status: 404, result: {code, message}}`）并返回 404。 */
  notFound(message?: string): Response;
  /** 记一条 info（`{status: 500, result: {code, message}}`）并返回 500。 */
  internalError(message?: string): Response;
  /** 记一条 info（`{status: 503, result: {code, message}}`）并返回 503。 */
  unavailable(message?: string): Response;
}

const DEFAULT_BAD_REQUEST = "请求不合法";
const DEFAULT_NOT_FOUND = "接口不存在";
const DEFAULT_INTERNAL_ERROR = "服务内部错误";
const DEFAULT_UNAVAILABLE = "服务暂不可用";

/**
 * `Trace` 的原型方法实现：每个请求只分配一个实例，九个方法挂在原型上共享。
 *
 * 早先是每次创建时现挂九个闭包。改成原型方法实测（Bun 1.4.4，创建 + 打一条
 * info）65ns → 24ns，常驻 680B → 88B / trace：闭包版的九个箭头函数加它们共享的
 * context 都是真实堆分配，V8/JSC 不会为这种形状做逃逸分析。绝对值不大（trace
 * 只占一个进程内请求的 ~3%，真实请求还要加网络与 IO），但没有理由白送垃圾。
 *
 * 代价是方法依赖 `this`：`trace.info()`、`trace["json"]()`、`trace.info().json()`
 * 都正常（成员调用表达式的 `this` 永远是接收者），但把方法摘下来单独调用
 * （`const { json } = trace; json(...)`）会抛 TypeError。要传给别处就传 trace 本身。
 */
class RequestTrace implements Trace {
  /** 响应出口要用它造响应。 */
  private readonly ctx: Context<HonoxEnv>;
  private readonly write: Logger;
  /** 绑定字段。生成时从 ctx 取干净，之后打日志不再碰 ctx。 */
  private readonly base: Record<string, unknown>;

  constructor(ctx: Context<HonoxEnv>, write: Logger) {
    this.ctx = ctx;
    this.write = write;
    const where = ctx.get("api");
    this.base = {
      rid: ctx.get("rid"),
      uid: ctx.get("uid"),
      path: ctx.req.path,
      ...(where === undefined ? {} : { module: where.module }),
    };
  }

  debug(...args: unknown[]): Trace {
    this.write.debug(this.base, ...args);
    return this;
  }

  info(...args: unknown[]): Trace {
    this.write.info(this.base, ...args);
    return this;
  }

  warn(...args: unknown[]): Trace {
    this.write.warn(this.base, ...args);
    return this;
  }

  error(...args: unknown[]): Trace {
    this.write.error(this.base, ...args);
    return this;
  }

  json(body: unknown, status?: ContentfulStatusCode): Response {
    this.info({ status: status ?? 200, result: body });
    return this.ctx.json(body as never, status);
  }

  badRequest(message = DEFAULT_BAD_REQUEST): Response {
    // 与 json 同一条规则：记的就是返回的响应体。
    this.info({ status: 400, result: { code: "bad_request", message } });
    return ResponseX.badRequest(message);
  }

  notFound(message = DEFAULT_NOT_FOUND): Response {
    // 与 json 同一条规则：记的就是返回的响应体。
    this.info({ status: 404, result: { code: "not_found", message } });
    return ResponseX.notFound(message);
  }

  internalError(message = DEFAULT_INTERNAL_ERROR): Response {
    // 与 json 同一条规则：记的就是返回的响应体。
    this.info({ status: 500, result: { code: "internal_error", message } });
    return ResponseX.internalError(message);
  }

  unavailable(message = DEFAULT_UNAVAILABLE): Response {
    // 与 json 同一条规则：记的就是返回的响应体。
    this.info({ status: 503, result: { code: "service_unavailable", message } });
    return ResponseX.unavailable(message);
  }
}

/**
 * 把当前请求的上下文绑成一个 trace 对象。
 *
 * 三级来源：调用方显式传的 > 本次请求装配的 logger（`installMiddleware` 从
 * `createHonox({ logger })` 拿到的那个，写进 context）> 全局 logo。
 *
 * 中间那一级是「配置不进 request context」的唯一例外。少了它，业务侧
 * `traceOf(ctx)` 就只会落回全局 logo——`createHonox({ logger })` 配的实例被
 * 悄悄绕过，日志跑到另一个 sink，症状只在「配了 logger 却看不见业务日志」时
 * 才暴露，而那时候错过的日志已经没了。
 *
 * 为什么不挂在 `Context` 上：`ctx.error` 已经是 Hono 的公开字段（compose 每次
 * Error 抛出都会写它），挂同名方法会在类型层冲突、运行期被覆盖。
 *
 * 字段顺序：绑定字段在前、业务参数在后，同名时业务覆盖（与 logo 的「后写的赢」一致）。
 *
 * 不绑 `method`：`path` 已经说明是哪个接口；同一路径上的 GET/POST 由 `module` 与
 * 业务参数区分，实测下来那半个字段只是让每行更长。
 */
export function traceOf(ctx: Context<HonoxEnv>, logger?: Logger): Trace {
  return new RequestTrace(ctx, logger ?? ctx.get("logger") ?? logo);
}
