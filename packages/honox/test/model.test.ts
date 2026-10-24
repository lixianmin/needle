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

  test("没注册时报出类名与修复提示", () => {
    class Unknown {
      a: number = 0;
    }
    expect(() => modelSchema(Unknown)).toThrow(/没有为 Unknown 注册 schema/);
    expect(() => modelSchema(Unknown)).toThrow(/先 import 那个 bean 文件/);
  });
});
