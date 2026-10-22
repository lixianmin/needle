import { formatDuration, toHuman } from "../core/logo/human.js";
import { formatTime } from "../core/logo/line.js";
import { CommandError } from "./commands.js";
import type { Metrics } from "./metrics.js";
import type { Auth } from "./auth.js";
import type { Command, CommandContext, CommandOutput, LogFiles } from "./types.js";

export interface BuiltinDeps {
  metrics: Metrics;
  auth: Auth;
  /** 日志目录端口；没注入就说明这个宿主没有文件系统。 */
  logFiles?: LogFiles;
  /** 拼日志文件链接用，如 "/console"。 */
  basePath: string;
}


/**
 * 指标表的取值格式。
 *
 * 这张表是"指标名 → 值"，同一列里既有毫秒也有字节，没法用列语义（formats）
 * 表达，所以在服务端按字段名格式化。代价是这一列没法按数值排序——但跨单位
 * 排序本来就没意义。
 */
function formatMetric(name: string, value: unknown): string | number {
  if (typeof value === "string") return value;
  if (typeof value !== "number") return JSON.stringify(value) ?? "";
  if (name === "rss" || name === "heapUsed") return toHuman(value);
  if (name.endsWith("Ms")) return formatDuration(value);
  return value;
}

/** help 由调用方在合并自定义命令之后再插入——它要看到全量，而不是只有内置的。 */
export function createHelpCommand(list: () => readonly Command[]): Command {
  return {
    name: "help",
    note: "列出所有命令",
    // 由库提供，归到内置组。调用方自定义的 help 不会有这个标记。
    builtin: true,
    public: true,
    run(): CommandOutput {
      const all = list();
      const width = Math.max(...all.map((command) => command.name.length));
      const render = (command: Command): string => {
        const signature = command.args ? `${command.name} ${command.args}` : command.name;
        return `${signature.padEnd(width + 8)}${command.note}`;
      };

      const custom = all.filter((command) => command.builtin !== true);
      const builtin = all.filter((command) => command.builtin === true);

      // 分组不是为了好看：混在一起就分不清哪些是库给的、哪些是这个项目自己加的。
      const blocks: string[] = [];
      if (custom.length > 0) {
        blocks.push("自定义命令", ...custom.map(render));
      }
      if (builtin.length > 0) {
        if (blocks.length > 0) blocks.push("");
        blocks.push("内置命令", ...builtin.map(render));
      }
      return { kind: "text", text: blocks.join("\n") };
    },
  };
}

function createLogListCommand(deps: { logFiles?: LogFiles; basePath: string }): Command {
  return {
    name: "log.list",
    note: "列出日志文件（点文件名看全文）",
    async run(): Promise<CommandOutput> {
      if (deps.logFiles === undefined) {
        throw new CommandError("没有配置日志目录，log.list 不可用（Node 侧用 createLogFiles 传进来）");
      }

      const files = await deps.logFiles.list();
      if (files.length === 0) return { kind: "text", text: "日志目录里还没有文件" };

      return {
        kind: "table",
        columns: ["file", "size", "modified"],
        formats: ["auto", "bytes", "auto"],
        rows: files.map((file) => [
          {
            text: file.name,
            href: `${deps.basePath}/log/${encodeURIComponent(file.name)}`,
          },
          file.size,
          formatTime(file.modified),
        ]),
      };
    },
  };
}

function createTopCommand(metrics: Metrics): Command {
  return {
    name: "top",
    note: "看一眼进程指标（要持续刷就 sub top）",
    async run(): Promise<CommandOutput> {
      const snapshot = await metrics.read();
      return {
        kind: "table",
        columns: ["metric", "value"],
        rows: Object.entries(snapshot).map(([key, value]) => [key, formatMetric(key, value)]),
      };
    },
  };
}

function createAuthCommand(): Command {
  return {
    name: "auth",
    note: "登录：输入用户名后，下一步会提示输入密码",
    args: "<user>",
    public: true,
    run(ctx: CommandContext): CommandOutput {
      const user = ctx.args[0];
      if (user === undefined) {
        throw new CommandError("用法: auth <user>，密码会在下一步提示输入");
      }
      // 走到这里说明有人绕过控制台直接调 /exec（例如 curl）。密码不能拼在
      // 命令行里——那会被历史记录、输出区和访问日志原样留下。
      throw new CommandError("密码不能走命令行：控制台里输入 `auth <user>` 后会切换成密码输入框");
    },
  };
}

/**
 * `sub` / `unsub` 只是在这里登记，好让 `help` 能列出来。
 *
 * 订阅是**某一条 SSE 连接**的属性，而 /exec 是另一条请求，拿不到那条流。
 * 真正的实现在控制台 UI 里：改订阅集合、重建流。
 */
function createSubCommand(name: "sub" | "unsub"): Command {
  return {
    name,
    note:
      name === "sub"
        ? "订阅主题（如 sub top 2000）"
        : "取消订阅（如 unsub top，留空取消全部）",
    args: name === "sub" ? "<topic> [interval-ms]" : "[topic]",
    public: true,
    run(): CommandOutput {
      throw new CommandError(`${name} 在控制台里用：订阅属于浏览器那条流，/exec 拿不到它`);
    },
  };
}

/**
 * 内置命令。
 *
 * 每个命令一个工厂函数，组装集中在一处——比一个大 switch 好读，也让
 * "新增一个命令"这件事只有一种写法。
 */
export function createBuiltinCommands(deps: BuiltinDeps): Command[] {
  const commands: Command[] = [
    createLogListCommand({ basePath: deps.basePath, ...(deps.logFiles === undefined ? {} : { logFiles: deps.logFiles }) }),
    createTopCommand(deps.metrics),
    createAuthCommand(),
    createSubCommand("sub"),
    createSubCommand("unsub"),
  ];

  return commands;
}
