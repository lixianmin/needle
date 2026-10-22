import type { RingSink } from "../core/ring.js";
import { CommandError } from "./commands.js";
import type { Metrics } from "./metrics.js";
import type { Command, CommandContext, CommandOutput } from "./types.js";

const DEFAULT_LOG_COUNT = 20;

export interface BuiltinDeps {
  records: RingSink;
  metrics: Metrics;
  /** 读历史前先把缓冲写出来，否则刚写下的日志要等 100ms 才看得到。 */
  flush?: () => void;
}

/** ISO 字符串截到毫秒。日志视图不需要时区后缀，浏览器按本地时区展示。 */
function formatTime(time: number): string {
  return new Date(time).toISOString().slice(0, 23);
}

/** 只处理非数字：数字原样往下传，排序和人类可读格式化都留给展示层。 */
function keepRaw(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

function createHelpCommand(list: () => readonly Command[]): Command {
  return {
    name: "help",
    note: "列出所有命令",
    public: true,
    run(): CommandOutput {
      const width = Math.max(...list().map((command) => command.name.length));
      const lines = list().map((command) => {
        const signature = command.args ? `${command.name} ${command.args}` : command.name;
        return `${signature.padEnd(width + 8)}${command.note}`;
      });
      return { kind: "text", text: lines.join("\n") };
    },
  };
}

function createLogsCommand(records: RingSink, flush: () => void): Command {
  return {
    name: "logs",
    note: "查看最近的日志",
    args: "[n]",
    run(ctx: CommandContext): CommandOutput {
      const requested = ctx.args[0];
      const count = requested === undefined ? DEFAULT_LOG_COUNT : Number(requested);

      // 不做 parseInt 的宽松解析："20abc" 应该报错，而不是悄悄当成 20。
      if (!Number.isInteger(count) || count <= 0) {
        throw new CommandError(`logs 需要一个正整数，收到: ${requested}`);
      }

      flush();

      return {
        kind: "table",
        columns: ["time", "level", "msg"],
        rows: records.read(count).map((record) => [
          formatTime(record.time),
          record.level,
          record.msg ?? "",
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
        rows: Object.entries(snapshot).map(([key, value]) => [key, keepRaw(value)]),
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

function createLogoutCommand(): Command {
  return {
    name: "logout",
    note: "清除本地登录态",
    public: true,
    run(): CommandOutput {
      return { kind: "text", text: "已退出（清除本地 token 即可）" };
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
    createLogsCommand(deps.records, deps.flush ?? (() => {})),
    createTopCommand(deps.metrics),
    createAuthCommand(),
    createLogoutCommand(),
    createSubCommand("sub"),
    createSubCommand("unsub"),
  ];

  // help 要列出包括自己在内的全部命令，所以最后插入并持有同一个数组的引用。
  commands.unshift(createHelpCommand(() => commands));

  return commands;
}
