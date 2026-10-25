import { describe, expect, test } from "bun:test";
import { Hono, type Context } from "hono";
import { Type } from "@sinclair/typebox";
import { parseBody, parseQuery } from "../src/parse.js";
import { RequestError, isRequestError } from "../src/request.js";
import type { HonoxEnv } from "../src/types.js";

/** 在真路由里跑一次解析，拿到值或抛出来的错误——Context 不手搓。 */
async function attempt<T>(
  path: string,
  init: RequestInit | undefined,
  parse: (c: Context<HonoxEnv>) => T,
): Promise<{ value: T; error?: undefined } | { value?: undefined; error: unknown }> {
  let outcome: { value: T; error?: undefined } | { value?: undefined; error: unknown } = {
    value: undefined as T,
  };
  const app = new Hono<HonoxEnv>();
  app.all("*", async (c) => {
    try {
      outcome = { value: await parse(c) };
    } catch (error) {
      outcome = { error };
    }
    return c.text("ok");
  });
  await app.request(path, init);
  return outcome;
}

function jsonInit(payload: unknown): RequestInit {
  return {
    method: "POST",
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  };
}

async function parseBodyOf(schema: Parameters<typeof parseBody>[1], payload: unknown) {
  return attempt("/x", jsonInit(payload), (c) => parseBody(c, schema));
}

async function parseQueryOf(schema: Parameters<typeof parseQuery>[1], path: string) {
  return attempt(path, undefined, (c) => parseQuery(c, schema));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const BotsBody = Type.Object({
  ids: Type.Array(Type.Number()),
  page: Type.Number({ default: 1 }),
});

describe("parseBody", () => {
  test("合法 body 返回对象并补默认值", async () => {
    const { value } = await parseBodyOf(BotsBody, { ids: [1, 2] });
    expect(value).toMatchObject({ ids: [1, 2], page: 1 });
  });

  test("字符串数字被拒（不做类型转换）", async () => {
    const { error } = await parseBodyOf(BotsBody, { ids: ["1"] });
    // 单条错误不加「另有 N 处」，位置直接写 /ids/0，不是空路径的 /
    expect(messageOf(error)).toBe("body /ids/0 Expected number");
  });

  test("多处错误只留摘要，其余报数量", async () => {
    const { error } = await parseBodyOf(BotsBody, { ids: ["1", "2"] });
    expect(messageOf(error)).toBe("body /ids/0 Expected number（另有 1 处）");
  });

  test("根路径的错误位置渲染成 /", async () => {
    // body 本身类型不对时 TypeBox 给的 path 是空串，直接拼进 message 会变成 "body  Expected object"
    const { error } = await parseBodyOf(BotsBody, null);
    expect(messageOf(error)).toBe("body / Expected object");
  });

  test("body 是标量（不是对象）时也走 400，不是崩在补默认值上", async () => {
    const { error } = await parseBodyOf(BotsBody, 5);
    expect(error).toMatchObject({ status: 400, code: "bad_request" });
  });

  test("不是合法 JSON", async () => {
    const { error } = await parseBodyOf(BotsBody, "not json");
    expect(messageOf(error)).toContain("body 不是合法 JSON");
    expect(error).toMatchObject({ status: 400, code: "bad_request" });
  });

  test("body 已经被读过：原样抛错，不当成 400", async () => {
    const app = new Hono<HonoxEnv>();
    let caught: unknown;
    app.post("/x", async (c) => {
      await c.req.raw.text(); // 典型场景：签名校验先把原始流读走
      try {
        await parseBody(c, BotsBody);
      } catch (error) {
        caught = error;
      }
      return c.text("ok");
    });
    await app.request("/x", jsonInit({ ids: [1] }));

    // 接线错误必须冒出来（会被记成 500 + error 日志）；当成 400 就彻底隐身了。
    expect(caught).toBeInstanceOf(Error);
    expect(isRequestError(caught)).toBe(false);
  });

  test("多余字段被拒（schema 带 additionalProperties: false）", async () => {
    const strict = Type.Object({ a: Type.Number() }, { additionalProperties: false });
    const { error } = await parseBodyOf(strict, { a: 1, b: 2 });
    expect(messageOf(error)).toContain("Unexpected property");
  });
});

describe("parseQuery", () => {
  const Query = Type.Object({
    id: Type.Optional(Type.Number()),
    ids: Type.Optional(Type.Array(Type.Number())),
  });

  test("字符串数字转换；重复键按数组收集", async () => {
    const { value } = await parseQueryOf(Query, "/x?id=7&ids=1&ids=2");
    expect(value).toMatchObject({ id: 7, ids: [1, 2] });
  });

  test("空串视为未传", async () => {
    const { value } = await parseQueryOf(Query, "/x?id=");
    // 断言整个对象为空：`{id: undefined}` 能骗过 toHaveProperty / toMatchObject，toStrictEqual 不忽略 undefined 键
    expect(value).toStrictEqual({});
  });

  test("schema 外的键直接丢掉，strict schema 也不报错", async () => {
    const strict = Type.Object({ id: Type.Optional(Type.Number()) }, { additionalProperties: false });
    const { value, error } = await parseQueryOf(strict, "/x?id=1&_t=99");
    expect(error).toBeUndefined();
    expect(value).toEqual({ id: 1 });
  });

  test("query 的默认值也补上", async () => {
    const paged = Type.Object({ page: Type.Number({ default: 1 }) });
    const { value } = await parseQueryOf(paged, "/x");
    expect(value).toEqual({ page: 1 });
  });

  test("非法值报错", async () => {
    const { error } = await parseQueryOf(Query, "/x?id=abc");
    expect(messageOf(error)).toContain("query /id Expected number");
  });

  test("多余的键被忽略", async () => {
    const { value } = await parseQueryOf(Query, "/x?id=1&_t=99");
    expect(value).toMatchObject({ id: 1 });
  });
});

describe("RequestError", () => {
  test("默认 400 / bad_request；完整形态保留 status 与 code", () => {
    expect(new RequestError("x")).toMatchObject({ status: 400, code: "bad_request", message: "x" });
    expect(new RequestError(409, "conflict", "y")).toMatchObject({ status: 409, code: "conflict" });
  });

  test("name 是 RequestError：栈里要能认出来", () => {
    expect(new RequestError("x").name).toBe("RequestError");
  });

  test("isRequestError 只认自己", () => {
    expect(isRequestError(new RequestError("x"))).toBe(true);
    expect(isRequestError(new Error("x"))).toBe(false);
    expect(isRequestError("x")).toBe(false);
  });
});
