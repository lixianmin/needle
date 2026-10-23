/** 行高固定成 px：虚拟滚动按它算窗口，所以行内容不能换行。 */
export const ROW_HEIGHT = 18;

/** 缓冲区上限（服务端不存任何日志，这只是浏览器内存保护）。超出丢最旧的并计数。 */
const DEFAULT_CAPACITY = 100_000;

/** 可见窗口上下各多渲染几行，快速滚动时不留白。 */
const OVERSCAN = 20;

export interface LogList<T> {
  el: HTMLElement;
  append(rows: readonly T[]): void;
  clear(): void;
  isFollowing(): boolean;
  follow(): void;
  dropped(): number;
  /** 立刻重绘（切 tab、容器刚可见时用；平时由 rAF 驱动）。 */
  flush(): void;
  dispose(): void;
}

/**
 * 定高虚拟列表。
 *
 * 只把「可见的几十行」建进 DOM，缓冲区里存几万条也不影响节点数。滚动与
 * 追加都走同一个 rAF 调度，一帧最多重绘一次。
 */
export function createLogList<T>(
  doc: Document,
  render: (row: T) => HTMLElement,
  capacity: number = DEFAULT_CAPACITY,
): LogList<T> {
  const el = doc.createElement("div");
  el.className = "list";
  const spacer = doc.createElement("div");
  spacer.className = "spacer";
  el.append(spacer);

  const rows: T[] = [];
  const live = new Map<number, HTMLElement>();
  let dropped = 0;
  let following = true;
  let frame = 0;

  const view = doc.defaultView;
  const raf: (callback: () => void) => number =
    view?.requestAnimationFrame?.bind(view) ?? ((callback) => setTimeout(callback, 16) as unknown as number);
  const cancel: (handle: number) => void =
    view?.cancelAnimationFrame?.bind(view) ?? ((handle) => clearTimeout(handle));

  function paint(): void {
    frame = 0;
    const viewport = el.clientHeight > 0 ? el.clientHeight : ROW_HEIGHT * 20;
    const first = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((el.scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

    for (const [index, node] of live) {
      if (index < first || index >= last) {
        node.remove();
        live.delete(index);
      }
    }

    for (let index = first; index < last; index += 1) {
      if (live.has(index)) continue;
      const node = render(rows[index] as T);
      node.style.top = `${index * ROW_HEIGHT}px`;
      spacer.append(node);
      live.set(index, node);
    }
  }

  function schedule(): void {
    if (frame !== 0) return;
    frame = raf(paint);
  }

  function rebuild(): void {
    for (const node of live.values()) node.remove();
    live.clear();
  }

  const onScroll = (): void => {
    following = el.scrollHeight - el.scrollTop - el.clientHeight <= ROW_HEIGHT;
    schedule();
  };
  el.addEventListener("scroll", onScroll, { passive: true });

  function append(next: readonly T[]): void {
    if (next.length === 0) return;
    for (const row of next) rows.push(row);

    const excess = rows.length - capacity;
    if (excess > 0) {
      rows.splice(0, excess);
      dropped += excess;
      rebuild();
    }

    spacer.style.height = `${rows.length * ROW_HEIGHT}px`;
    if (following) el.scrollTop = rows.length * ROW_HEIGHT;
    schedule();
  }

  return {
    el,
    append,
    isFollowing: () => following,
    follow() {
      following = true;
      el.scrollTop = rows.length * ROW_HEIGHT;
      schedule();
    },
    clear() {
      rows.length = 0;
      dropped = 0;
      rebuild();
      spacer.style.height = "0px";
      schedule();
    },
    dropped: () => dropped,
    flush() {
      if (frame !== 0) {
        cancel(frame);
        frame = 0;
      }
      paint();
    },
    dispose() {
      if (frame !== 0) cancel(frame);
      el.removeEventListener("scroll", onScroll);
      el.remove();
    },
  };
}
