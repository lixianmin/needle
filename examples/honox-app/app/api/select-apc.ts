import { Hono } from "hono";
import { apiRoute } from "@needle/honox";
import { getSelectApcConfig } from "../md/select-apc-config";

export const selectApcApi = new Hono();

/** Config 类型：全局一份，没有 id。 */
selectApcApi.get("/select-apc", apiRoute((c) => c.json(getSelectApcConfig())));
