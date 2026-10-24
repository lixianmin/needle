import { Hono } from "hono";
import { apiRoute } from "@needle/honox";

export const homeApi = new Hono();

homeApi.get(
  "/",
  apiRoute((c) =>
    c.text("honox-app: GET /health、GET /me、GET /bots?id=、GET /apc?id=、GET /select-apc"),
  ),
);
