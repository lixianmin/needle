// 生成物（schema + registerModel）。它只 import 本文件的类型，运行时无环：
// 谁 import 这个 bean 文件，谁就顺带把 schema 注册好了，不需要额外的 barrel。
import "./bots.generated.js";

/**
 * `/bots` 的请求模型。手写 class 是唯一真值：`bots.generated.ts` 由
 * `scripts/gen-models.ts` 从这些字段生成 TypeBox schema，业务代码里不出现 DSL。
 *
 * 字段必须有类型标注；class 里不要写方法（它不是 DTO 的实例，只是模型形状）。
 */
export class BotsQuery {
  id?: number;
}

export class BotsBody {
  ids: number[] = [];
}
