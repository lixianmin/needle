import { metadata } from "./index.js";

/**
 * 机器人模板。类就是 schema：字段默认值决定类型，数组默认值（`[]`）表示该列
 * 按 `|` 拆；sheet 名默认取类名。
 */
export class BotTemplate {
  id = 0;
  name = "";
  prompt = "";
}

const templates = metadata.template(BotTemplate);

export function getBotTemplate(id: number): BotTemplate | undefined {
  return templates.get(id);
}

export function getBotTemplates(): readonly BotTemplate[] {
  return templates.all();
}
