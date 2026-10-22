import type { RingSink } from "../core/ring.js";
import type { Auth } from "./auth.js";
import { CommandError } from "./commands.js";
import type { Metrics } from "./metrics.js";
import type { Command, CommandContext, CommandOutput } from "./types.js";

const DEFAULT_LOG_COUNT = 20;

export interface BuiltinDeps {
  records: RingSink;
  metrics: Metrics;
  auth: Auth;
  /** 默认读 globalThis.process?.env ?? {}，Workers 上是空表。 */
  env?: Record<string, string | undefined>;
}

/** ISO 字符串截到毫秒。日志视图不需要时区后缀，浏览器按本地时区展示。 */
function formatTime(time: number): string {
  return new Date(time).toISOString().slice(0, 23);
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
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

function createLogsCommand(records: RingSink): Command {
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

function createPsCommand(metrics: Metrics): Command {
  return {
    name: "ps",
    note: "查看进程指标",
    async run(): Promise<CommandOutput> {
      const snapshot = await metrics.read();
      return {
        kind: "table",
        columns: ["metric", "value"],
        rows: Object.entries(snapshot).map(([key, value]) => [key, formatValue(value)]),
      };
    },
  };
}

function createEnvCommand(resolveEnv: () => Record<string, string | undefined>): Command {
  return {
    name: "env",
    note: "查看环境变量（默认打码）",
    args: "[pattern] [--show]",
    run(ctx: CommandContext): CommandOutput {
      const show = ctx.args.includes("--show");
      const pattern = ctx.args.find((arg) => !arg.startsWith("--"));
      const entries = Object.entries(resolveEnv()).filter(([key]) =>
        pattern === undefined ? true : key.includes(pattern),
      );

      return {
        kind: "table",
        columns: ["key", "value"],
        rows: entries
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, show ? (value ?? "") : "***"]),
      };
    },
  };
}

function createLoginCommand(auth: Auth): Command {
  return {
    name: "login",
    note: "登录以获取完整权限",
    args: "<user> <password>",
    public: true,
    async run(ctx: CommandContext): Promise<CommandOutput> {
      const [user, password] = ctx.args;
      if (user === undefined || password === undefined) {
        throw new CommandError("用法: login <user> <password>");
      }

      const token = await auth.login(user, password);
      if (token === null) throw new CommandError("用户名或密码错误");

      return { kind: "json", value: { token } };
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
  const resolveEnv =
    deps.env === undefined
      ? () =>
          (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
          {}
      : () => deps.env as Record<string, string | undefined>;

  const commands: Command[] = [
    createLogsCommand(deps.records),
    createPsCommand(deps.metrics),
    createEnvCommand(resolveEnv),
    createLoginCommand(deps.auth),
    createLogoutCommand(),
  ];

  // help 要列出包括自己在内的全部命令，所以最后插入并持有同一个数组的引用。
  commands.unshift(createHelpCommand(() => commands));

  return commands;
}
