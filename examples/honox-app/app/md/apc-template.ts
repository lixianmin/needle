import { metadata } from "./index";

/** 玩家（APC）模板。 */
export type ApcTemplate = {
  id: number;
  /** `|` 分隔的装备 id 串，0 表示该槽位空；保留原始字符串，拆分交给业务。 */
  equips: string;
  gender: number;
  name: string;
  buy_money: number;
  buy_price: number;
};

export const apcTemplate = metadata.template<ApcTemplate>("ApcTemplate");

export function getApcTemplate(id: number): ApcTemplate | undefined {
  return apcTemplate.get(id);
}
