// 与 demo.ts 功能一样，只是服务器换成 Hono。
//
// 关键点：needle 自己没有 hono 依赖。这个文件 import 的 hono 是"用的人自己装的"，
// 没装 Hono 的人继续用 examples/demo.ts，功能一模一样。
import { Hono } from "hono";
import { logo } from "@needle/logo";
import { createConsole } from "@needle/logo/console";
import { mountConsole, serveHono } from "@needle/logo/hono";
import { createFileSink, createLogFiles } from "@needle/logo/node";

logo.addSink(createFileSink({ dir: "logs" }));

const debug = createConsole({
  logger: logo,
  title: "demo-hono",
  basePath: "/console",
  auth: { users: { xmli: "123456" } },
  user: "local",
  logFiles: createLogFiles({ dir: "logs" }),
  commands: [
    {
      name: "hello",
      description: "打个招呼",
      run: ({ args }) => ({ ok: true, output: [{ kind: "text", text: `hi ${args.join(" ") || "there"}` }] }),
    },
  ],
});

const app = new Hono();
mountConsole(app, debug, { basePath: "/console" });
app.get("/health", (c) => c.json({ ok: true }));

const running = await serveHono(app, { port: 3030, hostname: "127.0.0.1" });
logo.info("demo-hono listening", { port: running.port, console: "/console" });
