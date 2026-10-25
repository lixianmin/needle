import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * 证明 `APP_LOGGER__LARK_URL` 真的被用上了，而不只是「写在文档里」。
 *
 * 链路：Bun 自动加载 .env → honox 的 loadConfig 按 `APP_` 前缀 + `__` 分层覆盖
 * 配置 → `logger.lark_url` → initLog() 用它建飞书 sink → notifyStartup() 发一条。
 *
 * 用子进程而不是直接 import：viper 与 app/logo.ts 都是模块级单例，别的测试先
 * import 过就带着旧配置缓存，断言顺序一换就红（第一版就是这么翻的）。子进程里
 * env 与模块缓存都是干净的一份。
 */
const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "examples", "honox-app");
const WEBHOOK = "https://unit.test/hook-from-env";

const PROBE = `
process.env.APP_LOGGER__LARK_URL = ${JSON.stringify(WEBHOOK)};
globalThis.fetch = async (input) => {
  console.log("FETCH", String(input));
  return new Response(JSON.stringify({ code: 0 }), { status: 200 });
};

const { viper } = await import("./app/viper.ts");
console.log("CONFIG", viper.getString("logger.lark_url"));

const { initLog } = await import("./app/logo.ts");
initLog().notifyStartup();
await new Promise((resolve) => setTimeout(resolve, 50));
`;

describe("APP_LOGGER__LARK_URL", () => {
  test("环境变量覆盖配置，飞书 sink 真的把它发出去", () => {
    const result = Bun.spawnSync(["bun", "-e", PROBE], {
      cwd: APP,
      env: { ...process.env, ENV: "dev" },
    });

    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    // 配置层：环境变量盖掉了 app_dev.yml 里的空串。
    expect(stdout).toContain(`CONFIG ${WEBHOOK}`);
    // sink 层：initLog 建了飞书 sink，notifyStartup 打到了同一个地址。
    expect(stdout).toContain(`FETCH ${WEBHOOK}`);
  });
});
