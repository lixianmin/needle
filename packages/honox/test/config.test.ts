import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@needle/honox/node";

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

describe("loadConfig", () => {
  test("common.yml 打底，app_<env>.yml 覆盖", () => {
    const dir = configDir({
      "common.yml": "auth:\n  secret: s1\nserver:\n  port: 3000\n",
      "app_dev.yml": "server:\n  port: 3001\n",
    });
    const c = loadConfig<{ auth: { secret: string }; server: { port: number } }>({ dir, env: "dev" });
    expect(c.auth.secret).toBe("s1");
    expect(c.server.port).toBe(3001);
  });

  test("common.yml 可缺；app_<env>.yml 缺失报错带路径与 ENV", () => {
    const dir = configDir({ "app_dev.yml": "a: 1\n" });
    expect(loadConfig({ dir, env: "dev" })).toEqual({ a: 1 });
    expect(() => loadConfig({ dir, env: "uat" })).toThrow(/app_uat\.yml[\s\S]*ENV=uat/);
  });

  test("env 大小写不敏感：ENV=DEV 读 app_dev.yml", () => {
    const dir = configDir({ "app_dev.yml": "a: 1\n" });
    expect(loadConfig({ dir, env: "DEV" })).toEqual({ a: 1 });
  });

  test("深合并：对象递归、数组整体替换", () => {
    const dir = configDir({
      "common.yml": "list: [1, 2, 3]\nnested:\n  a: 1\n  b: 2\n",
      "app_dev.yml": "list: [9]\nnested:\n  b: 20\n  c: 30\n",
    });
    const c = loadConfig<Record<string, any>>({ dir, env: "dev" });
    expect(c.list).toEqual([9]);
    expect(c.nested).toEqual({ a: 1, b: 20, c: 30 });
  });

  test("APP_* 环境变量覆盖嵌套字段并做类型转换", () => {
    const dir = configDir({
      "app_dev.yml": "auth:\n  secret: s1\nserver:\n  port: 3000\nfeature:\n  on: false\n",
    });
    const c = loadConfig<Record<string, any>>({
      dir,
      env: "dev",
      envVars: { APP_AUTH__SECRET: "e1", APP_SERVER__PORT: "8080", APP_FEATURE__ON: "true" },
    });
    expect(c.auth.secret).toBe("e1");
    expect(c.server.port).toBe(8080);
    expect(c.feature.on).toBe(true);
  });

  test("必填项缺失时报错带字段路径", () => {
    const dir = configDir({ "app_dev.yml": "auth:\n  secret: s1\n" });
    expect(() => loadConfig({ dir, env: "dev", required: ["mongo.uri"] })).toThrow(/mongo\.uri/);
  });

  test("必填项是空字符串也算缺失", () => {
    const dir = configDir({ "app_dev.yml": "auth:\n  secret: \"\"\n" });
    expect(() => loadConfig({ dir, env: "dev", required: ["auth.secret"] })).toThrow(/auth\.secret/);
  });

  test("空文件当 {}；顶层不是对象时报错", () => {
    const dir = configDir({ "app_dev.yml": "" });
    expect(loadConfig({ dir, env: "dev" })).toEqual({});
    const bad = configDir({ "app_dev.yml": "- 1\n- 2\n" });
    expect(() => loadConfig({ dir: bad, env: "dev" })).toThrow();
  });
});
