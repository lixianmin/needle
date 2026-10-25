import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * examples/honox-app 的运行时逻辑一直没有任何测试：`test/` 里只覆盖包与脚本，
 * 示例 app 的登录、版本号这些「宿主会照抄」的代码全靠人肉跑。这里补上最小的一层。
 *
 * 这些模块在 import 期就读配置（viper 按 cwd 找 res/config），所以必须先切到
 * examples/honox-app 再动态 import。
 */
const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "examples", "honox-app");
const ORIGINAL_CWD = process.cwd();

const sha256hex = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

interface Fetchable {
  fetch: (request: Request) => Promise<Response>;
}

let app: Fetchable;

beforeAll(async () => {
  process.chdir(APP);
  process.env.ENV = "dev";
  // 走真实装配：createHonox 装好中间件与 onError，registerApis 挂载全部接口。
  // 只 import login 那个文件的话，RequestError 没有 onError 可接，400 会变成 500。
  const { createHonox } = await import("@needle/honox");
  const { logo } = await import("@needle/logo");
  const { registerApis } = await import(join(APP, "app", "api", "index.ts"));
  const honox = createHonox({ logger: logo, auth: { secret: "unit-test-secret" } });
  registerApis(honox);
  app = honox as unknown as Fetchable;
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
});

function loginRequest(body: unknown): Promise<Response> {
  return app.fetch(
    new Request("http://127.0.0.1/api/v1/login", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("示例登录", () => {
  test("正确的 passcode 换到 token 与 uid", async () => {
    const passcode = sha256hex("needle-demo-saltalice123");
    const response = await loginRequest({ user: "alice", passcode });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { token: string; uid: string };
    expect(payload.uid).toBe("u-alice");
    expect(typeof payload.token).toBe("string");
  });

  test("口令不对与用户不存在都回 401，且响应体一致（不泄露哪个错了）", async () => {
    const wrong = await loginRequest({ user: "alice", passcode: sha256hex("wrong") });
    const missing = await loginRequest({ user: "nobody", passcode: sha256hex("wrong") });

    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await wrong.json()).toEqual(await missing.json());
  });

  test("user 为 __proto__ 不会摸到 Object.prototype", async () => {
    const response = await loginRequest({ user: "__proto__", passcode: sha256hex("x") });
    expect(response.status).toBe(401);
  });

  test("参数类型不对回 400", async () => {
    const response = await loginRequest({ user: "alice", passcode: 1 });
    expect(response.status).toBe(400);
  });
});

describe("示例版本号", () => {
  test("APP_VERSION 有值且不是占位符", async () => {
    const module = await import(join(APP, "app", "version.ts"));
    const version = (module as { APP_VERSION: string }).APP_VERSION;

    // 仓库里跑 git describe 一定拿得到东西；拿不到会退化成 "unknown"。
    expect(version).not.toBe("");
    expect(version).not.toBe("unknown");
  });
});
