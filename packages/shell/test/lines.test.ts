import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { formatDuration, toHuman } from "@needle/logo";
import { formatMetric, renderLogLine } from "../src/ui/lines.js";
import type { LogRecord } from "@needle/logo";

function newDoc(): Document {
  return new Window().document as unknown as Document;
}

function headOf(record: LogRecord): string {
  return renderLogLine(newDoc(), record).querySelector(".head")?.textContent ?? "";
}

describe("renderLogLine", () => {
  test("纯对象日志（没有 msg）要把字段按紧凑 JSON 渲染出来", () => {
    // 请求日志是 log.info({ rid, path, status, ... })：纯对象参数不产生 msg，
    // 只渲染 msg 的话面板里就只剩一个时间戳 + [I]。
    const head = headOf({
      time: Date.parse("2026-10-24T20:30:50+08:00"),
      level: "info",
      rid: "02ze2ebr2yw00",
      path: "/shell",
      status: 200,
      durationMs: 0.5,
      uid: null,
    });
    expect(head).toContain('"rid":"02ze2ebr2yw00"');
    expect(head).toContain('"path":"/shell"');
    expect(head).toContain('"status":200');
  });

  test("有 msg 的行 msg 也在 JSON 里，跟落盘格式一个口径", () => {
    const head = headOf({ time: 1, level: "info", msg: "hello" });
    expect(head).toContain('"msg":"hello"');
  });

  test("site / fn 进前缀，跟落盘行一致", () => {
    const head = headOf({
      time: 1,
      level: "info",
      site: "middleware.ts:63",
      fn: "requestLog",
      rid: "r1",
    });
    expect(head).toContain("middleware.ts:63");
    expect(head).toContain("[requestLog()]");
  });

  test("error 行的栈只在下面的 pre 里，不重复进 JSON 行", () => {
    const row = renderLogLine(newDoc(), {
      time: 1,
      level: "error",
      msg: "boom",
      stack: "Error: boom\n    at run (demo.ts:99:38)",
    });
    expect(row.querySelector(".head")?.textContent).not.toContain("demo.ts:99:38");
    expect(row.querySelector(".stack")?.textContent).toContain("demo.ts:99:38");
  });
});

describe("formatMetric", () => {
  test("字符串与对象不做单位换算", () => {
    expect(formatMetric("zone", "+08:00")).toBe("+08:00");
    expect(formatMetric("extra", { a: 1 })).toBe('{"a":1}');
  });

  test("Ms 结尾按时长渲染，rss/heapUsed 走人话，其余数字原样", () => {
    // 用不同的渲染函数做对照：61000 走 displayNumber 会变成 "61.0K"
    expect(formatMetric("uptimeMs", 61000)).toBe(formatDuration(61000));
    expect(formatMetric("rss", 2048)).toBe(toHuman(2048));
    expect(formatMetric("count", 42)).toBe("42");
  });
});
