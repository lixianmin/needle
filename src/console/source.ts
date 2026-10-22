import type { Logger } from "../core/logger.js";
import { createAuth, type Auth } from "./auth.js";
import { createBuiltinCommands, createHelpCommand } from "./builtins.js";
import { CommandError, findCommand, splitArgs } from "./commands.js";
import { createMetrics } from "./metrics.js";
import { createBroadcast, type Broadcast } from "./sse.js";
import type { AuthOptions, Command, CommandOutput, LogFiles, Topic } from "./types.js";

const DEFAULT_HISTORY = 1000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 命令执行结果。
 *
 * `unauthorized` 单独标出来，是为了让 HTTP 适配器能把它映射成 401——
 * 纯逻辑层不该知道状态码，但调用方需要区分"没登录"和"命令报错"。
 */
export type ExecResult =
  | { ok: true; output: CommandOutput }
  | { ok: false; error: string; unauthorized?: true };

export interface ConsoleSourceOptions {
  logger: Logger;
  auth: AuthOptions;
  commands?: Command[];
  topics?: Topic[];
  /** 头栏显示的项目名，默认 "console"。 */
  title?: string;
  version?: string;
  /**
   * 本地身份。设了它就跳过 token 鉴权——浏览器页面和扩展里，能看到控制台
   * 的人本来就能碰到这个进程，再要一次 token 只是仪式。
   */
  user?: string;
  /** 日志目录端口。Node 侧用 createLogFiles 提供；浏览器/Workers 不传。 */
  logFiles?: LogFiles;
  /** 拼日志文件链接的前缀，如 "/console"。 */
  basePath?: string;
  timeoutMs?: number;
}

/**
 * 控制台的全部逻辑，不含任何传输层。
 *
 * 它是 Node 服务、Workers、浏览器页面、Chrome 扩展共用的那一层：
 * 同一个 source 上面可以挂 HTTP/SSE 适配器，也可以直接挂 DOM。
 */
export interface ConsoleSource {
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

export function createConsoleSource(options: ConsoleSourceOptions): ConsoleSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const version = options.version ?? "unknown";
  const title = options.title ?? "console";
  const localUser = options.user ?? null;

  const broadcast = createBroadcast();
  const metrics = createMetrics({ connections: () => broadcast.count() });
  const auth = createAuth(options.auth);

  // 实时日志直接推给 SSE；历史去磁盘看（logs 命令列文件），内存里不再留环形缓冲。
  options.logger.addSink(broadcast.sink);

  const basePath = options.basePath ?? "";
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
    if (disposed) return { ok: false, error: "console disposed" };

    const [name, ...args] = splitArgs(line);
    if (name === undefined) return { ok: false, error: "空命令" };

    const command = findCommand(commands, name);
    if (command === undefined) return { ok: false, error: `unknown command: ${name}` };

    let user: string | null = localUser;
    if (localUser === null && command.public !== true) {
      const verified = await auth.verify(token);
      if (verified === null) return { ok: false, error: "unauthorized", unauthorized: true };
      user = verified.sub;
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
        Promise.resolve(command.run({ args, user, log: options.logger })),
        deadline,
      ]);
      return { ok: true, output };
    } catch (error) {
      if (timedOut) return { ok: false, error: "timeout" };
      // 只回 message：堆栈里有文件路径，是给本地排错用的，不该顺 HTTP 跑出去。
      const message = error instanceof CommandError ? error.message : String(error);
      return { ok: false, error: message };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
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
      if (token === null) return { ok: false, error: "用户名或密码错误" };
      return { ok: true, user, token };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      broadcast.closeAll();
      options.logger.removeSink(broadcast.sink);
    },
  };
}
