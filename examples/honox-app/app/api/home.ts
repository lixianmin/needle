import { Hono } from "hono";

export const homeApi = new Hono();

homeApi.get("/", (c) =>
  c.text("honox-app: GET /health、GET /me、GET /bots?id=、GET /apc?id=、GET /select-apc"),
);
