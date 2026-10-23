import { describe, expect, test } from "bun:test";

import { createLarkSink, logo, newLogger } from "@needle/logo";
import { createFileSink, createLogFiles } from "@needle/logo/node";
import { createShell, table } from "@needle/shell";
import { attach, serve } from "@needle/shell/node";

describe("包的导出映射", () => {
  test("@needle/logo 与 @needle/logo/node 都能按包名解析", () => {
    expect(typeof logo.info).toBe("function");
    expect(typeof newLogger).toBe("function");
    expect(typeof createLarkSink).toBe("function");
    expect(typeof createFileSink).toBe("function");
    expect(typeof createLogFiles).toBe("function");
  });

  test("@needle/shell 与 @needle/shell/node 都能按包名解析", () => {
    expect(typeof createShell).toBe("function");
    expect(typeof table).toBe("function");
    expect(typeof serve).toBe("function");
    expect(typeof attach).toBe("function");
  });
});
