import { defineSheet } from "@needle/honox/excel";

/** 机器人模板：id → 名字与人格提示词。 */
export const botSheet = defineSheet<{ id: number; name: string; prompt: string }>({
  file: "res/metadata/BotTemplate.xlsx",
  sheet: "BotTemplate",
});

/**
 * 玩家（APC）模板。
 * `equips` 是 `|` 分隔的装备 id 串，0 表示该槽位空；保留原始字符串，拆分交给业务。
 */
export const apcSheet = defineSheet<{
  id: number;
  equips: string;
  gender: number;
  name: string;
  buy_money: number;
  buy_price: number;
}>({
  file: "res/metadata/ApcTemplate.xlsx",
  sheet: "ApcTemplate",
});
