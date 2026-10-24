import { createHonox } from "@needle/honox";
import { loadConfig } from "@needle/honox/node";
import { registerApis } from "./api";
import type { AppConfig } from "./env";
import { initTemplates } from "./md";

// 配置跟模板表一起放在 res/ 下，与镜像里的目录结构一致。
const config = loadConfig<AppConfig>({
  dir: "res/config",
  required: ["auth.secret", "metadata.base_url"],
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

// 模板表的加载全在 app/md：扫一次目录，按 sheet 名后缀分派。
// 新增表不用改这里，也不用改 app/md/index.ts。
await initTemplates(config.metadata.base_url);

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

// 接口全在 app/api：一个接口一个文件，这里只负责挂载。
registerApis(app);

// Bun 认这个默认导出（{ port, hostname, fetch }）并在启动时自己 Bun.serve，
// 所以 dist/index.js 不需要额外的启动脚本。PORT / HOST 环境变量优先于配置。
export default {
  port: Number(env.PORT ?? config.server?.web_port ?? 3000),
  hostname: env.HOST ?? config.server?.host ?? "0.0.0.0",
  fetch: app.fetch,
};
