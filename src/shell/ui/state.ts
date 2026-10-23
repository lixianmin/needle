import type { Level } from "../../logo/index.js";
import type { HandshakeInfo } from "./adapter.js";

export type CommandInfo = HandshakeInfo["commands"][number];
export type TopicInfo = HandshakeInfo["topics"][number];

/**
 *Shell UI 的可变状态。
 *
 * 以前这些都藏在 mountShell 的闭包里，函数越写越长。抽成显式的 state，
 * 各小模块按需拿参数，mountShell 只剩下「拼 DOM + 接线」。
 */
export interface ShellUiState {
  /** 未登录时只有 auth / help 可用：服务端的订阅与其它命令都要 401。 */
  loggedIn: boolean;
  commands: CommandInfo[];
  topics: TopicInfo[];
  /** 主题名 → 间隔（毫秒）。undefined 表示用服务端默认间隔。 */
  subscriptions: Map<string, number | undefined>;
  minLevel: Level | "all";
  paused: boolean;
  pausedDropped: number;
  /** 正在等密码的账号。非空时下一次回车的内容当密码处理。 */
  pendingUser: string | null;
  history: string[];
  cursor: number;
}

export function createState(history: string[]):ShellUiState {
  return {
    loggedIn: false,
    commands: [],
    topics: [],
    subscriptions: new Map(),
    minLevel: "all",
    paused: false,
    pausedDropped: 0,
    pendingUser: null,
    history,
    cursor: history.length,
  };
}

/** 订阅规格串：`top`，或 `top:2000`（带间隔）。 */
export function topicSpec(subscriptions: Map<string, number | undefined>): string {
  return [...subscriptions.entries()]
    .map(([name, interval]) => (interval === undefined ? name : `${name}:${interval}`))
    .join(",");
}
