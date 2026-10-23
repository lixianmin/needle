import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { ShellAdapter, ShellEvent } from "../../src/shell/ui/adapter.js";
import { mountShell } from "../../src/shell/ui/view.js";

/** 假适配器：测试里手动推事件、手动返回命令结果。 */
function fakeAdapter() {
  let listener: ((event: ShellEvent) => void) | undefined;
  const executed: string[] = [];
  const replies: Array<Awaited<ReturnType<ShellAdapter["exec"]>>> = [];

  const logins: Array<{ user: string; password: string }> = [];
  const topicSpecs: string[] = [];
  const openedFiles: string[] = [];

  const adapter: ShellAdapter = {
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
    setTopics(spec) {
      topicSpecs.push(spec);
    },
    fetchFile(href) {
      openedFiles.push(href);
      return Promise.resolve({ ok: true as const, text: "line1\nline2" });
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
    openedFiles,
    emit: (event: ShellEvent) => listener?.(event),
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
  const view = mountShell(root as unknown as HTMLElement, fake.adapter);
  return { document, root, view, ...fake };
}

describe("mountShell", () => {
  test("hello 之后显示版本与用户", () => {
    const { root, emit, document } = mount();
    emit({
      type: "handshake",
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
    expect(document.querySelector("header")?.textContent).toContain("nodev1.2.3admin");
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
    (document.querySelector("input") as unknown as HTMLInputElement).value = "log.list";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((root as unknown as HTMLElement).textContent).toContain("未登录");
  });

  test("topic 事件落在右栏的「主题」tab", () => {
    const { document, emit } = mount();
    emit({ type: "topic", name: "top", data: { rss: 1024 * 1024, connections: 1 } });

    // 切到主题 tab 时列表会立刻重绘
    (document.querySelectorAll(".tab")[1] as unknown as HTMLElement).click();

    const line = document.querySelector(".panel.active .row");
    expect(line?.textContent).toContain("[top]");
    expect(line?.textContent).toContain("rss=1.00M");
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

    // 表头常驻 ⇅ 提示可排序
    expect(document.querySelector("table.grid th .mark")?.textContent).toBe("⇅");

    // 点 size 表头：按数值升序，不是按字符串。
    const headers = document.querySelectorAll("table.grid th");
    (headers[1] as unknown as HTMLElement).dispatchEvent(new window.Event("click") as unknown as Event);
    expect(sizes()).toEqual(["b200", "a4.88K", "c1.00M"]);

    expect(document.querySelectorAll("table.grid th .mark")[1]?.textContent).toBe("▲");

    // 再点一次反向。
    (headers[1] as unknown as HTMLElement).dispatchEvent(new window.Event("click") as unknown as Event);
    expect(sizes()).toEqual(["c1.00M", "a4.88K", "b200"]);
    expect(document.querySelectorAll("table.grid th .mark")[1]?.textContent).toBe("▼");
  });

  test("Tab 补全命令名，焦点不动", () => {
    const { document, emit } = mount();
    emit({
      type: "handshake",
      info: {
        title: "node",
        version: "1",
        user: "admin",
        commands: [
          { name: "help", note: "", args: null },
          { name: "log.list", note: "", args: null },
          { name: "slow", note: "", args: null },
        ],
        topics: [{ name: "top", note: "", intervalMs: 1000 }],
      },
    });

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.focus();
    input.value = "he";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }) as unknown as Event);

    expect(input.value).toBe("help ");
    expect(document.activeElement).toBe(input);
  });

  test("Tab 补全主题名", () => {
    const { document, emit } = mount();
    emit({
      type: "handshake",
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
    input.value = "sub t";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }) as unknown as Event);

    expect(input.value).toBe("sub top ");
  });

  test("多个候选时列出候选，不改输入", () => {
    const { document, root, emit } = mount();
    emit({
      type: "handshake",
      info: {
        title: "node",
        version: "1",
        user: "admin",
        commands: [
          { name: "slow", note: "", args: null },
          { name: "sub", note: "", args: null },
        ],
        topics: [],
      },
    });

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.value = "s";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }) as unknown as Event);

    expect(input.value).toBe("s");
    expect((root as unknown as HTMLElement).textContent).toContain("候选:");
  });

  test("密码框里 Tab 不补全也不跳焦点", () => {
    const { document } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;

    input.value = "auth xmli";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    expect(input.type).toBe("password");

    input.value = "12";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }) as unknown as Event);

    expect(input.value).toBe("12");
    expect(document.activeElement).toBe(input);
  });

  test("列语义：duration 不用 K，bytes 永远带单位", async () => {
    const { document, replies } = mount();
    replies.push({
      ok: true,
      output: {
        kind: "table",
        columns: ["path", "latency"],
        formats: ["number", "duration"],
        rows: [
          ["/a", 57_720],
          ["/b", 312_000],
        ],
      },
    });

    const form = document.querySelector("form") as unknown as HTMLFormElement;
    (document.querySelector("input") as unknown as HTMLInputElement).value = "latency";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cells = [...document.querySelectorAll("table.grid tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(cells).toEqual([
      ["/a", "57.7s"],
      ["/b", "5m 12s"],
    ]);
  });

  test("点日志文件名：不跳转，改用 adapter.fetchFile 取全文", async () => {
    const { document, replies, openedFiles } = mount();
    replies.push({
      ok: true,
      output: {
        kind: "table",
        columns: ["file", "size"],
        rows: [[{ text: "info.log", href: "/shell/log/info.log" }, 1024]],
      },
    });

    const form = document.querySelector("form") as unknown as HTMLFormElement;
    (document.querySelector("input") as unknown as HTMLInputElement).value = "log.list";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const link = document.querySelector("table.grid a") as unknown as HTMLElement;
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openedFiles).toEqual(["/shell/log/info.log"]);
    expect(event.defaultPrevented).toBe(true);
  });

  test("text 输出里的空行保留高度（分组之间能看出间隔）", async () => {
    const { document, replies } = mount();
    replies.push({ ok: true, output: { kind: "text", text: "自定义命令\nroom\n\n内置命令\nhelp" } });

    const form = document.querySelector("form") as unknown as HTMLFormElement;
    (document.querySelector("input") as unknown as HTMLInputElement).value = "help";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lines = [...document.querySelectorAll(".output > div")].map((node) => node.textContent);
    expect(lines).toEqual(["$ help", "自定义命令", "room", "\u00A0", "内置命令", "help"]);
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

  test("logout 不再被本地拦下，按服务端命令发出", () => {
    const { document, executed } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    const form = document.querySelector("form") as unknown as HTMLFormElement;

    input.value = "logout";
    form.dispatchEvent(new window.Event("submit") as unknown as Event);

    expect(executed).toEqual(["logout"]);
  });

  test("Tab 不再补全 logout", () => {
    const { document, emit } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;

    emit({
      type: "handshake",
      info: { title: "t", version: "1", user: null, commands: [], topics: [] },
    });
    input.value = "log";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }) as unknown as Event);

    expect(input.value).toBe("log");
  });

  test("sub/unsub 改订阅并重建流", () => {
    const { document, emit, topicSpecs } = mount();
    emit({
      type: "handshake",
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
      type: "handshake",
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

describe("调用栈直接铺在行里", () => {
  test("error 行带完整栈，info / warn 没有", () => {
    const { document, emit } = mount();
    emit({
      type: "logs",
      records: [
        { time: 1, level: "error", msg: "boom", stack: "Error: boom\n    at run (demo.ts:99:38)" },
        { time: 2, level: "warn", msg: "careful" },
        { time: 3, level: "info", msg: "plain" },
      ],
    });
    (document.querySelectorAll(".tab")[0] as unknown as HTMLElement).click();

    const rows = [...document.querySelectorAll(".panel.active .row")] as unknown as HTMLElement[];
    const byText = (text: string) => rows.find((row) => row.textContent?.includes(text)) as HTMLElement;

    expect(byText("boom").querySelector(".stack")?.textContent).toContain("at run (demo.ts:99:38)");
    expect(byText("careful").querySelector(".stack")).toBeNull();
    expect(byText("plain").querySelector(".stack")).toBeNull();
    expect(document.querySelector(".detail")).toBeNull();
  });
});

describe("交互细节", () => {
  const handshake = (): ShellEvent => ({
    type: "handshake",
    info: { title: "node", version: "1.0.0", user: "admin", commands: [], topics: [] },
  });

  test("表头降序时空值仍然排在最后", async () => {
    const { document, root, replies, emit } = mount();
    emit(handshake());
    replies.push({
      ok: true,
      output: {
        kind: "table",
        columns: ["name", "size"],
        rows: [
          ["a", 1],
          ["b", null],
          ["c", 3],
        ],
      },
    });

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.value = "files";
    (document.querySelector("form") as unknown as HTMLFormElement).dispatchEvent(
      new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const headers = [...document.querySelectorAll("th")] as unknown as HTMLElement[];
    (headers[1] as HTMLElement).click();
    (headers[1] as HTMLElement).click();

    const lastRow = [...document.querySelectorAll("tbody tr")].at(-1) as unknown as HTMLElement;
    expect(lastRow.textContent).toContain("b");
    expect(root.querySelector("table.grid")).not.toBeNull();
  });

  test("命令请求失败时给出可见提示", async () => {
    const document = window.document as unknown as Document;
    const root = document.createElement("div");
    document.body.append(root);
    const adapter: ShellAdapter = {
      exec: () => Promise.reject(new Error("network down")),
      authenticate: () => Promise.resolve({ ok: true as const, user: "admin" }),
      setTopics: () => {},
      fetchFile: () => Promise.resolve({ ok: true as const, text: "" }),
      subscribe: () => () => {},
    };
    mountShell(root as unknown as HTMLElement, adapter);

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.value = "ping";
    (document.querySelector("form") as unknown as HTMLFormElement).dispatchEvent(
      new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector(".output")?.textContent).toContain("network down");
  });

  test("密码模式下上下键不会翻出历史命令", () => {
    const { document } = mount();
    const input = document.querySelector("input") as unknown as HTMLInputElement;

    input.value = "help";
    (document.querySelector("form") as unknown as HTMLFormElement).dispatchEvent(
      new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
    );

    input.value = "auth admin";
    (document.querySelector("form") as unknown as HTMLFormElement).dispatchEvent(
      new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(input.type).toBe("password");

    input.dispatchEvent(
      new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
      }),
    );
    expect(input.value).toBe("");
  });

  test("焦点在按钮上时回车不被输入框抢走", () => {
    const { document } = mount();
    const pause = document.querySelector(".tool") as unknown as HTMLElement;
    pause.focus();

    const event = new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    pause.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(pause);
  });
});

describe("输出渲染兜底", () => {
  const handshake = (): ShellEvent => ({
    type: "handshake",
    info: { title: "node", version: "1.0.0", user: "admin", commands: [], topics: [] },
  });

  const submit = (document: Document, line: string): void => {
    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.value = line;
    (document.querySelector("form") as unknown as HTMLFormElement).dispatchEvent(
      new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
    );
  };

  test("json 输出带循环引用时也能渲染", async () => {
    const { document, replies, emit } = mount();
    emit(handshake());
    const value: Record<string, unknown> = { name: "loop" };
    value.self = value;
    replies.push({ ok: true, output: { kind: "json", value } });

    submit(document, "order 1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector(".output")?.textContent).toContain("loop");
  });

  test("打开文件失败时给出提示", async () => {
    const document = window.document as unknown as Document;
    const root = document.createElement("div");
    document.body.append(root);
    const adapter: ShellAdapter = {
      exec: () =>
        Promise.resolve({
          ok: true as const,
          output: {
            kind: "table" as const,
            columns: ["file"],
            rows: [[{ text: "info.log", href: "/shell/log/info.log" }]],
          },
        }),
      authenticate: () => Promise.resolve({ ok: true as const, user: "admin" }),
      setTopics: () => {},
      fetchFile: () => Promise.reject(new Error("gateway down")),
      subscribe: () => () => {},
    };
    mountShell(root as unknown as HTMLElement, adapter);

    submit(document, "files");
    await new Promise((resolve) => setTimeout(resolve, 0));
    (document.querySelector("tbody a") as unknown as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector(".output")?.textContent).toContain("gateway down");
  });
});

describe("焦点丢失时", () => {
  test("activeElement 为 null 时回车仍然聚焦输入框", () => {
    const { document, root } = mount();
    const original = Object.getOwnPropertyDescriptor(document, "activeElement");
    Object.defineProperty(document, "activeElement", { get: () => null, configurable: true });
    const event = new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(event);

    // 先恢复真实实现，再看 focus() 有没有生效（桩会一直返回 null）。
    if (original !== undefined) {
      Object.defineProperty(document, "activeElement", original);
    }
    else {
      delete (document as unknown as Record<string, unknown>).activeElement;
    }

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.querySelector("input"));
  });
});

describe("未登录命令门禁", () => {
  test("未登录时 sub 不生效，并提示先 auth", () => {
    const { document, topicSpecs } = mount();

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.value = "sub top";
    (document.querySelector("form") as unknown as HTMLFormElement).dispatchEvent(
      new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(document.querySelector(".output")?.textContent).toContain("未登录");
    expect(topicSpecs).not.toContain("top");
  });

  test("登录后 sub 正常生效", () => {
    const { document, emit, topicSpecs } = mount();
    emit({
      type: "handshake",
      info: {
        title: "node",
        version: "1.0.0",
        user: "admin",
        commands: [],
        topics: [{ name: "top", note: "", intervalMs: 1000 }],
      },
    });

    const input = document.querySelector("input") as unknown as HTMLInputElement;
    input.value = "sub top";
    (document.querySelector("form") as unknown as HTMLFormElement).dispatchEvent(
      new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(document.querySelector(".output")?.textContent).toContain("已订阅");
    expect(topicSpecs).toContain("top");
  });
});
