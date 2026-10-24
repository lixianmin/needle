import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getSelectApcConfig } from "../md/select-apc-config";

export const selectApcApi = new Hono<AppEnv>();

/** Config 类型：全局一份，没有 id。 */
selectApcApi.get("/select-apc", (c) => c.json(getSelectApcConfig()));
