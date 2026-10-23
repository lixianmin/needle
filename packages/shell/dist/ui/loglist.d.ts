/** 行高固定成 px：虚拟滚动按它算窗口，所以行内容不能换行。 */
export declare const ROW_HEIGHT = 18;
export interface LogListOptions<T> {
    capacity?: number;
    /** 点行时回调；取消选择传 undefined。 */
    onSelect?: (row: T | undefined) => void;
}
export interface LogList<T> {
    el: HTMLElement;
    append(rows: readonly T[]): void;
    clear(): void;
    isFollowing(): boolean;
    follow(): void;
    dropped(): number;
    /** 取消选中（Esc 用）。已经没选时什么都不做。 */
    clearSelection(): void;
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
export declare function createLogList<T>(doc: Document, render: (row: T) => HTMLElement, options?: LogListOptions<T>): LogList<T>;
