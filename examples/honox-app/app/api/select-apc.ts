import { createApi } from "@needle/honox";
import { getSelectApcConfig } from "../md/select-apc-config";

export const selectApcApi = createApi();

/** Config 类型：全局一份，没有 id。 */
selectApcApi.get("/select-apc", (c) => c.json(getSelectApcConfig()));
