/** 右栏宽度的持久化键，跟 token / 历史同一套前缀。 */
const WIDTH_KEY = "logo.shell.sideWidth";

/** 拖到底时左栏至少留这么宽：再窄命令输出就没法看了。 */
const MIN_MAIN_WIDTH = 320;

/** 右栏最小宽度，与 CSS 里 clamp 的下限一致。 */
const MIN_SIDE_WIDTH = 260;

/** 右栏最多占容器的比例，剩下的留给左栏。 */
const MAX_SIDE_RATIO = 0.72;

/** 方向键的步长：24px 约两个字符宽，够细也不磨人。 */
const KEY_STEP = 24;

export interface ResizerOptions {
  /** 被调整宽度的那一栏（CSS 变量写在它的父元素上）。 */
  pane: HTMLElement;
  /** 压在分界线上的拖拽把手。 */
  handle: HTMLElement;
}

export interface Resizer {
  dispose(): void;
}

function readSavedWidth(): number | null {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw === null) {
      return null;
    }
    const width = Number(raw);
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    // 隐私模式、扩展沙箱里 localStorage 可能直接抛错。宽度丢了不算故障。
    return null;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* 同上，忽略 */
  }
}

/**
 * 把宽度夹进 [MIN_SIDE_WIDTH, min(容器-MIN_MAIN_WIDTH, 容器*MAX_SIDE_RATIO)]。
 *
 * 容器宽度取不到（面板还没布局、隐藏着）时原样返回：这时任何夹取都会把宽度
 * 直接压到下限，等真正拖动时再算。
 */
function clampWidth(width: number, hostWidth: number): number {
  if (!Number.isFinite(hostWidth) || hostWidth <= 0) {
    return Math.round(width);
  }
  const max = Math.max(MIN_SIDE_WIDTH, Math.min(hostWidth - MIN_MAIN_WIDTH, hostWidth * MAX_SIDE_RATIO));
  return Math.round(Math.min(Math.max(width, MIN_SIDE_WIDTH), max));
}

function hostWidthOf(host: HTMLElement | null): number {
  return host === null ? 0 : host.clientWidth;
}

/**
 * 让分界线可以左右拖动，改的是右栏宽度。
 *
 * 宽度写在容器（`.body`）的 `--side-width` 上，CSS 再用
 * `clamp(260px, var(--side-width, 38%), 72%)` 兜住上下限——拖拽只负责给变量，
 * 夹取规则只有一处。拖完存 localStorage，下次打开还是这个宽度。
 *
 * 键盘也能调（把手是 `role="separator"` + `tabindex="0"`）：←加宽、→收窄，
 * 只靠鼠标的话这块对键盘用户就是死区。
 */
export function mountResizer(options: ResizerOptions): Resizer {
  const { pane, handle } = options;
  const doc = handle.ownerDocument;
  const container = pane.parentElement;
  if (container === null) {
    return { dispose: () => {} };
  }
  // 显式非空类型：下面几个函数体在闭包里，TS 不会把窄化带进去。
  const host: HTMLElement = container;

  const saved = readSavedWidth();
  let width = saved ?? pane.clientWidth;
  if (width <= 0) {
    width = MIN_SIDE_WIDTH;
  }

  function maxWidth(): number {
    const hostWidth = hostWidthOf(host);
    return clampWidth(Number.MAX_SAFE_INTEGER, hostWidth);
  }

  function syncAria(): void {
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuemin", String(MIN_SIDE_WIDTH));
    handle.setAttribute("aria-valuemax", String(maxWidth()));
  }

  function apply(next: number, persist: boolean): void {
    width = clampWidth(next, hostWidthOf(host));
    host.style.setProperty("--side-width", `${width}px`);
    syncAria();
    if (persist) {
      saveWidth(width);
    }
  }

  // 没存过宽度就什么都不写：CSS 的 38% 默认值继续生效，第一次拖动才落成 px。
  if (saved !== null) {
    host.style.setProperty("--side-width", `${width}px`);
  }
  syncAria();

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    startX = event.clientX;
    startWidth = width;
    // 指针移出这 5px 也要继续跟手；不支持捕获的环境退化成只能在把手上拖。
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    // 往左拖 = 右栏变宽，所以差值取反。
    apply(startWidth + (startX - event.clientX), false);
  };

  const onPointerUp = (): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    saveWidth(width);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    apply(width + (event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP), true);
  };

  handle.addEventListener("pointerdown", onPointerDown as EventListener);
  handle.addEventListener("keydown", onKeyDown as EventListener);
  // move / up 挂在 document 上：拖到把手外面也要跟手，松手在哪都算数。
  doc.addEventListener("pointermove", onPointerMove as EventListener);
  doc.addEventListener("pointerup", onPointerUp);
  doc.addEventListener("pointercancel", onPointerUp);

  return {
    dispose(): void {
      handle.removeEventListener("pointerdown", onPointerDown as EventListener);
      handle.removeEventListener("keydown", onKeyDown as EventListener);
      doc.removeEventListener("pointermove", onPointerMove as EventListener);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
