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
