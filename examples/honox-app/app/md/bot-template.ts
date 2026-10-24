import { defineSheet } from "@needle/honox/excel";

/**
 * 机器人模板。
 * 用 type 不用 interface：defineSheet 的约束是 Record<string, unknown>，
 * interface 没有隐式索引签名，TS 7 会报 TS2344。
 */
export type BotTemplate = {
  id: number;
  name: string;
  prompt: string;
};

/** id → 名字与人格提示词。 */
export const botTemplate = defineSheet<BotTemplate>({
  file: "res/metadata/BotTemplate.xlsx",
  sheet: "BotTemplate",
});

export function getBotTemplate(id: number): BotTemplate | undefined {
  return botTemplate.get(id);
}
