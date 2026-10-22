import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { ConsoleAdapter, ConsoleEvent } from "../../src/console/ui/adapter.js";
import { mountConsole } from "../../src/console/ui/view.js";

/** 假适配器：测试里手动推事件、手动返回命令结果。 */
function fakeAdapter() {
  let listener: ((event: ConsoleEvent) => void) | undefined;
  const executed: string[] = [];
  const replies: Array<Awaited<ReturnType<ConsoleAdapter["exec"]>>> = [];

  const adapter: ConsoleAdapter = {
    exec(line) {
      executed.push(line);
      return Promise.resolve(
        replies.shift() ?? { ok: true as const, output: { kind: "text" as const, text: "" } },
      );
    },
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };

  return {
    adapter,
    executed,
    replies,
    emit: (event: ConsoleEvent) => listener?.(event),
  };
}

let window: Window;

beforeEach(() => {
  window = new Window({ url: "http://localhost/" });
  // view 里用到 localStorage，happy-dom 的 window 自带；挂到全局供模块访问。
  (globalThis as unknown as { localStorage: Storage }).localStorage = window.localStorage as unknown as Storage;
});

function mount() {
  const document = window.document as unknown as Document;
  const root = document.createElement("div");
  document.body.append(root);
  const fake = fakeAdapter();
  const view = mountConsole(root as unknown as HTMLElement, fake.adapter);
  return { document, root, view, ...fake };
}

describe("mountConsole", () => {
  test("hello 之后显示版本与用户", () => {
    const { root, emit, document } = mount();
    emit({
      type: "hello",
      info: { version: "1.2.3", user: "admin", commands: [] },
    });

    expect((root as unknown as HTMLElement).textContent).toContain("v1.2.3");
    expect(document.querySelector(".who")?.textContent).toBe("admin");
  });

  test("日志按级别上色", () => {
    const { document, emit } = mount();
    emit({ type: "log", record: { time: Date.now(), level: "error", msg: "boom" } });

    const line = document.querySelector(".line");
    expect(line?.querySelector(".lv-error")?.textContent).toBe("error");
    expect(line?.querySelector(".msg")?.textContent).toBe("boom");
  });

  test("提交命令后回显并渲染 text 输出", async () => {
    const { document, root, executed, replies } = mount();
    replies.push({ ok: true, output: { kind: "text", text: "line one\nline two" } });

    const form = document.querySelector("form") as unknown as HTMLFormElement;
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.value = "help";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executed).toEqual(["help"]);
    expect((root as unknown as HTMLElement).textContent).toContain("$ help");
    expect((root as unknown as HTMLElement).textContent).toContain("line two");
  });

  test("table 输出渲染成表格", async () => {
    const { document, replies } = mount();
    replies.push({
      ok: true,
      output: { kind: "table", columns: ["a", "b"], rows: [["1", "2"]] },
    });

    const form = document.querySelector("form") as unknown as HTMLFormElement;
    (document.querySelector("input") as unknown as HTMLInputElement).value = "ps";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cells = [...document.querySelectorAll("table.grid td")].map((cell) => cell.textContent);
    expect(cells).toEqual(["1", "2"]);
  });

  test("未登录的命令回显提示而不是崩溃", async () => {
    const { root, document, replies } = mount();
    replies.push({ ok: false, error: "unauthorized", unauthorized: true });

    const form = document.querySelector("form") as unknown as HTMLFormElement;
    (document.querySelector("input") as unknown as HTMLInputElement).value = "logs";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((root as unknown as HTMLElement).textContent).toContain("先执行 login");
  });

  test("topic 事件渲染成面板", () => {
    const { document, emit } = mount();
    emit({ type: "topic", name: "top", data: { rss: 123, heapUsed: 45 } });

    const panel = document.querySelector(".topic");
    expect(panel?.querySelector("h3")?.textContent).toBe("top");
    expect(panel?.textContent).toContain("rss");
  });

  test("上键翻历史", () => {
    const { document } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;

    input.value = "help";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    input.value = "";

    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp" }) as unknown as Event);
    expect(input.value).toBe("help");
  });

  test("dispose 之后移除面板", () => {
    const { root, view } = mount();
    expect((root as unknown as HTMLElement).childElementCount).toBe(1);

    view.dispose();
    expect((root as unknown as HTMLElement).childElementCount).toBe(0);
  });
});
