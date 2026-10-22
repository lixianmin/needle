import type { Logger } from "../core/logger.js";
import { createRingSink, type RingSink } from "../core/ring.js";
import { createAuth, type Auth } from "./auth.js";
import { createBuiltinCommands } from "./builtins.js";
import { CommandError, findCommand, splitArgs } from "./commands.js";
import { createMetrics } from "./metrics.js";
import { createBroadcast, type Broadcast } from "./sse.js";
import type { AuthOptions, Command, CommandOutput, Topic } from "./types.js";

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
  historySize?: number;
  /** 头栏显示的项目名，默认 "console"。 */
  title?: string;
  version?: string;
  /**
   * 本地身份。设了它就跳过 token 鉴权——浏览器页面和扩展里，能看到控制台
   * 的人本来就能碰到这个进程，再要一次 token 只是仪式。
   */
  user?: string;
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
  records: RingSink;
  broadcast: Broadcast;
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
  const historySize = options.historySize ?? DEFAULT_HISTORY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const version = options.version ?? "unknown";
  const title = options.title ?? "console";
  const localUser = options.user ?? null;

  const records = createRingSink(historySize);
  const broadcast = createBroadcast();
  const metrics = createMetrics({ connections: () => broadcast.count() });
  const auth = createAuth(options.auth);

  // 两个 sink 都挂在调用方给的 logger 上：历史与实时是同一份记录的两个去处。
  options.logger.addSink(records);
  options.logger.addSink(broadcast.sink);

  const builtins = createBuiltinCommands({
    records,
    metrics,
    flush: () => options.logger.flush(),
  });

  // 调用方传入的命令优先：内置只是默认值，不是特权层。
  const custom = options.commands ?? [];
  const shadowed = new Set(custom.map((command) => command.name));
  const commands: Command[] = [
    ...custom,
    ...builtins.filter((command) => !shadowed.has(command.name)),
  ];

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
    records,
    broadcast,
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
      options.logger.removeSink(records);
      options.logger.removeSink(broadcast.sink);
    },
  };
}
