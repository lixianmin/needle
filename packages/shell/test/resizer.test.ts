import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { mountResizer } from "../src/ui/resizer.js";

const WIDTH_KEY = "logo.shell.sideWidth";

function setup(hostWidth = 1200) {
  const window = new Window();
  // resizer 用全局 localStorage（与 history.ts 同口径），happy-dom 的 window 自带。
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    window.localStorage as unknown as Storage;
  window.localStorage.clear();

  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  const pane = doc.createElement("aside");
  const handle = doc.createElement("div");
  host.append(pane, handle);
  // happy-dom 的 clientWidth 恒为 0，桩一个容器宽度，夹取规则才有东西可算。
  Object.defineProperty(host, "clientWidth", { value: hostWidth, configurable: true });
  doc.body.append(host);

  const pointer = (type: string, clientX: number): Event =>
    new window.MouseEvent(type, { clientX, bubbles: true }) as unknown as Event;
  const key = (k: string): Event =>
    new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event;

  return { window, doc, host, pane, handle, pointer, key };
}

describe("mountResizer", () => {
  test("没存过宽度时不写 CSS 变量：CSS 的 38% 默认值继续生效", () => {
    const { host, pane, handle } = setup();
    mountResizer({ pane, handle });
    expect(host.style.getPropertyValue("--side-width")).toBe("");
  });

  test("往左拖 = 右栏变宽；松手后宽度写进 localStorage", () => {
    const { doc, host, pane, handle, pointer } = setup(1200);
    mountResizer({ pane, handle });

    handle.dispatchEvent(pointer("pointerdown", 800));
    doc.dispatchEvent(pointer("pointermove", 700));
    expect(host.style.getPropertyValue("--side-width")).toBe("360px");

    doc.dispatchEvent(pointer("pointerup", 700));
    expect(localStorage.getItem(WIDTH_KEY)).toBe("360");
  });

  test("下次挂载恢复上次的宽度", () => {
    const first = setup(1200);
    mountResizer({ pane: first.pane, handle: first.handle });
    first.handle.dispatchEvent(first.pointer("pointerdown", 800));
    first.doc.dispatchEvent(first.pointer("pointermove", 640));
    first.doc.dispatchEvent(first.pointer("pointerup", 640));

    const second = setup(1200);
    localStorage.setItem(WIDTH_KEY, String(420));
    mountResizer({ pane: second.pane, handle: second.handle });
    expect(second.host.style.getPropertyValue("--side-width")).toBe("420px");
  });

  test("方向键：← 加宽、→ 收窄", () => {
    const { host, pane, handle, key } = setup(1200);
    mountResizer({ pane, handle });

    handle.dispatchEvent(key("ArrowLeft"));
    expect(host.style.getPropertyValue("--side-width")).toBe("284px");
    handle.dispatchEvent(key("ArrowRight"));
    expect(host.style.getPropertyValue("--side-width")).toBe("260px");
  });

  test("夹取：左栏至少留 320px，右栏最多占 72%", () => {
    // 800px 容器：min(800-320, 800*0.72=576) = 480，上限由「留够左栏」决定
    const { doc, host, pane, handle, pointer } = setup(800);
    mountResizer({ pane, handle });

    handle.dispatchEvent(pointer("pointerdown", 800));
    doc.dispatchEvent(pointer("pointermove", -2000));
    expect(host.style.getPropertyValue("--side-width")).toBe("480px");
  });

  test("dispose 之后不再响应拖动", () => {
    const { doc, host, pane, handle, pointer } = setup(1200);
    const resizer = mountResizer({ pane, handle });
    resizer.dispose();

    handle.dispatchEvent(pointer("pointerdown", 800));
    doc.dispatchEvent(pointer("pointermove", 700));
    expect(host.style.getPropertyValue("--side-width")).toBe("");
    expect(localStorage.getItem(WIDTH_KEY)).toBeNull();
  });
});
