export interface PageOptions {
    basePath: string;
    /** 头栏与浏览器标签页显示的名字。 */
    title: string;
    version: string;
    /** SSE 的 topics 参数，如 "top:5000"。不传就用服务端默认间隔。 */
    topicSpec?: string;
}
/**
 * 服务端返回的那张页面。
 *
 * 只做一件事：把构建期打好的 UI 脚本内联进去，并把挂载参数塞进 data 属性。
 * 不引外部脚本、不引 CDN——Workers 上没有静态资源目录，内联是唯一稳妥的做法。
 */
export declare function renderPage(options: PageOptions): string;
//# sourceMappingURL=page.d.ts.map