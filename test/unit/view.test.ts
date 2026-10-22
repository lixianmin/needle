import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { ConsoleAdapter, ConsoleEvent } from "../../src/console/ui/adapter.js";
import { mountConsole } from "../../src/console/ui/view.js";

/** 假适配器：测试里手动推事件、手动返回命令结果。 */
function fakeAdapter() {
  let listener: ((event: ConsoleEvent) => void) | undefined;
  const executed: string[] = [];
  const replies: Array<Awaited<ReturnType<ConsoleAdapter["exec"]>>> = [];

  const logins: Array<{ user: string; password: string }> = [];
  const topicSpecs: string[] = [];
  let logoutCount = 0;

  const adapter: ConsoleAdapter = {
    exec(line) {
      executed.push(line);
      return Promise.resolve(
        replies.shift() ?? { ok: true as const, output: { kind: "text" as const, text: "" } },
      );
    },
    authenticate(user, password) {
      logins.push({ user, password });
      return Promise.resolve({ ok: true as const, user });
    },
    logout() {
      logoutCount += 1;
    },
    setTopics(spec) {
      topicSpecs.push(spec);
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
    logins,
    topicSpecs,
    logoutCount: () => logoutCount,
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
      info: {
        title: "node",
        version: "1.2.3",
        user: "admin",
        commands: [],
        topics: [{ name: "top", note: "", intervalMs: 1000 }],
      },
    });

    expect((root as unknown as HTMLElement).textContent).toContain("v1.2.3");
    expect(document.querySelector(".title")?.textContent).toBe("node");
    expect(document.querySelector(".who")?.textContent).toBe("admin");
    // 头栏顺序：项目名 → 版本 → 用户，全部靠左。
    expect(document.querySelector("header")?.textContent).toBe("nodev1.2.3admin");
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

    expect((root as unknown as HTMLElement).textContent).toContain("未登录");
  });

  test("topic 事件落成一行，不常驻面板", () => {
    const { document, emit } = mount();
    emit({ type: "topic", name: "top", data: { rss: 1024 * 1024, connections: 1 } });

    const line = document.querySelector(".topic-line");
    expect(line?.textContent).toContain("[top]");
    expect(line?.textContent).toContain("rss=1.00M");
    expect(document.querySelector(".topics")).toBeNull();
  });

  test("表格：大数字转人话，点表头排序", async () => {
    const { document, replies } = mount();
    replies.push({
      ok: true,
      output: {
        kind: "table",
        columns: ["name", "size"],
        rows: [
          ["a", 5000],
          ["b", 200],
          ["c", 1048576],
        ],
      },
    });

    const form = document.querySelector("form") as unknown as HTMLFormElement;
    (document.querySelector("input") as unknown as HTMLInputElement).value = "sizes";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sizes = () => [...document.querySelectorAll("table.grid tbody tr")].map((tr) => tr.textContent);
    expect(sizes()).toEqual(["a4.88K", "b200", "c1.00M"]);

    // 点 size 表头：按数值升序，不是按字符串。
    const headers = document.querySelectorAll("table.grid th");
    (headers[1] as unknown as HTMLElement).dispatchEvent(new window.Event("click") as unknown as Event);
    expect(sizes()).toEqual(["b200", "a4.88K", "c1.00M"]);

    // 再点一次反向。
    (headers[1] as unknown as HTMLElement).dispatchEvent(new window.Event("click") as unknown as Event);
    expect(sizes()).toEqual(["c1.00M", "a4.88K", "b200"]);
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

  test("焦点不在输入框时，回车把光标送进去", () => {
    const { document } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;

    (document.body as unknown as HTMLElement).focus();
    expect(input.ownerDocument.activeElement).not.toBe(input);

    document.body.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event,
    );
    expect(input.ownerDocument.activeElement).toBe(input);
  });

  test("焦点在别的输入控件里时不抢", () => {
    const { document } = mount();
    const other = document.createElement("input");
    document.body.append(other);
    (other as unknown as HTMLInputElement).focus();

    other.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event,
    );

    expect(document.activeElement).toBe(other as unknown as Element);
  });

  test("auth 两步：先输用户名，再进遮罩密码框，密码不回显也不进历史", async () => {
    const { document, root, logins } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;

    input.value = "auth xmli";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);

    expect(input.type).toBe("password");
    expect(logins).toHaveLength(0);

    input.value = "123456";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logins).toEqual([{ user: "xmli", password: "123456" }]);
    expect(input.type).toBe("text");
    expect((root as unknown as HTMLElement).textContent).not.toContain("123456");
    expect((root as unknown as HTMLElement).textContent).toContain("已登录");

    // 历史里只有 auth xmli，没有密码。
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp" }) as unknown as Event);
    expect(input.value).toBe("auth xmli");
  });

  test("密码框里按 Esc 取消", () => {
    const { document } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;

    input.value = "auth xmli";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    expect(input.type).toBe("password");

    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }) as unknown as Event);
    expect(input.type).toBe("text");
    expect(input.value).toBe("");
  });

  test("logout 走适配器，不发命令", () => {
    const { document, executed, logoutCount } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;

    input.value = "logout";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);

    expect(logoutCount()).toBe(1);
    expect(executed).toHaveLength(0);
  });

  test("sub/unsub 改订阅并重建流", () => {
    const { document, emit, topicSpecs } = mount();
    emit({
      type: "hello",
      info: {
        title: "node",
        version: "1",
        user: "admin",
        commands: [],
        topics: [
          { name: "top", note: "", intervalMs: 1000 },
          { name: "mem", note: "", intervalMs: 5000 },
        ],
      },
    });

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;
    const run = (line: string) => {
      input.value = line;
      form.dispatchEvent(new window.Event("submit") as unknown as Event);
    };

    run("sub top 2000");
    run("sub mem");
    expect(topicSpecs.at(-1)).toBe("top:2000,mem");

    run("unsub top");
    expect(topicSpecs.at(-1)).toBe("mem");

    run("unsub");
    expect(topicSpecs.at(-1)).toBe("");
  });

  test("订阅不存在的主题会提示", () => {
    const { document, root, emit, topicSpecs } = mount();
    emit({
      type: "hello",
      info: { title: "node", version: "1", user: "admin", commands: [], topics: [{ name: "top", note: "", intervalMs: 1000 }] },
    });

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;
    input.value = "sub nope";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);

    expect((root as unknown as HTMLElement).textContent).toContain("没有这个主题");
    expect(topicSpecs).toHaveLength(0);
  });

  test("dispose 之后移除面板", () => {
    const { root, view } = mount();
    expect((root as unknown as HTMLElement).childElementCount).toBe(1);

    view.dispose();
    expect((root as unknown as HTMLElement).childElementCount).toBe(0);
  });
});
