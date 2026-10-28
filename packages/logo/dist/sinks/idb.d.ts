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
 * 把 IDBRequest 变成 Promise，事务内的连续请求用 await 串起来。
 *
 * 导出是为了测错误分支：fake-indexeddb 里造不出「请求失败」「事务中途 abort」
 * 的确定性场景，而这两条路径一旦写错就是整条 tail 链永久卡住。
 */
export declare function awaitRequest<T>(request: IDBRequest<T>): Promise<T>;
/** 事务完成（或失败）的 Promise。失败走 reject，让上层统一报错。导出理由同上。 */
export declare function awaitTransaction(tx: IDBTransaction): Promise<void>;
/**
 * 等游标的下一次回调。
 *
 * 必须复用同一个 request（`continue()` 之后 success 会再响一次），也必须挂 onerror：
 * 事务中途 abort 时 success 不会再来，promise 永不落地会把整条 tail 链永久卡死。
 * 导出是为了测这两条路径——fake-indexeddb 造不出「游标请求失败」。
 */
export declare function nextCursor(request: IDBRequest<IDBCursorWithValue | null>): Promise<IDBCursorWithValue | null>;
/**
 * 浏览器端的日志存储：写是 Sink，读是 LogFiles。
 *
 * 性能的关键在「一批一个事务」：sink 收到的 batch 在单个 readwrite 事务里
 * 连续 put、一次 commit——IndexedDB 的开销几乎全在事务上，逐条开事务会把
 * 主线程 IO 打满。清理（过期 + 超限）搭同一趟事务的车，不单开。
 */
export declare function createIndexedDbStore(options?: IndexedDbStoreOptions): LogStore;
//# sourceMappingURL=idb.d.ts.map