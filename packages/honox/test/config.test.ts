import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEnv, assertRequired, coerceValue, createConfig, deepMerge, readPath } from "../src/config.js";
import { loadConfig } from "../src/node.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function configDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "honox-config-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }

  return dir;
}

describe("loadConfig：文件与环境", () => {
  test("common.yml 打底，app_<env>.yml 覆盖", () => {
    const dir = configDir({
      "common.yml": "auth:\n  secret: s1\nserver:\n  web_port: 3000\n",
      "app_dev.yml": "server:\n  web_port: 3001\n",
    });
    const config = loadConfig({ dir, env: "dev" });
    expect(config.getString("auth.secret")).toBe("s1");
    expect(config.getInt("server.web_port")).toBe(3001);
  });

  test("common.yml 可缺；app_<env>.yml 缺失报错带路径与 ENV", () => {
    const dir = configDir({ "app_dev.yml": "a: 1\n" });
    expect(loadConfig({ dir, env: "dev" }).getInt("a")).toBe(1);
    expect(() => loadConfig({ dir, env: "fat" })).toThrow(/app_fat\.yml[\s\S]*ENV=fat/);
  });

  // 空文件合法（环境文件可能只写差异项，甚至先建成空壳）；顶层不是对象必须报错。
  test("空 yml 当成空配置，顶层是数组要报错", () => {
    const dir = configDir({ "app_dev.yml": "" });
    expect(loadConfig({ dir, env: "dev" }).get("anything")).toBeUndefined();

    const bad = configDir({ "app_dev.yml": "- 1\n- 2\n" });
    expect(() => loadConfig({ dir: bad, env: "dev" })).toThrow(/配置顶层必须是对象/);
  });

  test("YAML 语法错误原样抛出，不被当成「文件缺失」吞掉", () => {
    const dir = configDir({ "app_dev.yml": "a: [1, 2\n" });
    expect(() => loadConfig({ dir, env: "dev" })).toThrow();
  });

  test("dir 默认是 <cwd>/config", () => {
    const previous = process.cwd();
    const base = configDir({});
    mkdirSync(join(base, "config"));
    writeFileSync(join(base, "config", "app_dev.yml"), "a: 1\n");
    process.chdir(base);
    try {
      expect(loadConfig({ env: "dev" }).getInt("a")).toBe(1);
    } finally {
      process.chdir(previous);
    }
  });

  test("env 大小写不敏感：DEV 读 app_dev.yml", () => {
    const dir = configDir({ "app_dev.yml": "a: 1\n" });
    expect(loadConfig({ dir, env: "DEV" }).getInt("a")).toBe(1);
  });

  test("ENV 只接受 dev / fat / pro", () => {
    const dir = configDir({ "app_uat.yml": "a: 1\n" });
    expect(() => loadConfig({ dir, env: "uat" })).toThrow(/ENV 只支持 dev \/ fat \/ pro：uat/);
  });

  test("env / isDev / isFat / isPro", () => {
    const dir = configDir({ "app_dev.yml": "", "app_fat.yml": "", "app_pro.yml": "" });
    const dev = loadConfig({ dir, env: "DEV" });
    expect([dev.env, dev.isDev(), dev.isFat(), dev.isPro()]).toEqual(["dev", true, false, false]);
    expect(loadConfig({ dir, env: "fat" }).isFat()).toBe(true);
    expect(loadConfig({ dir, env: "pro" }).isPro()).toBe(true);
  });

  test("深合并：对象递归、数组整体替换", () => {
    const dir = configDir({
      "common.yml": "list: [1, 2, 3]\nnested:\n  a: 1\n  b: 2\n",
      "app_dev.yml": "list: [9]\nnested:\n  b: 20\n  ctx: 30\n",
    });
    const config = loadConfig({ dir, env: "dev" });
    expect(config.get("list")).toEqual([9]);
    expect(config.get("nested")).toEqual({ a: 1, b: 20, ctx: 30 });
  });

  test("APP_* 环境变量覆盖嵌套字段并做类型转换", () => {
    const dir = configDir({
      "app_dev.yml": "auth:\n  secret: s1\nserver:\n  web_port: 3000\nfeature:\n  on: false\n",
    });
    const config = loadConfig({
      dir,
      env: "dev",
      envVars: { APP_SERVER__WEB_PORT: "9000", APP_FEATURE__ON: "true" },
    });
    expect(config.getInt("server.web_port")).toBe(9000);
    expect(config.getBool("feature.on")).toBe(true);
    expect(config.getString("auth.secret")).toBe("s1");
  });

  test("必填项缺失 / 为空字符串都报错", () => {
    const dir = configDir({ "app_dev.yml": "mongo:\n  uri: ''\n" });
    expect(() => loadConfig({ dir, env: "dev", required: ["mongo.uri"] })).toThrow(/mongo\.uri/);
    expect(() => loadConfig({ dir, env: "dev", required: ["auth.secret"] })).toThrow(/auth\.secret/);
  });

  test("空文件当 {}；顶层不是对象时报错", () => {
    const empty = configDir({ "app_dev.yml": "" });
    expect(loadConfig({ dir: empty, env: "dev" }).get("a")).toBeUndefined();
    const bad = configDir({ "app_dev.yml": "- 1\n- 2\n" });
    expect(() => loadConfig({ dir: bad, env: "dev" })).toThrow(/顶层必须是对象/);
  });
});

describe("Config 取值器", () => {
  function sample() {
    const dir = configDir({
      "app_dev.yml": [
        "server:",
        "  web_port: 8001",
        "  host: 0.0.0.0",
        "  shell_users:",
        "    xmli: 123456",
        "feature:",
        "  on: true",
        "empty: {}",
      ].join("\n"),
    });
    return loadConfig({ dir, env: "dev" });
  }

  test("getString / getInt / getBool 走点分路径", () => {
    const config = sample();
    expect(config.getString("server.host")).toBe("0.0.0.0");
    expect(config.getInt("server.web_port")).toBe(8001);
    expect(config.getBool("feature.on")).toBe(true);
  });

  test("数字也能当字符串取（viper 的 GetString 同口径）", () => {
    expect(sample().getString("server.web_port")).toBe("8001");
  });

  test("getStringMap 把 YAML 数字转成字符串", () => {
    expect(sample().getStringMap("server.shell_users")).toEqual({ xmli: "123456" });
  });

  test("缺值：给了 fallback 用它，没给就抛", () => {
    const config = sample();
    expect(config.getInt("server.missing", 3000)).toBe(3000);
    expect(config.getString("server.missing", "0.0.0.0")).toBe("0.0.0.0");
    expect(() => config.getInt("server.missing")).toThrow(/配置项不存在：server\.missing/);
  });

  test("类型不对时报错，消息带路径与原始值", () => {
    const config = sample();
    expect(() => config.getInt("server.host")).toThrow(/配置项 server\.host 类型不对/);
    expect(() => config.getBool("server.web_port")).toThrow(/配置项 server\.web_port 类型不对/);
    expect(() => config.getStringMap("server.host")).toThrow(/不是 key→value 映射/);
  });

  test("getStringMap 缺省给 {}；has 区分有值 / 没值", () => {
    const config = sample();
    expect(config.getStringMap("server.missing")).toEqual({});
    expect(config.has("server.host")).toBe(true);
    expect(config.has("server.missing")).toBe(false);
    expect(config.has("empty")).toBe(true);
  });

  test("raw() 返回合并后的裸数据", () => {
    expect(sample().raw().server).toEqual({
      web_port: 8001,
      host: "0.0.0.0",
      shell_users: { xmli: 123456 },
    });
  });
});

describe("配置工具函数（被 loadConfig 间接用到，也单独钉住）", () => {
  test("coerceValue：true/false/数字/普通字符串", () => {
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("false")).toBe(false);
    expect(coerceValue(" 42 ")).toBe(42);
    expect(coerceValue("1.5")).toBe(1.5);
    expect(coerceValue("  hello  ")).toBe("  hello  ");
    expect(coerceValue("")).toBe("");
    expect(coerceValue("0")).toBe(0);
  });

  test("deepMerge：对象递归、数组整体替换、不改入参", () => {
    const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] };
    const merged = deepMerge(base, { nested: { y: 20 }, list: [9] });
    expect(merged).toEqual({ a: 1, nested: { x: 1, y: 20 }, list: [9] });
    expect(base).toEqual({ a: 1, nested: { x: 1, y: 2 }, list: [1, 2] });
  });

  test("applyEnv：只认前缀、__ 分层、跳过空名与非字符串", () => {
    const applied = applyEnv(
      { a: 1 },
      { APP_X__Y: "2", OTHER: "3", APP_: "ignored", APP_Z: undefined },
      "APP_",
    );
    expect(applied).toEqual({ a: 1, x: { y: 2 }, z: undefined });
    expect(applied).not.toHaveProperty("other");
  });

  // setPath 会往嵌套对象里写。浅拷贝时 `base.auth.secret` 会被就地改掉，
  // 而 deepMerge 的注释承诺「不改入参」。
  test("applyEnv：不修改传入的 base（深拷贝）", () => {
    const base = { auth: { secret: "a" }, list: [{ x: 1 }] };
    const applied = applyEnv(base, { APP_AUTH__SECRET: "b" }, "APP_");

    expect(applied).toEqual({ auth: { secret: "b" }, list: [{ x: 1 }] });
    expect(base).toEqual({ auth: { secret: "a" }, list: [{ x: 1 }] });
    expect(applied.auth).not.toBe(base.auth);
  });

  test("readPath：深路径、缺失、穿过数组/非对象", () => {
    const data = { a: { b: { ctx: 1 } }, list: [1, 2] };
    expect(readPath(data, "a.b.ctx")).toBe(1);
    expect(readPath(data, "a.b.missing")).toBeUndefined();
    expect(readPath(data, "list.length")).toBeUndefined();
    expect(readPath(data, "a.b.ctx.d")).toBeUndefined();
  });

  test("assertRequired：缺失、空串、null、嵌套路径", () => {
    expect(() => assertRequired({ a: { b: null } }, ["a.b"])).toThrow(/a\.b/);
    expect(() => assertRequired({ a: { b: "  " } }, ["a.b"])).not.toThrow();
    expect(() => assertRequired({ a: 1 }, ["a.b.ctx"])).toThrow(/a\.b\.ctx/);
  });

  test("createConfig：取值转换、truncate、异常与 raw", () => {
    const config = createConfig({ n: 3.9, s: 42, b: "true", map: { a: 1 } }, "dev");
    expect(config.getInt("n")).toBe(3);
    expect(config.getString("s")).toBe("42");
    expect(config.getBool("b")).toBe(true);
    expect(config.getStringMap("map")).toEqual({ a: "1" });
    expect(config.getStringMap("missing")).toEqual({});
    expect(() => config.getInt("b")).toThrow(/类型不对/);
    expect(() => config.getBool("n")).toThrow(/类型不对/);
    expect(config.raw()).toEqual({ n: 3.9, s: 42, b: "true", map: { a: 1 } });
  });

  test("loadConfig 默认 env=dev、默认 dir 生效", () => {
    const dir = configDir({ "app_dev.yml": "a: 1\n" });
    expect(loadConfig({ dir }).env).toBe("dev");
    expect(loadConfig({ dir }).getInt("a")).toBe(1);
  });
});

describe("取值与合并的边界", () => {
  test("isPlainObject：数组与 null 都不算对象", () => {
    expect(deepMerge({ a: [1] }, { a: [2] })).toEqual({ a: [2] });
    expect(deepMerge({ a: { x: 1 } }, { a: 2 })).toEqual({ a: 2 });
    expect(deepMerge({ a: 2 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
  });

  test("coerceValue：纯空白原样返回，数字带空白仍能转", () => {
    expect(coerceValue("   ")).toBe("   ");
    expect(coerceValue(" 42 ")).toBe(42);
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("false")).toBe(false);
    expect(coerceValue("abc")).toBe("abc");
    expect(coerceValue("")).toBe("");
  });

  test("assertRequired：中间层是数组 / null / 非对象都算缺失", () => {
    expect(() => assertRequired({ a: [1] }, ["a.b"])).toThrow(/a\.b/);
    expect(() => assertRequired({ a: null }, ["a.b"])).toThrow(/a\.b/);
    expect(() => assertRequired({ a: 1 }, ["a.b"])).toThrow(/a\.b/);
  });

  test("assertRequired：只有 undefined / null / 空串算缺失，0 与 false 是有效值", () => {
    expect(() => assertRequired({ a: 0, b: false }, ["a", "b"])).not.toThrow();
    expect(() => assertRequired({ a: "" }, ["a"])).toThrow(/a/);
    expect(() => assertRequired({ a: null }, ["a"])).toThrow(/a/);
  });

  test("readPath：穿过数组 / null / 标量一律 undefined", () => {
    expect(readPath({ a: [1, 2] }, "a.0")).toBeUndefined();
    expect(readPath({ a: null }, "a.b")).toBeUndefined();
    expect(readPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(readPath({ a: { b: 0 } }, "a.b")).toBe(0);
  });

  test("isDev / isFat / isPro 只在对应环境为真", () => {
    const dev = createConfig({}, "dev");
    const fat = createConfig({}, "fat");
    const pro = createConfig({}, "pro");
    expect([dev.isDev(), fat.isFat(), pro.isPro()]).toEqual([true, true, true]);
    expect([dev.isFat(), dev.isPro(), fat.isDev(), pro.isDev()]).toEqual([false, false, false, false]);
  });

  test("getString：数字与布尔转字符串，对象给兜底", () => {
    const config = createConfig({ n: 42, b: true, o: { x: 1 } }, "dev");
    expect(config.getString("n")).toBe("42");
    expect(config.getString("b")).toBe("true");
    // 类型不对是配置错误，不静默兜底（兜底只用于「没配」）。
    expect(() => config.getString("o")).toThrow(/类型不对/);
  });

  test("getInt：截断小数、字符串数字、空白与非数字给兜底", () => {
    const config = createConfig({ a: 3.9, b: "42", c: "   ", d: "abc", e: [1] }, "dev");
    expect(config.getInt("a")).toBe(3);
    expect(config.getInt("b")).toBe(42);
    expect(() => config.getInt("c")).toThrow(/类型不对/);
    expect(() => config.getInt("d")).toThrow(/类型不对/);
    expect(() => config.getInt("e")).toThrow(/类型不对/);
    // 没配才走兜底。
    expect(config.getInt("missing", 7)).toBe(7);
  });

  test("getBool：布尔原样，只认字符串 true / false", () => {
    const config = createConfig({ a: true, b: "true", c: "false", d: 1, e: "0", f: false }, "dev");
    expect(config.getBool("a")).toBe(true);
    expect(config.getBool("b")).toBe(true);
    expect(config.getBool("c")).toBe(false);
    expect(config.getBool("f")).toBe(false);
    expect(() => config.getBool("d")).toThrow(/类型不对/);
    expect(() => config.getBool("e")).toThrow(/类型不对/);
    expect(config.getBool("missing", true)).toBe(true);
  });

  test("getStringMap：非映射报错，缺失给空对象", () => {
    const config = createConfig({ ok: { a: "1" }, bad: [1], nul: null }, "dev");
    expect(config.getStringMap("ok")).toEqual({ a: "1" });
    expect(config.getStringMap("missing")).toEqual({});
    expect(() => config.getStringMap("bad")).toThrow(/不是 key→value 映射/);
    expect(() => config.getStringMap("nul")).toThrow(/不是 key→value 映射/);
  });

  test("取值不存在时抛 path 明确的错误", () => {
    const config = createConfig({ a: {} }, "dev");
    expect(() => config.getInt("a.missing")).toThrow(/配置项不存在：a\.missing/);
  });
});
