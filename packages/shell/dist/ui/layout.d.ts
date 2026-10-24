/**Shell 用到的全部 DOM 节点。 */
export interface ShellLayout {
    wrap: HTMLElement;
    header: HTMLElement;
    title: HTMLElement;
    version: HTMLElement;
    user: HTMLElement;
    toggle: HTMLButtonElement;
    output: HTMLElement;
    form: HTMLFormElement;
    input: HTMLInputElement;
    aside: HTMLElement;
    logTab: HTMLButtonElement;
    topicTab: HTMLButtonElement;
    tools: HTMLElement;
    pause: HTMLButtonElement;
    clear: HTMLButtonElement;
    level: HTMLSelectElement;
    droppedLabel: HTMLElement;
    logPanel: HTMLElement;
    topicPanel: HTMLElement;
}
/** 拼出 Shell 的整棵 DOM（不含日志列表，那两块由 view 挂上去）。 */
export declare function buildLayout(doc: Document): ShellLayout;
