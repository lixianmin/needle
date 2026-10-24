import { type Level, type LogFiles, type Sink } from "../types.js";
export interface IndexedDbStoreOptions {
    /** 数据库名。默认 "needle-logs"；多应用同源共存时各自命名。 */
    name?: string;
    /** 保留天数，默认 7。 */
    keepDays?: number;
    /** 记录条数上限，默认 5000。 */
    maxRecords?: number;
    /** 低于这个级别的记录写入时直接丢弃，默认 "info"；开 debug 日志时传 "debug"。 */
    minLevel?: Level;
    /** 注入时间，测试用。 */
    now?: () => number;
}
/** 一个对象两个身份：写走 Sink，读走 LogFiles（log.list / 点文件名）。 */
export type LogStore = Sink & LogFiles & {
    close(): void;
};
/**
 * 浏览器端的日志存储：写是 Sink，读是 LogFiles。
 *
 * 性能的关键在「一批一个事务」：sink 收到的 batch 在单个 readwrite 事务里
 * 连续 put、一次 commit——IndexedDB 的开销几乎全在事务上，逐条开事务会把
 * 主线程 IO 打满。清理（过期 + 超限）搭同一趟事务的车，不单开。
 */
export declare function createIndexedDbStore(options?: IndexedDbStoreOptions): LogStore;
