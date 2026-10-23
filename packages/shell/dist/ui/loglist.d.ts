/** 行高固定成 px：虚拟滚动按它算窗口，所以行内容不能换行。 */
export declare const ROW_HEIGHT = 18;
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
export declare function createLogList<T>(doc: Document, render: (row: T) => HTMLElement, capacity?: number): LogList<T>;
