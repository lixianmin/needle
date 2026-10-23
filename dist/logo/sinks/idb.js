import { formatLine } from "../line.js";
import { LEVELS } from "../types.js";
/** 默认库名。同源跑多个应用时各自命名，避免互吃对方的日志。 */
const DEFAULT_DB_NAME = "needle-logs";
/** 默认保留天数：报障后一两天内来问都查得到，又不至于无限涨。 */
const DEFAULT_KEEP_DAYS = 7;
/** 默认条数上限：内存与配额的保护，不是丢弃策略。 */
const DEFAULT_MAX_RECORDS = 5_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** tips 预览行数与单行截断，与 Node 侧 createLogFiles 的 sample 口径一致。 */
const SAMPLE_LINES = 5;
const SAMPLE_LINE_MAX_CHARS = 200;
const STORE_NAME = "records";
const TIME_INDEX = "by_time";
/**
 * 库结构版本。
 *
 * v2 的起因：v1 用 `keyPath: "id"`（inline 键），而 `id` 是最常见的业务字段，
 * 记录里的 `id` 会被当成主键——同一个订单 id 的两条日志互相覆盖，静默丢日志。
 * 改成 out-of-line 键（不占用记录里的任何字段）。
 */
const DB_VERSION = 2;
/** 级联虚拟文件候选（低 → 高），语义与 createFileSink 一致。 */
const CASCADE_LEVELS = ["debug", "info", "warn", "error"];
/** 把 IDBRequest 变成 Promise，事务内的连续请求用 await 串起来。 */
function awaitRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
/** 事务完成（或失败）的 Promise。失败走 reject，让上层统一报错。 */
function awaitTransaction(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
}
function clipLine(line) {
    return line.length > SAMPLE_LINE_MAX_CHARS ? line.slice(0, SAMPLE_LINE_MAX_CHARS) : line;
}
/** 把记录按级联规则分桶并格式化成行——list 与 read 共用这一趟。 */
function bucketize(records, minLevel) {
    const buckets = new Map();
    for (const level of CASCADE_LEVELS) {
        if (LEVELS[level] < LEVELS[minLevel]) {
            continue;
        }
        const bucket = { lines: [], modified: 0 };
        for (const record of records) {
            if (LEVELS[record.level] >= LEVELS[level]) {
                bucket.lines.push(formatLine(record));
                // modified 取桶内最大 time：比从行前缀反解精确（毫秒），乱序批次也对
                bucket.modified = Math.max(bucket.modified, record.time);
            }
        }
        if (bucket.lines.length > 0) {
            buckets.set(level, bucket);
        }
    }
    return buckets;
}
/**
 * 浏览器端的日志存储：写是 Sink，读是 LogFiles。
 *
 * 性能的关键在「一批一个事务」：sink 收到的 batch 在单个 readwrite 事务里
 * 连续 put、一次 commit——IndexedDB 的开销几乎全在事务上，逐条开事务会把
 * 主线程 IO 打满。清理（过期 + 超限）搭同一趟事务的车，不单开。
 */
export function createIndexedDbStore(options = {}) {
    const name = options.name ?? DEFAULT_DB_NAME;
    const keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS;
    const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    const minLevel = options.minLevel ?? "info";
    const now = options.now ?? Date.now;
    let closed = false;
    let failed = false;
    let failureReported = false;
    let db = null;
    /** 已入队、尚未执行完的写操作数：决定 open 完成时能不能立刻关连接。 */
    let pending = 0;
    // 对齐 logo.ts 的 reportSinkError：只提示一次，刷屏比沉默更糟。
    // 文案不写死「日志不再落本机」：读失败、升级被挡也走这里，不一定意味着写不进去。
    function reportOnce(error) {
        if (failureReported) {
            return;
        }
        failureReported = true;
        console.error("[logo] IndexedDB 日志存储出错（同类错误不再提示）:", error);
    }
    const ready = new Promise((resolve) => {
        const factory = globalThis.indexedDB;
        // 无痕模式 / 部分 WebView 里全局直接缺失：降级成空 store，不打扰业务。
        if (factory === undefined) {
            failed = true;
            resolve();
            return;
        }
        const request = factory.open(name, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            // v1 的布局是 inline keyPath: "id"，重建掉——日志是易失数据，
            // 为它写迁移拷贝不值当，而且旧数据正是可能有丢失的那批。
            if (database.objectStoreNames.contains(STORE_NAME)) {
                database.deleteObjectStore(STORE_NAME);
            }
            // 不传 keyPath：键与记录内容彻底分开，业务字段叫什么都不会撞车。
            const store = database.createObjectStore(STORE_NAME, { autoIncrement: true });
            store.createIndex(TIME_INDEX, "time");
        };
        request.onsuccess = () => {
            // 判过失败（如被旧连接挡住），或者已经 close 且没排队工作：
            // 都不能把连接留在手里——它会一直挡住其它上下文的版本升级。
            // 还有排队工作的 close 例外：写入要用它，关连接排在队尾那一步。
            if (failed || (closed && pending === 0)) {
                request.result.close();
                resolve();
                return;
            }
            db = request.result;
            // 别的上下文要升级版本（或在 DevTools 里清站数据）：必须主动让路。
            // 不挂这个处理器，IDB 会无限期地把对方的升级卡在 blocked 上。
            db.onversionchange = () => {
                db?.close();
                db = null;
                closed = true;
            };
            resolve();
        };
        request.onerror = () => {
            failed = true;
            // 降级不抛错，但也不能完全无声：一条错误日志是排查这个 store 的唯一线索。
            reportOnce(request.error);
            resolve();
        };
        request.onblocked = () => {
            // 旧版本连接被别的上下文占着：按失败处理，别把整条 promise 链卡死。
            failed = true;
            reportOnce(new Error(`IndexedDB ${name} 升级被其它连接阻塞`));
            resolve();
        };
    });
    // 所有操作串在一条链上：读排在写后面才有 read-after-write；写与写之间保序。
    let tail = ready;
    function enqueue(op) {
        // 关闭之后新来的批次丢弃；但**已排队**的必须写下去——logger.dispose 是
        // 「先 flush（此时入队）再 close」，在这里判 closed 会把最后一批静默吞掉。
        // 所以 closed 只在入队时刻检查一次，不在出队时再查。
        if (closed) {
            return;
        }
        pending += 1;
        tail = tail
            .then(() => {
            if (failed || db === null) {
                return;
            }
            return op(db);
        })
            .catch((error) => {
            reportOnce(error);
        })
            .finally(() => {
            pending -= 1;
        });
    }
    function query(op, fallback) {
        return tail
            .then(() => {
            if (closed || failed || db === null) {
                return fallback;
            }
            return op(db);
        })
            .catch((error) => {
            // 读失败不能默默当成「没有日志」：报障时两者必须能区分开。
            reportOnce(error);
            return fallback;
        });
    }
    async function readAll(database) {
        const tx = database.transaction(STORE_NAME, "readonly");
        const all = await awaitRequest(tx.objectStore(STORE_NAME).getAll());
        // 键是 out-of-line 的，记录原样就是调用方给的那条，不需要剥任何字段。
        return all;
    }
    /** 与写同一事务的清理：过期按时间索引删，超限按主键（入库顺序）删最旧。 */
    async function prune(store) {
        const cutoff = now() - keepDays * MS_PER_DAY;
        const expiredKeys = await awaitRequest(store.index(TIME_INDEX).getAllKeys(IDBKeyRange.upperBound(cutoff, true)));
        for (const key of expiredKeys) {
            store.delete(key);
        }
        const total = await awaitRequest(store.count());
        const overflow = total - maxRecords;
        if (overflow <= 0) {
            return;
        }
        let remaining = overflow;
        // 游标翻页的正解是复用同一个 request：continue() 之后它的 success 会再响一次。
        // 必须挂 onerror：事务中途 abort 时 success 不会再来，promise 永不落地
        // 会把整条 tail 链永久卡死。
        const cursorRequest = store.openCursor();
        let cursor = await awaitRequest(cursorRequest);
        while (cursor !== null && remaining > 0) {
            cursor.delete();
            remaining -= 1;
            cursor.continue();
            cursor = await new Promise((resolve, reject) => {
                cursorRequest.onsuccess = () => resolve(cursorRequest.result);
                cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("cursor failed"));
            });
        }
    }
    const sink = ((batch) => {
        if (closed || batch.length === 0) {
            return;
        }
        const records = batch.filter((record) => LEVELS[record.level] >= LEVELS[minLevel]);
        if (records.length === 0) {
            return;
        }
        enqueue(async (database) => {
            const tx = database.transaction(STORE_NAME, "readwrite");
            // 完成监听要在事务还没提交时就挂上：事务一旦没有待处理请求就会提交，
            // 干完活再挂可能错过 oncomplete，promise 永不落地会把整条 tail 链卡死。
            const done = awaitTransaction(tx);
            // 失败路径上不再 await done，先接住拒绝，免得变成 unhandled rejection。
            done.catch(() => { });
            const store = tx.objectStore(STORE_NAME);
            for (const record of records) {
                try {
                    store.put(record);
                }
                catch (error) {
                    // 单条写不进去（不可结构克隆的值等）不能拖累同批其余记录：
                    // 抛出去会让后面所有记录一起丢，而日志 sink 绝不能因为一条脏数据
                    // 把整批证据吞掉。
                    reportOnce(error);
                }
            }
            await prune(store);
            await done;
        });
    });
    sink.list = () => query(async (database) => {
        const records = await readAll(database);
        const entries = [];
        for (const [level, bucket] of bucketize(records, minLevel)) {
            // size 按「行 + 换行」估字节，展示用
            entries.push({
                name: `${level}.log`,
                size: bucket.lines.reduce((total, line) => total + line.length + 1, 0),
                modified: bucket.modified,
                sample: bucket.lines.slice(-SAMPLE_LINES).map(clipLine).join("\n"),
            });
        }
        return entries;
    }, []);
    sink.read = (logName) => query(async (database) => {
        const level = levelOfName(logName);
        if (level === null) {
            return null;
        }
        const records = await readAll(database);
        // 名单内的文件没内容 = 文件不存在（list 也不会列它），与 Node 侧口径一致。
        const lines = records
            .filter((record) => LEVELS[record.level] >= LEVELS[level])
            .map((record) => formatLine(record));
        return lines.length === 0 ? null : lines.join("\n");
    }, null);
    /** 名单 = [minLevel, error] 里每个级别的 <level>.log；名单外一律 null。 */
    function levelOfName(logName) {
        for (const level of CASCADE_LEVELS) {
            if (LEVELS[level] < LEVELS[minLevel]) {
                continue;
            }
            if (logName === `${level}.log`) {
                return level;
            }
        }
        return null;
    }
    sink.close = () => {
        if (closed) {
            return;
        }
        closed = true;
        // 关连接排在队列末尾：已入队的批次先落库。close() 是同步签名，
        // 所以关连接顺着链走，不阻塞调用方。
        tail = tail
            .then(() => {
            db?.close();
            db = null;
        })
            .catch(() => { });
    };
    return sink;
}
