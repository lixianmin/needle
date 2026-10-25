// 由 scripts/gen-models.ts 生成，勿手改。
import { Type, type Static } from "@sinclair/typebox";
import { registerModel } from "@needle/honox";
import type { LoginBody } from "./login.js";

export const LoginBodySchema = Type.Object({
  uid: Type.Optional(Type.String()),
}, { additionalProperties: false });

// 漂移断言：class 改了没重新生成，tsc 会在这里报错。
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type _LoginBodyInSync = Assert<Equals<Static<typeof LoginBodySchema>, LoginBody>>;

// 按类名注册，路由那边 modelSchema(Model) 查得到。
registerModel("LoginBody", LoginBodySchema);
