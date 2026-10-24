import { createApi } from "@needle/honox";

export const homeApi = createApi();

homeApi.get("/", (c) =>
  c.text("honox-app: GET /health、GET /me、GET /bots?id=、GET /apc?id=、GET /select-apc"),
);
