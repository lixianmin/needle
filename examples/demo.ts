/**
 * 本地演示：`bun examples/demo.ts`
 *
 * 打开 http://127.0.0.1:1234/shell
 * 登录：xmli / 123456
 *
 * 页面每隔一秒会收到一条 heartbeat，用来确认 SSE 是活的。
 */
import { readFileSync } from "node:fs";

import { createShell, table } from "../src/shell/index.js";
import { CommandError } from "../src/shell/commands.js";
import { logo } from "../src/index.js";
import { createFileSink, createLogFiles, serve } from "../src/node/index.js";

// 版本号的唯一来源是包的 package.json（AGENTS.md §14），别在这里硬编码。
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const LOG_DIR = "logs";
logo.addSink(createFileSink({ dir: LOG_DIR, maxBytes: 5 * 1024 * 1024 }));

const PORT = Number(process.env.PORT ?? 1234);

/** 命令行参数转成条数：非法值退回 20，上限 10 万（再多页面也扛不住）。 */
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(Math.max(1, Math.trunc(value)), 100_000);
}

/** 假装是业务状态，用来演示"命令能读到进程内部"。 */
const rooms = new Map<string, Record<string, unknown>>([
  ["101", { players: 3, owner: "alice", started: true }],
  ["102", { players: 0, owner: "bob", started: false }],
]);

const roomsTable = table<{ id: string; state: string }>({ id: {}, state: {} });

// formats 声明列语义：bytes 走 toHuman，number 不缩写
const ioTable = table<{ path: string; reads: number; bytes: number; hitRate: number }>({
  path: {},
  reads: { format: "number" },
  bytes: { format: "bytes" },
  hitRate: { format: "number" },
});

const shell = createShell({
  logger: logo,
  basePath: "/shell",
  title: "Needle",
  logFiles: createLogFiles({ dir: LOG_DIR }),
  version: pkg.version,
  auth: { users: { xmli: "123456" }, secret: process.env.DBG_SECRET ?? "demo-secret" },
  commands: [
    {
      name: "room",
      note: "查看房间状态",
      args: "[id]",
      run: ({ args }) => {
        const id = args[0];
        return roomsTable.output(
          [...rooms.entries()]
            .filter(([key]) => id === undefined || key === id)
            .map(([key, value]) => ({ id: key, state: JSON.stringify(value) })),
        );
      },
    },
    {
      name: "boom",
      note: "故意抛错，验证 warn/error 立即落盘",
      run: () => {
        logo.info("这条 info 应该抢在 error 之前被写出去");
        throw new CommandError("故意炸的：看服务端 stderr 的先后顺序");
      },
    },
    {
      name: "io",
      note: "演示表格排序与人话数字（点表头可排序）",
      run: () =>
        ioTable.output([
          { path: "/api/user", reads: 1520, bytes: 3_600_000, hitRate: 0.982 },
          { path: "/api/room", reads: 84231, bytes: 128 * 1024 * 1024, hitRate: 0.913 },
          { path: "/health", reads: 12, bytes: 512, hitRate: 1 },
        ]),
    },
    {
      name: "burst",
      note: "连写 n 条日志，每 7 条一个 warn、每 17 条一个 error",
      args: "[n]",
      run: ({ args }) => {
        const count = clamp(Number(args[0] ?? 20));
        for (let i = 1; i <= count; i += 1) {
          const line = `burst #${i}/${count}`;
          // 三种级别混着写：右栏能看出着色，也能看出 warn / error 是立刻刷的。
          if (i % 17 === 0) logo.error(line);
          else if (i % 7 === 0) logo.warn(line);
          else logo.info(line);
        }
        return { kind: "text", text: `已写 ${count} 条：${Math.floor(count / 7)} 条 warn、${Math.floor(count / 17)} 条 error` };
      },
    },
    {
      name: "slow",
      note: "睡 12 秒，验证命令超时（默认 10 秒）",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        return { kind: "text", text: "居然没超时" };
      },
    },
  ],
});

const server = await serve(async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/" || pathname.startsWith("/shell")) return shell.handler(req);
  return new Response("这是你的业务服务。控制台在 /shell\n");
}, { port: PORT });

console.log(`控制台: http://127.0.0.1:${server.port}/shell`);
console.log("账号:   xmli / 123456");
console.log("试试:   auth xmli → 密码 123456 → log.list · top · room · io · burst · boom · slow");
console.log("订阅:   sub top 2000 · unsub top");

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    logo.info("收到退出信号，flush 后退出");
    // 顺序很重要：先冲日志，再关连接。
    logo.dispose();
    void server.close().then(() => process.exit(0));
  });
}
