import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { newLogger } from "../../dist/core/index.js";
import { createConsole } from "../../dist/console/index.js";
import { serve } from "../../dist/node/index.js";

// 冒烟测试跑 dist，直接读 package.json 里的真版本号：这里不断言它的值，只是
// createConsole 要求传一个。单测用的固定常量见 test/fixtures.ts。
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

// 1. 批量 + 立即刷：error 应该把积压的 info 一起带出去
const batches = [];
const logger = newLogger({ sinks: [(batch) => batches.push(batch)], flushIntervalMs: 10_000 });

logger.info("a");
logger.info("b");
logger.error("boom");

assert.equal(batches.length, 1, "error 应该触发一次立即 flush");
assert.equal(batches[0].length, 3, "积压的两条 info 应该一起写出");
assert.deepEqual(
  batches[0].map((record) => record.level),
  ["info", "info", "error"],
);
assert.ok(typeof batches[0][2].stack === "string", "error 应带调用栈");

// 2. 控制台能在 node 上跑起来
const debug = createConsole({
  logger,
  auth: { users: { admin: "secret" }, secret: "smoke-secret" },
  version,
});

const server = await serve(debug.handler, { port: 0 });
try {
  const health = await fetch(`http://127.0.0.1:${server.port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const page = await fetch(`http://127.0.0.1:${server.port}/`);
  assert.ok((await page.text()).includes("logo-root"), "页面应包含挂载点");

  const exec = await fetch(`http://127.0.0.1:${server.port}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ line: "help" }),
  });
  assert.equal(exec.status, 200);
  assert.equal((await exec.json()).ok, true);
} finally {
  await server.close();
  debug.dispose();
}

console.log("node smoke ok");
