import { STYLE, STYLE_ID } from "./style.js";
/** 建一个元素，可选 className。 */
export function el(doc, tag, className) {
    const node = doc.createElement(tag);
    if (className !== undefined) {
        node.className = className;
    }
    return node;
}
export function button(doc, text, className) {
    const node = doc.createElement("button");
    node.type = "button";
    node.className = className;
    node.textContent = text;
    return node;
}
/** 样式只插一次：同一个页面挂多个控制台也不会重复注入。 */
export function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID) !== null) {
        return;
    }
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    doc.head.append(style);
}
