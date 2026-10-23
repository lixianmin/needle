import { createShell, logo } from "../../src/index.js";
import { TEST_VERSION } from "../fixtures.js";

/**
 * Workers 侧的 fixture。
 *
 * 注意：核心代码一行没改，只是把同一个 createShell 挂到 export default 上。
 * secret 必须是固定值，否则每次 isolate 回收都会让登录态失效。
 */
const shell = createShell({
  logger: logo,
  auth: { users: { admin: "secret" }, secret: "workers-fixture-secret" },
  version: TEST_VERSION,
});

export default {
  fetch(request: Request): Promise<Response> {
    return shell.handler(request);
  },
};
