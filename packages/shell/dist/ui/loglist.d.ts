/** 单行兜底高度：还没测量过的行按它算，普通日志行就是这个高度。 */
export declare const ROW_HEIGHT = 18;
export interface LogListOptions<T> {
    capacity?: number;
    /** 量一行的高度。默认读 offsetHeight（量不到时退回 ROW_HEIGHT），测试里可以替换。 */
    measure?: (node: HTMLElement) => number;
    /**
     * 还没渲染过时的估算高度。量不到的行按它算，滚动条长度和跳转位置才不至于
     * 随"看没看过"而漂移；默认当普通行（ROW_HEIGHT）。
     */
    estimate?: (row: T) => number;
}
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
 * 变高虚拟列表。
 *
 * 行高不固定：带调用栈的 error 行比普通行高一大截。所以每行存一个实测
 * 高度，`offsets[i]` 是它前面所有行的高度和——滚动落点、窗口范围都靠这张
 * 前缀表二分，DOM 里始终只有可见的几十行。
 *
 * 高度只能等节点放进 DOM 才量得到，所以新行先按 ROW_HEIGHT 摆，量完如果
 * 变高了就重算一次偏移、把窗口里的行整体挪一遍，避免叠在一起。
 */
export declare function createLogList<T>(doc: Document, render: (row: T) => HTMLElement, options?: LogListOptions<T>): LogList<T>;
//# sourceMappingURL=loglist.d.ts.map