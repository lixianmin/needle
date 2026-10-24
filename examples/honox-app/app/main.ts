import { createHonox } from "@needle/honox";
import { nodeIdFromMac } from "@needle/honox/node";
import { registerApis } from "./api/index.js";
import { viper } from "./viper.js";
import { initTemplates } from "./md/index.js";

// 配置在 app/viper.ts 里加载（ENV 决定读 res/config/app_<env>.yml，只认
// dev / fat / pro）。任何地方都直接 `import { viper } from "../viper.js"`，
// 不经过 request context。

// /shell 在 JWT 白名单里，对匿名网络可达；口令是它唯一的门。
// 没配 shell_users 就不挂面板，免得留一个没人能管的入口。
const shellUsers = viper.getStringMap("server.shell_users");
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
await initTemplates(viper.getString("metadata.base_url"));

// createHonox 返回现成的 Hono 实例，路由直接挂在它上面，类型从实例上就带着。
// rid 用 Snowflake：epoch 写死在配置里（不能用启动时间），机器号从网卡 MAC 派生。
// 多实例部署时 MAC 会变（容器），那种场景请改成显式配置 nodeId。
const app = createHonox({
  snowflake: {
    epoch: viper.getInt("server.epoch_ms"),
    nodeId: nodeIdFromMac(),
  },
  auth: { secret: viper.getString("auth.secret") },
  shell,
});

// 接口全在 app/api：一个接口一个文件，这里只负责挂载。
// 公开路径也在那儿用 allowAnonymous 声明，不写在这份装配代码里。
registerApis(app);

// Bun 认这个默认导出（{ port, hostname, fetch }）并在启动时自己 Bun.serve，
// 所以 dist/index.js 不需要额外的启动脚本。
export default {
  port: viper.getInt("server.web_port"),
  hostname: viper.getString("server.host", "0.0.0.0"),
  fetch: app.fetch,
};
