/**
 * HonoX 的 createRoute() 用 hono 的默认 Env，拿不到 createHonox 的泛型；
 * 用 ContextVariableMap 声明路由里能读到的变量，typescript 才能在 c.get("uid") 上给出类型。
 */
declare module "hono" {
  interface ContextVariableMap {
    uid: string | null;
    reqId: string;
    config: Record<string, unknown>;
  }
}
