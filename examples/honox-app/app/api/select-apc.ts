import { api } from "@needle/honox";
import { getSelectApcConfig } from "../md/select-apc-config";

/** Config 类型：全局一份，没有 id。 */
export const selectApcApi = api("/select-apc", (c) => c.json(getSelectApcConfig()));
