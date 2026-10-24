import { metadata } from "./index.js";

/** 候选 APC 配置：全局一份，每个字段按 `|` 拆成候选 id 数组。 */
export class SelectApcConfig {
  select_apc1: string[] = [];
  select_apc2: string[] = [];
  select_apc3: string[] = [];
  select_apc4: string[] = [];
}

const config = metadata.config(SelectApcConfig);

export function getSelectApcConfig(): SelectApcConfig {
  return config.get();
}
