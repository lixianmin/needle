export interface ResizerOptions {
    /** 被调整宽度的那一栏（CSS 变量写在它的父元素上）。 */
    pane: HTMLElement;
    /** 压在分界线上的拖拽把手。 */
    handle: HTMLElement;
}
export interface Resizer {
    dispose(): void;
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
export declare function mountResizer(options: ResizerOptions): Resizer;
//# sourceMappingURL=resizer.d.ts.map