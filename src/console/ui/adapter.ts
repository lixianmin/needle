import type { LogRecord } from "../../core/types.js";
import type { CommandOutput } from "../types.js";

export interface HelloInfo {
  version: string;
  user: string | null;
  commands: Array<{ name: string; note: string; args: string | null }>;
}

export type ConsoleEvent =
  | { type: "hello"; info: HelloInfo }
  | { type: "log"; record: LogRecord }
  | { type: "topic"; name: string; data: unknown }
  /** 连接状态、鉴权失败之类的提示，由适配器发出。 */
  | { type: "status"; message: string; level: "info" | "warn" | "error" };

export type ExecResult =
  | { ok: true; output: CommandOutput }
  | { ok: false; error: string; unauthorized?: boolean };

/**
 * UI 需要的全部能力。
 *
 * 只有两个方法，因为控制台本来就只做两件事：执行一条命令、接收服务端推来的东西。
 * 传输方式（HTTP+SSE 还是进程内直调）由适配器决定，UI 不关心。
 */
export interface ConsoleAdapter {
  exec(line: string): Promise<ExecResult>;
  subscribe(listener: (event: ConsoleEvent) => void): () => void;
}
