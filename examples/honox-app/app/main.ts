import { createHonox } from "@needle/honox";
import { loadConfig } from "@needle/honox/node";
import { registerApis } from "./api";
import { initTemplates } from "./md";

// 配置跟模板表一起放在 res/ 下，与镜像里的目录结构一致。
// ENV 决定读 res/config/app_<env>.yml（只认 dev / fat / pro），
// 之后所有取值都走 config.getXxx("点分路径")，不再碰 process.env。
const config = loadConfig({
  dir: "res/config",
  required: ["auth.secret", "metadata.base_url", "server.web_port"],
});

// /shell 在 JWT 白名单里，对匿名网络可达；口令是它唯一的门。
// 没配 shell_users 就不挂面板，免得留一个没人能管的入口。
const shellUsers = config.getStringMap("server.shell_users");
const shell =
  Object.keys(shellUsers).length === 0
    ? undefined
    : {
        basePath: "/shell",
        auth: { users: shellUsers },
        title: "honox-app",
        version: "0.1.0",
      };

// 模板表的加载全在 app/md：扫一次目录，按 sheet 名后缀分派。
// 新增表不用改这里，也不用改 app/md/index.ts。
await initTemplates(config.getString("metadata.base_url"));

// createHonox 返回现成的 Hono 实例，路由直接挂在它上面，类型从实例上就带着。
const app = createHonox({
  config,
  auth: { secret: config.getString("auth.secret"), public: ["/health"] },
  shell,
});

// 接口全在 app/api：一个接口一个文件，这里只负责挂载。
registerApis(app);

// Bun 认这个默认导出（{ port, hostname, fetch }）并在启动时自己 Bun.serve，
// 所以 dist/index.js 不需要额外的启动脚本。
export default {
  port: config.getInt("server.web_port"),
  hostname: config.getString("server.host", "0.0.0.0"),
  fetch: app.fetch,
};
