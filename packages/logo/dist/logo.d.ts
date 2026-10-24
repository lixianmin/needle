import { type Level, type Sink } from "./types.js";
export interface LoggerOptions {
    /** 低于这个级别不记录。默认 "info"。 */
    level?: Level;
    /** logger 的名字，写进每条记录的 name 字段。默认不出现。 */
    name?: string;
    /** 初始 sink 列表。默认空——`@needle/logo` 根入口的 `logo` 实例才挂了 stdout。 */
    sinks?: Sink[];
    /** 注入时间，测试用。 */
    now?: () => number;
    /** 攒批窗口（毫秒）。默认 100；客户端想按帧刷可设成 16~33。 */
    flushIntervalMs?: number;
    /** 缓冲上限（条）。默认 10000；写满立刻 flush，不丢记录。 */
    maxBuffer?: number;
    /** 从哪个级别开始采集调用栈。默认 "error"；设 "off" 关闭。 */
    stackLevel?: Level | "off";
    /** 是否启用定时批量。默认取决于能否同步写 stdout。 */
    batch?: boolean;
    /** 内部用：child 携带的固定字段。 */
    fields?: Record<string, unknown>;
}
export interface Logger {
    /** 记一条 debug。参数规则见 {@link Logger.info}。 */
    debug(...args: unknown[]): void;
    /**
     * 记一条 info。四个级别方法的参数规则一样：
     *
     *   - **纯对象**（原型是 `Object.prototype` 或 `null`）→ 自有字段铺在记录顶层
     *   - **`Error`** → 展开成 `message` + `stack` 两个字段
     *   - **其余**（字符串、数字、数组、`Date`、类实例……）→ 序列化后拼进 `msg`
     *
     * `time` / `level` / `msg` / `name` 是保留字段：业务对象里的同名键会被丢弃，
     * 信封值永远赢。`name` 只能由 `child({ name })` 设置。
     */
    info(...args: unknown[]): void;
    /** 记一条 warn。和 info 一样攒批，但会立即写出，并把积压一起带出去。 */
    warn(...args: unknown[]): void;
    /** 记一条 error。立即写出，并把积压一起带出去。只有它默认带调用栈。 */
    error(...args: unknown[]): void;
    /**
     * 派生一个 logger：`fields` 里的固定字段带进它的每条记录，`name` 单独写进
     * 记录的 name 字段。
     *
     * 子 logger 在创建时**快照**父级的 sink 列表——之后给父级 `addSink`，子 logger
     * 收不到。要统一落点，就在启动早期建 child，或直接给 child 挂 sink。
     */
    child(fields: Record<string, unknown> & {
        name?: string;
    }): Logger;
    /** 挂一个 sink。sink 一次收到一批记录，不是一条一条。 */
    addSink(sink: Sink): void;
    /** 摘掉一个 sink。 */
    removeSink(sink: Sink): void;
    /** 改级别。低于新级别的记录直接丢弃。 */
    setLevel(level: Level): void;
    /**
     * 立刻把缓冲区写出去。
     *
     * info 默认攒批 100ms 才写——测试里断言 sink 收到的记录之前，必须先 flush 一次。
     */
    flush(): void;
    /**
     * 冲掉缓冲 + 关掉定时器 + 调用 sink 的 close（如果有）。
     *
     * 调用之后（含子 logger，因为父子共用状态）日志静默丢弃。进程退出前调一次。
     */
    dispose(): void;
}
export declare function newLogger(options?: LoggerOptions): Logger;
