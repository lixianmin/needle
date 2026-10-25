import { LEVELS, createLarkSink, formatTime, logo, type LarkSink, type Level, type LogFiles } from "@needle/logo";
import { createFileSink, createLogFiles } from "@needle/logo/node";
import { networkInterfaces } from "node:os";
import { viper } from "./viper.js";
import { APP_VERSION } from "./version.js";

/** 应用名，写进飞书标题。 */
const APP_NAME = "honox-app";

/**
 * 日志目录固定是进程工作目录下的 `logs/`，不做配置项。
 *
 * 日志目录没有"每个环境不一样"的理由：它在仓库里是被 gitignore 的产物，
 * 部署时跟着工作目录走。多一个配置项只会多一处能配错、也多一处要在
 * Dockerfile 和 .gitignore 里对齐。
 */
const LOG_DIR = "logs";

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
  // 必须用 hasOwn：`"toString" in LEVELS` 也为真（原型链），那样的配置会被当成
  // 合法级别返回，LEVELS["toString"] 是函数，之后所有比较都失真、日志一条不写。
  if (!Object.hasOwn(LEVELS, value)) {
    throw new Error(`${path} 只能是 ${Object.keys(LEVELS).join(" / ")}，拿到 "${value}"`);
  }

  return value as Level;
}

/**
 * 本机第一个非回环 IPv4。
 *
 * 飞书标题里写 IP:端口 是为了多实例时能分清是哪一台——照 Go 版 logo 的
 * `NewLark(titlePrefix, token)` 用法（`DEV fly.server 192.168.31.182:6003`）。
 */
function localIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) {
        return item.address;
      }
    }
  }

  return "127.0.0.1";
}

function endpoint(): string {
  return `${localIp()}:${viper.getInt("server.web_port")}`;
}

/** 启动通知的内容：能真拿到的才写，不编造构建信息。 */
function startupInfo(): Record<string, unknown> {
  const where = endpoint();
  return {
    version: APP_VERSION,
    runtime: `bun ${Bun.version}`,
    env: viper.env,
    endpoint: where,
    shell: `http://${where}/shell`,
    pid: process.pid,
    // 时间一律东八区（与落盘日志、面板同一个口径），不用 toISOString 那种 UTC
    startedAt: formatTime(Date.now()),
  };
}

export interface LogInit {
  /** 交给 Shell 的 `logFiles`，`log.list` 读的就是这个目录。 */
  logFiles: LogFiles;
  /** 往飞书发一条启动通知；没配 `logger.lark_url` 时是空操作。 */
  notifyStartup(): void;
}

/**
 * 初始化日志：定级别、挂文件 sink、按需挂飞书，最后把 `logFiles` 交给 Shell。
 *
 * 挂在全局 `logo` 上而不是另建实例：项目里到处 `import { logo } from "@needle/logo"`，
 * 两套实例等于一半日志进不了右栏、也进不了文件。
 *
 * 飞书用群机器人的 webhook 地址（`logger.lark_url`），不是 token。空字符串是
 * "不推"的显式写法，不是缺配置，所以不报错。
 */
export function initLog(): LogInit {
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

  let lark: LarkSink | undefined;
  const larkUrl = viper.getString("logger.lark_url", "");
  if (larkUrl !== "") {
    lark = createLarkSink({
      webhook: larkUrl,
      secret: viper.getString("logger.lark_secret", ""),
      // 标题前缀照 Go 版：`DEV fly.server 192.168.31.182:6003`
      titlePrefix: `${viper.env.toUpperCase()} ${APP_NAME} ${endpoint()}`,
    });
    logo.addSink(lark);
  }

  return {
    // Shell 的 log.list 读的就是这个目录；不传它，面板里只有实时流没有历史。
    logFiles: createLogFiles({ dir: LOG_DIR }),
    notifyStartup(): void {
      if (lark === undefined) {
        return;
      }

      // 标题空着，跟 Go 版那个例子一致：级别 + 前缀已经说明了来源，内容全放正文。
      void lark.notify("info", "", JSON.stringify(startupInfo()));
    },
  };
}
