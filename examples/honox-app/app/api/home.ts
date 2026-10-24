import { api } from "@needle/honox";

export const homeApi = api("/", (c) =>
  c.text("honox-app: GET /health、GET /me、GET /bots?id=、GET /apc?id=、GET /select-apc"),
);
