import { createHonox } from "@needle/honox";
import { loadSheets } from "@needle/honox/excel";
import { loadConfig } from "@needle/honox/node";
import { createApp } from "honox/server";
import { planSheet } from "./lib/plans";

const config = loadConfig<{ auth: { secret: string }; server?: { port?: number } }>({
  required: ["auth.secret"],
});

// 生产环境必须覆盖仓库里的 dev 密钥，否则任何人都能伪造 token。
if (process.env.NODE_ENV === "production" && (process.env.APP_AUTH__SECRET ?? "") === "") {
  throw new Error("生产环境必须用 APP_AUTH__SECRET 提供 JWT 密钥（不能沿用 app_dev.yml 里的 dev 值）");
}

// /shell 在 JWT 白名单里，对匿名网络可达；口令是它唯一的门，不能有默认值。
const shellPassword = process.env.SHELL_PASSWORD;
if (shellPassword === undefined || shellPassword === "") {
  throw new Error("SHELL_PASSWORD 未设置：Shell 面板需要一个口令");
}

// hucre 只能异步读：预载一次，之后 getter 同步、零 IO。
await loadSheets([planSheet]);

const app = createApp({
  app: createHonox({
    config,
    auth: { secret: config.auth.secret, public: ["/health"] },
    shell: {
      basePath: "/shell",
      auth: { users: { admin: shellPassword } },
      title: "honox-app",
      version: "0.1.0",
    },
  }),
});

export default app;
