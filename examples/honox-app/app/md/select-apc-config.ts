import { metadata } from "./index";

/** 候选 APC 配置：全局一份，每个字段是 `|` 分隔的候选 id 串，库拆成 string[]。 */
export type SelectApcConfig = {
  select_apc1: string[];
  select_apc2: string[];
  select_apc3: string[];
  select_apc4: string[];
};

export const selectApcConfig = metadata.config<SelectApcConfig>("SelectApcConfig", {
  split: ["select_apc1", "select_apc2", "select_apc3", "select_apc4"],
});

export function getSelectApcConfig(): SelectApcConfig {
  return selectApcConfig.get();
}
