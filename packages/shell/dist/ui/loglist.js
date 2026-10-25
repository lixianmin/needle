/** 单行兜底高度：还没测量过的行按它算，普通日志行就是这个高度。 */
export const ROW_HEIGHT = 18;
/** 缓冲区上限（服务端不存任何日志，这只是浏览器内存保护）。超出丢最旧的并计数。 */
const DEFAULT_CAPACITY = 100_000;
/** 可见窗口上下各多渲染几行，快速滚动时不留白。 */
const OVERSCAN = 20;
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
export function createLogList(doc, render, options = {}) {
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    const measure = options.measure ?? ((node) => node.offsetHeight || ROW_HEIGHT);
    const estimate = options.estimate ?? (() => ROW_HEIGHT);
    const el = doc.createElement("div");
    el.className = "list";
    const spacer = doc.createElement("div");
    spacer.className = "spacer";
    el.append(spacer);
    const rows = [];
    /** 每行的实测高度。 */
    const heights = [];
    /** 插入时算一次的估算高度：resize 时不用对十万条重新 estimate（带栈的要 split）。 */
    const estimates = [];
    /** 面板不可见时渲染过、还没量过高度的行。切回来要补测。 */
    const unmeasured = new Set();
    /** offsets[i] = heights[0..i-1] 的和；长度始终是 rows.length + 1。 */
    let offsets = [0];
    /** 高度或行数被改动过，offsets 需要重算。 */
    let dirty = false;
    const live = new Map();
    let dropped = 0;
    let following = true;
    let frame = 0;
    let width = el.clientWidth;
    const view = doc.defaultView;
    const raf = view?.requestAnimationFrame?.bind(view) ?? ((callback) => setTimeout(callback, 16));
    const cancel = view?.cancelAnimationFrame?.bind(view) ?? ((handle) => clearTimeout(handle));
    function ensureOffsets() {
        if (!dirty) {
            return;
        }
        offsets = new Array(rows.length + 1);
        offsets[0] = 0;
        for (let index = 0; index < rows.length; index += 1) {
            offsets[index + 1] = offsets[index] + heights[index];
        }
        dirty = false;
    }
    /** 二分：scrollTop 落在哪一行。调用前必须 ensureOffsets()。 */
    function indexAt(scrollTop) {
        let low = 0;
        let high = rows.length - 1;
        let found = 0;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (offsets[mid] <= scrollTop) {
                found = mid;
                low = mid + 1;
            }
            else {
                high = mid - 1;
            }
        }
        return found;
    }
    function paint() {
        frame = 0;
        ensureOffsets();
        const viewport = el.clientHeight > 0 ? el.clientHeight : ROW_HEIGHT * 20;
        const first = Math.max(0, indexAt(el.scrollTop) - OVERSCAN);
        const limit = el.scrollTop + viewport;
        let last = first;
        while (last < rows.length && offsets[last] < limit) {
            last += 1;
        }
        last = Math.min(rows.length, last + OVERSCAN);
        for (const [index, node] of live) {
            if (index < first || index >= last) {
                node.remove();
                live.delete(index);
                unmeasured.delete(index);
            }
        }
        // 面板不可见（切到别的 tab）时量到的是 0，会把估算高度冲掉，等可见了再量。
        const measurable = el.clientHeight > 0 || options.measure !== undefined;
        let remeasured = false;
        for (let index = first; index < last; index += 1) {
            const existing = live.get(index);
            if (existing !== undefined) {
                // 之前面板不可见，行建出来了但没量过；现在可见了补量一次。
                if (measurable && unmeasured.has(index)) {
                    unmeasured.delete(index);
                    const height = measure(existing);
                    if (height !== heights[index]) {
                        heights[index] = height;
                        remeasured = true;
                    }
                }
                continue;
            }
            const node = render(rows[index]);
            node.style.top = `${offsets[index]}px`;
            spacer.append(node);
            live.set(index, node);
            if (!measurable) {
                unmeasured.add(index);
                continue;
            }
            const height = measure(node);
            if (height !== heights[index]) {
                heights[index] = height;
                remeasured = true;
            }
        }
        spacer.style.height = `${offsets[rows.length]}px`;
        if (remeasured) {
            dirty = true;
            ensureOffsets();
            for (const [index, node] of live) {
                node.style.top = `${offsets[index]}px`;
            }
            spacer.style.height = `${offsets[rows.length]}px`;
            // 高度一变，总高跟着变；贴着底看的时候要重新钉住，否则会往上飘一截。
            if (following) {
                el.scrollTop = offsets[rows.length];
            }
        }
    }
    function schedule() {
        if (frame !== 0) {
            return;
        }
        frame = raf(paint);
    }
    function rebuild() {
        for (const node of live.values()) {
            node.remove();
        }
        live.clear();
        unmeasured.clear();
    }
    const onScroll = () => {
        following = el.scrollHeight - el.scrollTop - el.clientHeight <= ROW_HEIGHT;
        schedule();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // 行高跟宽度有关：窗口变窄，同一行栈会折成更多行。宽度变了就把高度全部作废重量。
    const onResize = () => {
        const next = el.clientWidth;
        if (next === width) {
            return;
        }
        width = next;
        if (rows.length === 0) {
            return;
        }
        for (let index = 0; index < rows.length; index += 1) {
            heights[index] = estimates[index];
        }
        dirty = true;
        rebuild();
        schedule();
    };
    const resizeObserver = view?.ResizeObserver !== undefined ? new view.ResizeObserver(onResize) : undefined;
    if (resizeObserver === undefined) {
        view?.addEventListener("resize", onResize);
    }
    else {
        resizeObserver.observe(el);
    }
    function append(next) {
        if (next.length === 0) {
            return;
        }
        for (const row of next) {
            const height = estimate(row);
            rows.push(row);
            heights.push(height);
            estimates.push(height);
            if (!dirty) {
                offsets.push(offsets[offsets.length - 1] + height);
            }
        }
        const excess = rows.length - capacity;
        if (excess > 0) {
            rows.splice(0, excess);
            heights.splice(0, excess);
            estimates.splice(0, excess);
            dropped += excess;
            dirty = true;
            rebuild();
        }
        if (following) {
            ensureOffsets();
            // 先把总高写够再滚：反过来的话 scrollTop 会被 clamp 到上一批的底部。
            spacer.style.height = `${offsets[rows.length]}px`;
            el.scrollTop = offsets[rows.length];
        }
        schedule();
    }
    return {
        el,
        append,
        isFollowing: () => following,
        follow() {
            following = true;
            ensureOffsets();
            spacer.style.height = `${offsets[rows.length]}px`;
            el.scrollTop = offsets[rows.length];
            schedule();
        },
        clear() {
            // 清空后必须恢复跟随：内容归零不会让浏览器补发 scroll 事件，following 会
            // 停在 false，之后新日志不再自动滚到底，面板卡在最旧的一行。
            following = true;
            rows.length = 0;
            heights.length = 0;
            estimates.length = 0;
            offsets = [0];
            dirty = false;
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
            if (frame !== 0) {
                cancel(frame);
            }
            if (resizeObserver === undefined) {
                view?.removeEventListener("resize", onResize);
            }
            else {
                resizeObserver.disconnect();
            }
            el.removeEventListener("scroll", onScroll);
            el.remove();
        },
    };
}
