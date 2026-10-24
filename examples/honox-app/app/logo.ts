import { LEVELS, createLarkSink, logo, type Level, type LogFiles } from "@needle/logo";
import { createFileSink, createLogFiles } from "@needle/logo/node";
import { viper } from "./viper.js";

/**
 * 日志目录固定是进程工作目录下的 `log/`，不做配置项。
 *
 * 日志目录没有"每个环境不一样"的理由：它在仓库里是被 gitignore 的产物，
 * 部署时跟着工作目录走。多一个配置项只会多一处能配错、也多一处要在
 * Dockerfile 和 .gitignore 里对齐。
 */
const LOG_DIR = "log";

/** 单文件上限：10MB 够放好几天的请求日志，再大就是 grep 不动了。 */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** 归档保留 7 天：一周足够回看一次发布事故，再久用日志平台。 */
const DEFAULT_KEEP_DAYS = 7;

/**
 * 读级别配置。
 *
 * 写错级别当成启动期错误直接炸，不静默回退：`filter_level: wran` 这种拼错
 * 如果被忽略，线上会一路按 info 跑，等到要看 debug 时才发现一直没记。
 */
function readLevel(path: string, fallback: Level): Level {
  const value = viper.getString(path, fallback);
  if (!(value in LEVELS)) {
    throw new Error(`${path} 只能是 ${Object.keys(LEVELS).join(" / ")}，拿到 "${value}"`);
  }
  return value as Level;
}

/**
 * 初始化日志：定级别、挂文件 sink、按需挂飞书，最后把 `logFiles` 交给 Shell。
 *
 * 挂在全局 `logo` 上而不是另建实例：项目里到处 `import { logo } from "@needle/logo"`，
 * 两套实例等于一半日志进不了右栏、也进不了文件。
 *
 * 飞书用群机器人的 webhook 地址（`logger.lark_url`），不是 token。空字符串是
 * "不推"的显式写法，不是缺配置，所以不报错。地址是密钥，仓库里留空，本地用
 * `APP_LOGGER__LARK_URL=... ` 覆盖，别提交进来。
 */
export function initLog(): LogFiles {
  const level = readLevel("logger.filter_level", "info");
  logo.setLevel(level);

  // minLevel 跟着 filter_level 走：级别开到 debug 才需要 debug.log，
  // 否则只是凭空多一个永远为空的文件。
  logo.addSink(
    createFileSink({
      dir: LOG_DIR,
      maxBytes: viper.getInt("logger.max_bytes", DEFAULT_MAX_BYTES),
      keepDays: viper.getInt("logger.keep_days", DEFAULT_KEEP_DAYS),
      minLevel: level,
    }),
  );

  const larkUrl = viper.getString("logger.lark_url", "");
  if (larkUrl !== "") {
    logo.addSink(
      createLarkSink({
        webhook: larkUrl,
        secret: viper.getString("logger.lark_secret", ""),
      }),
    );
  }

  // Shell 的 log.list 读的就是这个目录；不传它，面板里只有实时流没有历史。
  return createLogFiles({ dir: LOG_DIR });
}
