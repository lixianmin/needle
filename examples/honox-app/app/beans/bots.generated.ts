// 由 scripts/gen-models.ts 生成，勿手改。
import { Type, type Static } from "@sinclair/typebox";
import { registerModel } from "@needle/honox";
import type { BotsQuery, BotsBody } from "./bots.js";

export const BotsQuerySchema = Type.Object({
  id: Type.Optional(Type.Number()),
}, { additionalProperties: false });

export const BotsBodySchema = Type.Object({
  ids: Type.Array(Type.Number()),
}, { additionalProperties: false });

// 漂移断言：class 改了没重新生成，tsc 会在这里报错。
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type _BotsQueryInSync = Assert<Equals<Static<typeof BotsQuerySchema>, BotsQuery>>;
type _BotsBodyInSync = Assert<Equals<Static<typeof BotsBodySchema>, BotsBody>>;

// 按类名注册，路由那边 modelSchema(Model) 查得到。
registerModel("BotsQuery", BotsQuerySchema);
registerModel("BotsBody", BotsBodySchema);
