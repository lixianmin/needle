/** 日志级别，按严重程度递增。 */
export type Level = "debug" | "info" | "warn" | "error";
/**
 * 级别权重。用数值而不是按数组下标比较，是为了让「过滤」和「阈值判断」
 * 都退化成一次整数比较，调用方不需要记住数组顺序。
 */
export declare const LEVELS: Record<Level, number>;
/**
 * 一条日志。前四个键是信封（由库填写），其余由调用方传入的对象合并进来。
 * 记录必须是 JSON 安全的：sink 会直接序列化它，一个循环引用就能让整条日志
 * 在写出时炸掉，而那段代码在最不该出错的路径上。
 */
export interface LogRecord {
    time: number;
    level: Level;
    name?: string;
    msg?: string;
    stack?: string;
    [field: string]: unknown;
}
/**
 * 一次拿到一批记录，而不是一条一条喂。
 *
 * 理由很具体：一个循环里连写 1000 条日志，逐条传就是 1000 次 IO。
 * 批量契约把「合并」这件事固定下来，任何 sink 都自动受益。
 */
export type Sink = (batch: readonly LogRecord[]) => void;
/** 日志文件条目。由宿主注入（Node 侧读磁盘，Workers 侧没有）。 */
export interface LogFileEntry {
    name: string;
    size: number;
    /** epoch 毫秒 */
    modified: number;
    /** 文件末尾几行的预览，hover tips 用；读不到时为空串。 */
    sample?: string;
}
/**
 * 日志文件的读取端口。
 *
 * 库本身不认识 fs —— 浏览器/Workers 里没有文件系统。Node 入口提供实现，
 * 没注入时 log.list 会明确说"未配置"。
 */
export interface LogFiles {
    list(): Promise<LogFileEntry[]>;
    /** 读取整个文件；不在白名单内返回 null。 */
    read(name: string): Promise<string | null>;
}
