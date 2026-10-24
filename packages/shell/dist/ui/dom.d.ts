/** 建一个元素，可选 className。 */
export declare function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K];
export declare function button(doc: Document, text: string, className: string): HTMLButtonElement;
/** 样式只插一次：同一个页面挂多个 Shell 也不会重复注入。 */
export declare function injectStyle(doc: Document): void;
