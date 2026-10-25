// 生成物（schema + registerModel）。它只 import 本文件的类型，运行时无环：
// 谁 import 这个 bean 文件，谁就顺带把 schema 注册好了，不需要额外的 barrel。
import "./login.generated.js";

/**
 * `/login` 的请求体模型。手写 class 是唯一真值：`login.generated.ts` 由
 * `scripts/gen-models.ts` 从这些字段生成 TypeBox schema，业务代码里不出现 DSL。
 *
 * `passcode` 是 `sha256hex(盐 + 明文密码)`，不是密码本身：明文密码不出浏览器。
 * 服务端按用户名查记录，用同一份盐重算并比对。两个字段都必填——缺了就是
 * schema 校验的 400，不会走到「没给密码所以放行」这种分支。
 */
export class LoginBody {
  user: string = "";
  passcode: string = "";
}
