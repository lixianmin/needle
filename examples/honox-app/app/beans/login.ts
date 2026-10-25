// 生成物（schema + registerModel）。它只 import 本文件的类型，运行时无环：
// 谁 import 这个 bean 文件，谁就顺带把 schema 注册好了，不需要额外的 barrel。
import "./login.generated.js";

/**
 * `/login` 的请求体模型。手写 class 是唯一真值：`login.generated.ts` 由
 * `scripts/gen-models.ts` 从这些字段生成 TypeBox schema，业务代码里不出现 DSL。
 *
 * `uid` 可选：mock 登录不校验身份，不给就签 `mock-user`。接真登录时这里换成
 * `{ user, password }` 即可，路由形状不用改。
 */
export class LoginBody {
  uid?: string;
}
