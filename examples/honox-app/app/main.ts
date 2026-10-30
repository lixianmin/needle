import { createHonox } from "@needle/honox";
import { logo } from "@needle/logo";
import { registerApis } from "./api/index.js";
import { initLog } from "./logo.js";
import { viper } from "./viper.js";
import { initTemplates } from "./md/index.js";
import { APP_VERSION } from "./version.js";

// 配置在 app/viper.ts 里加载（ENV 决定读 res/config/app_<env>.yml，只认
// dev / fat / pro）。任何地方都直接 `import { viper } from "../viper.js"`，
// 不经过 request context。

// 日志最先初始化：它给全局 logo 挂文件 / 飞书 sink，晚于业务导入的话，
// 启动阶段那一批日志就永远进不了文件。
const { logFiles, notifyStartup } = initLog();

// /shell 在 JWT 白名单里，对匿名网络可达；口令是它唯一的门。
// 没配 shell_users 就不挂面板，免得留一个没人能管的入口。
const shellUsers = viper.getStringMap("server.shell_users");

/** 登录态有效期：7 天。测试时最常重启，半天就掉登录太磨人。 */
const SHELL_TOKEN_TTL_DAYS = 7;

const shell =
  Object.keys(shellUsers).length === 0
    ? undefined
    : {
        basePath: "/shell",
        auth: {
          users: shellUsers,
          // 必须显式给，不能靠库随机生成：随机密钥每次重启都换，已签发的
          // token 全部作废，浏览器里存着的那个就变成“每次重启都要重新登录”。
          // 单独一把钥匙，不复用 auth.secret：两边都是 HS256 + sub/exp 的
          // payload，共用一个密钥等于把 Shell 口令变成业务接口的通行证。
          secret: viper.getString("shell.secret"),
          ttlMs: SHELL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        },
        title: "honox-app",
        version: APP_VERSION,
        logFiles,
      };

// 模板表的加载全在 app/md：扫一次目录，按 sheet 名后缀分派。
// 新增表不用改这里，也不用改 app/md/index.ts。
await initTemplates(viper.getString("metadata.base_url"));

// createHonox 返回现成的 Hono 实例，路由直接挂在它上面，类型从实例上就带着。
// rid 由库自己发可排序 id：时间位在前、随机段在后，不需要配机器号，多实例直接跑。
const app = createHonox({
  logger: logo,
  auth: { secret: viper.getString("auth.secret") },
  shell,
});

// 接口全在 app/api：一个接口一个文件，这里只负责挂载。
// 公开路径也在那儿用 allowAnonymous 声明，不写在这份装配代码里。
registerApis(app);

// 启动通知：照 Go 版 logo 的 SendMessage，一次就够，不进告警队列。
notifyStartup();

// Bun 认这个默认导出（{ port, hostname, fetch }）并在启动时自己 Bun.serve，
// 所以 dist/index.js 不需要额外的启动脚本。
export default {
  port: viper.getInt("server.web_port"),
  hostname: viper.getString("server.host", "0.0.0.0"),
  fetch: app.fetch,
};
