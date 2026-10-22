/**
 * 本地演示：`bun examples/demo.ts`
 *
 * 打开 http://127.0.0.1:1234/console
 * 登录：xmli / 123456
 *
 * 页面每隔一秒会收到一条 heartbeat，用来确认 SSE 是活的。
 */
import { createConsole } from "../src/console/index.js";
import { CommandError } from "../src/console/commands.js";
import { logo } from "../src/core/index.js";
import { serve } from "../src/node/index.js";

const PORT = Number(process.env.PORT ?? 1234);

/** 假装是业务状态，用来演示"命令能读到进程内部"。 */
const rooms = new Map<string, Record<string, unknown>>([
  ["101", { players: 3, owner: "alice", started: true }],
  ["102", { players: 0, owner: "bob", started: false }],
]);

const debug = createConsole({
  logger: logo,
  basePath: "/console",
  version: "0.1.0",
  topicSpec: "top:2000",
  auth: { users: { xmli: "123456" }, secret: process.env.DBG_SECRET ?? "demo-secret" },
  commands: [
    {
      name: "room",
      note: "查看房间状态",
      args: "[id]",
      run: ({ args }) => {
        const id = args[0];
        const rows = [...rooms.entries()]
          .filter(([key]) => id === undefined || key === id)
          .map(([key, value]) => [key, JSON.stringify(value)]);
        return { kind: "table", columns: ["id", "state"], rows };
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
      name: "slow",
      note: "睡 12 秒，验证命令超时（默认 10 秒）",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        return { kind: "text", text: "居然没超时" };
      },
    },
  ],
});

// 周期性业务日志：页面上会看到它持续滚动。
const timer = setInterval(() => {
  logo.info("heartbeat", { rooms: rooms.size, pending: Math.round(Math.random() * 10) });
}, 1000);

const server = await serve((req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/" || pathname.startsWith("/console")) return debug.handler(req);
  return new Response("这是你的业务服务。控制台在 /console\n");
}, { port: PORT });

console.log(`控制台: http://127.0.0.1:${server.port}/console`);
console.log("账号:   xmli / 123456");
console.log("试试:   logs 20 · ps · room · boom · slow");

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    logo.info("收到退出信号，flush 后退出");
    // 顺序很重要：先冲日志，再关连接。
    logo.dispose();
    void server.close().then(() => process.exit(0));
  });
}
