import type { Logger } from "../core/logger.js";

/** 鉴权配置。core 不读环境变量：Workers 上的 process 语义不可靠，secret 必须由宿主传入。 */
export interface AuthOptions {
  users: Record<string, string>;
  /** 不传就随机生成，重启后所有 token 失效。 */
  secret?: string;
  /** token 有效期，默认 12 小时。 */
  ttlMs?: number;
}

/**
 * 命令的输出只有三种形态。
 *
 * 固定形态的理由：前端要渲染、测试要断言、自定义命令要能无损表达。
 * 允许任意结构就得让前端猜，猜错就渲染成 [object Object]。
 */
/**
 * 表格某一列的显示语义。缺省 `auto`：整数且 ≥1024 才按 K/M 缩。
 * - `bytes`：字节，永远走 toHuman（512 → 512B）
 * - `duration`：毫秒数，走 formatDuration（57720 → 57.7s）
 * - `number`：计数，原样显示（不缩写成 K）
 */
export type ColumnFormat = "auto" | "bytes" | "duration" | "number";

export type CommandOutput =
  | { kind: "text"; text: string }
  | {
      kind: "table";
      columns: string[];
      rows: Array<Array<string | number | null>>;
      /** 与 columns 等长；省略则全部按 auto 处理。 */
      formats?: ColumnFormat[];
    }
  | { kind: "json"; value: unknown };

export interface CommandContext {
  /** 已按空白切分，不做引号解析。 */
  args: string[];
  user: string | null;
  log: Logger;
}

export interface Command {
  name: string;
  note: string;
  /** 帮助里显示的参数说明，如 "[n]"。 */
  args?: string;
  /** 匿名可执行。默认 false。 */
  public?: boolean;
  run(ctx: CommandContext): Promise<CommandOutput> | CommandOutput;
}

/** 服务端周期性推送的数据源。 */
export interface Topic {
  name: string;
  note: string;
  intervalMs: number;
  read(): Record<string, unknown> | Promise<Record<string, unknown>>;
}
