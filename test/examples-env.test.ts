import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * 证明 `APP_LOGGER__LARK_URL` 真的被用上了，而不只是「写在文档里」。
 *
 * 链路：Bun 自动加载 .env → honox 的 loadConfig 按 `APP_` 前缀 + `__` 分层覆盖
 * 配置 → `logger.lark_url` → initLog() 用它建飞书 sink → notifyStartup() 发一条。
 * 这条测试在进程里改环境变量再 import 模块，把 fetch 换成桩，断言请求打到了
 * 环境变量给的地址。
 *
 * 必须独立成文件：viper 是模块级单例，本文件在 import 之前设好环境变量；
 * 与 examples-app.test.ts 共用进程会拿到已经缓存的配置。
 */
const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "examples", "honox-app");
const WEBHOOK = "https://unit.test/hook-from-env";
const ORIGINAL_CWD = process.cwd();
const originalFetch = globalThis.fetch;

const calls: string[] = [];

beforeAll(() => {
  process.chdir(APP);
  process.env.ENV = "dev";
  process.env.APP_LOGGER__LARK_URL = WEBHOOK;
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  process.chdir(ORIGINAL_CWD);
  delete process.env.APP_LOGGER__LARK_URL;
});

describe("APP_LOGGER__LARK_URL", () => {
  test("环境变量覆盖配置，飞书 sink 拿到的是它", async () => {
    const { viper } = await import(join(APP, "app", "viper.ts"));
    expect(viper.getString("logger.lark_url")).toBe(WEBHOOK);

    const { initLog } = await import(join(APP, "app", "logo.ts"));
    const { notifyStartup } = initLog();
    notifyStartup();
    // notify 是 fire-and-forget，等一个宏任务让它把 fetch 发出去。
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toContain(WEBHOOK);
  });

});
