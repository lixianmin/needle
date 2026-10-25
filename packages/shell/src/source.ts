import { logo, type Logger } from "@needle/logo";
import { createAuth, type Auth } from "./auth.js";
import { createBuiltinCommands, createHelpCommand } from "./builtins.js";
import { CommandError, findCommand, splitArgs } from "./commands.js";
import { createMetrics } from "./metrics.js";
import { createBroadcast, type Broadcast } from "./sse.js";
import { normalizeBasePath } from "./router.js";
import type { LogFiles } from "@needle/logo";
import type { AuthOptions, Command, CommandOutput, Topic } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 未登录时只允许这两条：登录本身，和看用法。
 *
 * 其它命令一律 401——包括宿主注册的命令。日志、指标、业务状态都只该给
 * 登录后的人看；「不登录也能跑」的开关（旧的 `public`）已经删掉。
 */
const ANONYMOUS_COMMANDS = new Set(["auth", "help"]);

/**
 * 命令失败的原因。HTTP 适配器拿它选状态码；浏览器适配器只关心 unauthorized。
 */
export type ExecFailureCode =
  | "disposed"
  | "bad_request"
  | "unknown_command"
  | "unauthorized"
  | "timeout"
  | "command_failed";

/**
 * 命令执行结果。
 *
 * 纯逻辑层不碰状态码（浏览器里没有状态码），所以失败带的是 `code`，由适配器
 * 自己映射：HTTP 适配器转成状态码 + `{code, message}`，浏览器适配器转成提示。
 */
export type ExecResult =
  | { ok: true; output: CommandOutput }
  | { ok: false; code: ExecFailureCode; error: string };

export interface ShellSourceOptions {
  /**
   * 日志来源。默认用 `@needle/logo` 的全局 `logo` 实例——全项目写同一个 logger 时，
   * 右栏自然接管所有日志，不用一层层往下传。测试或需要独立配置时传自己的实例。
   */
  logger?: Logger;
  auth: AuthOptions;
  commands?: Command[];
  topics?: Topic[];
  /** 头栏显示的项目名，默认 "shell"。 */
  title?: string;
  version?: string;
  /**
   * 本地身份。设了它就跳过 token 鉴权——浏览器页面和扩展里，能看到 Shell
   * 的人本来就能碰到这个进程，再要一次 token 只是仪式。
   */
  user?: string;
  /** 日志目录端口。Node 侧用 createLogFiles 提供；浏览器/Workers 不传。 */
  logFiles?: LogFiles;
  /** 拼日志文件链接的前缀，如 "/shell"。 */
  basePath?: string;
  timeoutMs?: number;
}

/**
 *Shell 的全部逻辑，不含任何传输层。
 *
 * 它是 Node 服务、Workers、浏览器页面、Chrome 扩展共用的那一层：
 * 同一个 source 上面可以挂 HTTP/SSE 适配器，也可以直接挂 DOM。
 */
export interface ShellSource {
  commands: readonly Command[];
  topics: readonly Topic[];
  broadcast: Broadcast;
  logFiles?: LogFiles;
  auth: Auth;
  title: string;
  version: string;
  /** 本地身份；服务端模式为 null。 */
  user: string | null;
  exec(line: string, token: string | null): Promise<ExecResult>;
  /** 校验口令并签发 token。密码不走命令行，所以单独开一个入口。 */
  authenticate(user: string, password: string): Promise<AuthResult>;
  dispose(): void;
}

export type AuthResult = { ok: true; user: string; token: string } | { ok: false; error: string };

/** 指标命令与主题共用一次读取，避免同一秒内重复探测运行时。 */
function createDefaultTopics(metrics: ReturnType<typeof createMetrics>): Topic[] {
  return [
    {
      name: "top",
      note: "进程指标",
      intervalMs: 1000,
      read: () => metrics.read(),
    },
    {
      name: "mem",
      note: "内存与事件循环",
      intervalMs: 5000,
      async read() {
        const snapshot = await metrics.read();
        const { rss, heapUsed, loopUtilization } = snapshot;
        return { rss, heapUsed, loopUtilization };
      },
    },
  ];
}

export function createShellSource(options:ShellSourceOptions):ShellSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const version = options.version ?? "unknown";
  const title = options.title ?? "shell";
  const localUser = options.user ?? null;

  const broadcast = createBroadcast();
  const metrics = createMetrics({ connections: () => broadcast.count() });
  const auth = createAuth(options.auth);

  // 日志推给页面的日志栏；查历史仍然走 log.list。
  const logger = options.logger ?? logo;
  logger.addSink(broadcast.sink);

  // 在这里归一化：log.list 的 href 直接用这个值拼，调用方传 "shell" 或 "/shell/"
  // 会拼出相对链接或双斜杠。路由那边也会归一，但两边各自负责自己的出口更稳。
  const basePath = normalizeBasePath(options.basePath ?? "");
  const builtins = createBuiltinCommands({
    metrics,
    auth,
    basePath,
    ...(options.logFiles === undefined ? {} : { logFiles: options.logFiles }),
  });

  // 调用方传入的命令优先：内置只是默认值，不是特权层。
  const custom = options.commands ?? [];
  const shadowed = new Set(custom.map((command) => command.name));
  const merged: Command[] = [
    ...custom,
    // 内置命令打标：help 据此分组，也方便调用方判断某个名字是不是库提供的。
    ...builtins
      .filter((command) => !shadowed.has(command.name))
      .map((command) => ({ ...command, builtin: true })),
  ];

  // help 要列全量（含自定义命令），所以先建空数组再插 —— 让它持有最终引用。
  // 调用方自己定义了 help 就用它的，不硬塞一个内置版本。
  const commands: Command[] = [];
  // help 是库提供的，跟其他内置命令一样打标——它属于"内置"，不是"自定义"。
  const help = merged.some((command) => command.name === "help")
    ? []
    : [{ ...createHelpCommand(() => commands), builtin: true }];
  commands.push(...help, ...merged);

  const customTopics = options.topics ?? [];
  const shadowedTopics = new Set(customTopics.map((topic) => topic.name));
  const topics: Topic[] = [
    ...customTopics,
    ...createDefaultTopics(metrics).filter((topic) => !shadowedTopics.has(topic.name)),
  ];

  let disposed = false;

  async function exec(line: string, token: string | null): Promise<ExecResult> {
    if (disposed) {
      return { ok: false, code: "disposed", error: "shell disposed" };
    }

    const [name, ...args] = splitArgs(line);
    if (name === undefined) {
      return { ok: false, code: "bad_request", error: "空命令" };
    }

    const command = findCommand(commands, name);
    if (command === undefined) {
      return { ok: false, code: "unknown_command", error: `unknown command: ${name}` };
    }

    let user: string | null = localUser;
    if (localUser === null) {
      const verified = await auth.verify(token);
      if (verified === null) {
        if (!ANONYMOUS_COMMANDS.has(command.name)) {
          return { ok: false, code: "unauthorized", error: "unauthorized" };
        }
      } else {
        user = verified.sub;
      }
    }

    return runCommand(command, args, user);
  }

  async function runCommand(
    command: Command,
    args: string[],
    user: string | null,
  ): Promise<ExecResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("timeout"));
      }, timeoutMs);
    });

    try {
      const output = await Promise.race([
        Promise.resolve(command.run({ args, user, log: logger })),
        deadline,
      ]);
      return { ok: true, output };
    } catch (error) {
      if (timedOut) {
        return { ok: false, code: "timeout", error: "timeout" };
      }

      // 只回 message：堆栈里有文件路径，是给本地排错用的，不该顺 HTTP 跑出去。
      const message = error instanceof CommandError ? error.message : String(error);
      return { ok: false, code: "command_failed", error: message };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  return {
    commands,
    topics,
    broadcast,
    ...(options.logFiles === undefined ? {} : { logFiles: options.logFiles }),
    auth,
    title,
    version,
    user: localUser,

    exec,

    async authenticate(user, password) {
      const token = await auth.login(user, password);
      if (token === null) {
        return { ok: false, error: "用户名或密码错误" };
      }

      return { ok: true, user, token };
    },

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      broadcast.closeAll();
      logger.removeSink(broadcast.sink);
    },
  };
}
