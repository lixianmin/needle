import { createHonox } from "@needle/honox";
import { loadSheets } from "@needle/honox/excel";
import { loadConfig } from "@needle/honox/node";
import { createApp } from "honox/server";
import { planSheet } from "./lib/plans";

const config = loadConfig<{ auth: { secret: string }; server?: { port?: number } }>({
  required: ["auth.secret"],
});

// hucre 只能异步读：预载一次，之后 getter 同步、零 IO。
await loadSheets([planSheet]);

const app = createApp({
  app: createHonox({
    config,
    auth: { secret: config.auth.secret, public: ["/health"] },
    shell: {
      basePath: "/shell",
      auth: { users: { admin: process.env.SHELL_PASSWORD ?? "local" } },
      title: "honox-app",
      version: "0.1.0",
    },
  }),
});

export default app;
