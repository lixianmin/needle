import { createHonox } from "@needle/honox";
import { loadSheets } from "@needle/honox/excel";
import { loadConfig } from "@needle/honox/node";
import { ResponseX } from "@needle/shell";
import { apcSheet, botSheet } from "./lib/templates";

// 用 type 而不是 interface：createHonox 的泛型约束是 Record<string, unknown>，
// interface 没有隐式索引签名，TS 7 会直接报 TS2344。
type AppConfig = {
  auth: { secret: string };
  server?: { port?: number };
};

const config = loadConfig<AppConfig>({
  required: ["auth.secret"],
});

// 生产环境必须覆盖仓库里的 dev 密钥，否则任何人都能伪造 token。
//
// 先取到局部变量再比较：`bun build` 会把 `process.env.NODE_ENV` 当编译期常量折叠掉，
// 直接写 `process.env.NODE_ENV === "production"` 打出来的 dist 里永远是假，
// 这道门会在镜像里静默失效（实测）。
const env = process.env;
if (env.NODE_ENV === "production" && (env.APP_AUTH__SECRET ?? "") === "") {
  throw new Error("生产环境必须用 APP_AUTH__SECRET 提供 JWT 密钥（不能沿用 app_dev.yml 里的 dev 值）");
}

// /shell 在 JWT 白名单里，对匿名网络可达；口令是它唯一的门，不能有默认值。
const shellPassword = env.SHELL_PASSWORD;
if (shellPassword === undefined || shellPassword === "") {
  throw new Error("SHELL_PASSWORD 未设置：Shell 面板需要一个口令");
}

// hucre 只能异步读：预载一次，之后 getter 同步、零 IO。
await loadSheets([botSheet, apcSheet]);

// createHonox 返回现成的 Hono 实例，路由直接挂在它上面，类型从实例上就带着
// （env 里的 uid / reqId / config 因此不需要手写 ContextVariableMap）。
const app = createHonox({
  config,
  auth: { secret: config.auth.secret, public: ["/health"] },
  shell: {
    basePath: "/shell",
    auth: { users: { admin: shellPassword } },
    title: "honox-app",
    version: "0.1.0",
  },
});

app.get("/", (c) => c.text("honox-app: GET /health、GET /me、GET /bots/:id、GET /apc/:id"));

app.get("/health", (c) => c.json({ ok: true }));

app.get("/me", (c) => c.json({ uid: c.get("uid") }));

app.get("/bots/:id", (c) => {
  const id = Number(c.req.param("id"));
  const bot = Number.isFinite(id) ? botSheet.get(id) : undefined;
  if (bot === undefined) {
    return ResponseX.notFound("bot 不存在");
  }
  return c.json(bot);
});

app.get("/apc/:id", (c) => {
  const id = Number(c.req.param("id"));
  const apc = Number.isFinite(id) ? apcSheet.get(id) : undefined;
  if (apc === undefined) {
    return ResponseX.notFound("apc 不存在");
  }
  return c.json(apc);
});

// Bun 认这个默认导出（{ port, fetch }）并在启动时自己 Bun.serve，
// 所以 dist/index.js 不需要额外的启动脚本。
export default {
  port: Number(env.PORT ?? config.server?.port ?? 3000),
  fetch: app.fetch,
};
