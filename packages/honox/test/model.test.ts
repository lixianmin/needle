import { beforeEach, describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { clearModels, modelSchema, registerModel } from "../src/model.js";

describe("model 注册表", () => {
  beforeEach(() => {
    clearModels();
  });

  test("按类名注册与查找", () => {
    class BotsBody {
      ids: number[] = [];
    }
    const schema = Type.Object({ ids: Type.Array(Type.Number()) });
    registerModel("BotsBody", schema);
    expect(modelSchema(BotsBody)).toBe(schema);
  });

  test("同名注册不同 schema：抛错，不静默顶掉", () => {
    const first = Type.Object({ a: Type.Number() });
    const second = Type.Object({ b: Type.String() });
    registerModel("Body", first);
    // 同一个 schema 重复注册（模块被再次求值）无害
    registerModel("Body", first);
    expect(() => registerModel("Body", second)).toThrow(/模型重名：Body/);
  });

  test("没注册时报出类名与修复提示", () => {
    class Unknown {
      a: number = 0;
    }
    expect(() => modelSchema(Unknown)).toThrow(/没有为 Unknown 注册 schema/);
    expect(() => modelSchema(Unknown)).toThrow(/先 import 那个 bean 文件/);
  });
});
