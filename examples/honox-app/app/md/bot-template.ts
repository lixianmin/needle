import { metadata } from "./index";

/**
 * 机器人模板。
 * 用 type 不用 interface：泛型约束是 Record<string, unknown>，
 * interface 没有隐式索引签名，TS 7 会报 TS2344。
 */
export type BotTemplate = {
  id: number;
  name: string;
  prompt: string;
};

/** 第一层 key 就是 sheet 名，文件名/所在 xlsx 由启动扫描决定，这里不写。 */
export const botTemplate = metadata.template<BotTemplate>("BotTemplate");

export function getBotTemplate(id: number): BotTemplate | undefined {
  return botTemplate.get(id);
}
