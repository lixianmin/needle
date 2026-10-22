import type { LogRecord } from "../../core/types.js";
import type { CommandOutput } from "../types.js";

export interface HelloInfo {
  title: string;
  version: string;
  user: string | null;
  commands: Array<{ name: string; note: string; args: string | null }>;
  topics: Array<{ name: string; note: string; intervalMs: number }>;
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

export type AuthResult = { ok: true; user: string } | { ok: false; error: string };

/**
 * UI 需要的全部能力。
 *
 * `authenticate` 单列一个方法，而不是把密码拼进命令串：命令串会进历史记录、
 * 会显示在输出区、会出现在服务端日志里。密码只走这一个入口。
 */
export interface ConsoleAdapter {
  exec(line: string): Promise<ExecResult>;
  authenticate(user: string, password: string): Promise<AuthResult>;
  logout(): void;
  /** 订阅的主题变了：重建流，用新的 topics 参数。传空串表示全部退订。 */
  setTopics(spec: string): void;
  subscribe(listener: (event: ConsoleEvent) => void): () => void;
}
