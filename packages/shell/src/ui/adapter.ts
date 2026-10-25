import type { LogRecord } from "@needle/logo";
import type { CommandOutput } from "../types.js";

export interface HandshakeInfo {
  title: string;
  version: string;
  user: string | null;
  commands: Array<{ name: string; note: string; args: string | null }>;
  topics: Array<{ name: string; note: string; intervalMs: number }>;
}

export type ShellEvent =
  | { type: "handshake"; info: HandshakeInfo }
  | { type: "logs"; records: LogRecord[] }
  | { type: "topic"; name: string; data: unknown }
  /** 连接状态、鉴权失败之类的提示，由适配器发出。 */
  | { type: "status"; message: string; level: "info" | "warn" | "error" }
  /**
   * 登录态变化。token 失效（401）或重新登录都要发一条：
   * 只靠 handshake 的话，401 之后 UI 里的 loggedIn 会一直是 true，
   * `sub` / `unsub` 会打一句假的「已订阅」，实际什么都没订阅。
   */
  | { type: "auth"; user: string | null };

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
export type FileResult = { ok: true; text: string } | { ok: false; error: string };

export interface ShellAdapter {
  exec(line: string): Promise<ExecResult>;
  /**
   * 取一个文件的全文（日志文件用）。
   *
   * 不走 URL 里的 token：链接点开时用 Authorization 头去取，再在本地生成 blob
   * 打开。这样链接不会因为"签发超过一分钟"而失效，凭证也不会留在地址栏和
   * 浏览器历史里。
   */
  fetchFile(href: string): Promise<FileResult>;
  authenticate(user: string, password: string): Promise<AuthResult>;
  /** 订阅的主题变了：重建流，用新的 topics 参数。传空串表示全部退订。 */
  setTopics(spec: string): void;
  subscribe(listener: (event:ShellEvent) => void): () => void;
}
