import { metadata } from "./index";

/** 玩家（APC）模板。数组字段 `equips` 会被库按 `|` 拆成 string[]。 */
export class ApcTemplate {
  id = 0;
  /** 装备位：数组下标就是槽位号，`"0"` 表示该槽位没装备。 */
  equips: string[] = [];
  gender = 0;
  name = "";
  buy_money = 0;
  buy_price = 0;
}

const templates = metadata.template(ApcTemplate);

export function getApcTemplate(id: number): ApcTemplate | undefined {
  return templates.get(id);
}

export function getApcTemplates(): readonly ApcTemplate[] {
  return templates.all();
}
