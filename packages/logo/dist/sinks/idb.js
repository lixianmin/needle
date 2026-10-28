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
/**
 * 把 IDBRequest 变成 Promise，事务内的连续请求用 await 串起来。
 *
 * 导出是为了测错误分支：fake-indexeddb 里造不出「请求失败」「事务中途 abort」
 * 的确定性场景，而这两条路径一旦写错就是整条 tail 链永久卡住。
 */
export function awaitRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
/** 事务完成（或失败）的 Promise。失败走 reject，让上层统一报错。导出理由同上。 */
export function awaitTransaction(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
}
/**
 * 等游标的下一次回调。
 *
 * 必须复用同一个 request（`continue()` 之后 success 会再响一次），也必须挂 onerror：
 * 事务中途 abort 时 success 不会再来，promise 永不落地会把整条 tail 链永久卡死。
 * 导出是为了测这两条路径——fake-indexeddb 造不出「游标请求失败」。
 */
export function nextCursor(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("cursor failed"));
    });
}
function clipLine(line) {
    // Stryker disable next-line ConditionalExpression,EqualityOperator: 对不超过上限的行，slice(0, 200) 返回的就是原串——条件只为省一次切片
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
    let failureReported = false;
    let db = null;
    /**
     * 队列里还有没跑完的写操作：决定 open 完成时能不能立刻关连接。
     *
     * 只关心「有没有」而不是「几条」——这个判断只在 open 完成那一刻做一次。
     */
    let queuedWork = false;
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
        // 之后所有操作都以 `db === null` 判定降级，不再单独维护一个 failed 标志：
        // 它与 `db === null` 逐条重合（只有 open 成功才会拿到连接），双份状态只会漂移。
        if (factory === undefined) {
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
            const connection = request.result;
            // 已经 close 且没排队工作：不能把连接留在手里——它会一直挡住
            // 其它上下文的版本升级。还有排队工作的 close 例外：写入要用它，
            // 关连接排在队尾那一步。
            if (closed && !queuedWork) {
                connection.close();
                resolve();
                return;
            }
            // blocked 只是「现在升不上去」：对方让路后这次打开会成功，连接照用。
            db = connection;
            // 别的上下文要升级版本（或在 DevTools 里清站数据）：必须让路。
            // 不挂这个处理器，IDB 会无限期地把对方卡在 blocked 上；但也不能
            // 一声不响地把已排队的批次丢掉——先报一次，再按 close 的语义
            // 停止接受新写入、把关连接排到队尾。
            db.onversionchange = () => {
                reportOnce(new Error("IndexedDB 版本被其它上下文升级，日志存储已停止"));
                sink.close();
            };
            resolve();
        };
        request.onerror = () => {
            // 降级不抛错，但也不能完全无声：一条错误日志是排查这个 store 的唯一线索。
            reportOnce(request.error);
            resolve();
        };
        request.onblocked = () => {
            // 旧版本连接被别的上下文占着：先把 ready 放行，别把 promise 链卡死。
            // 不在这里判 failed——对方让路后 onsuccess 会到来，那时连接照用；
            // 真用不上就等那次 onsuccess 按 closed 规则关掉。
            reportOnce(new Error(`IndexedDB ${name} 升级被其它连接阻塞，等待对方让路`));
            resolve();
        };
    });
    // 所有操作串在一条链上：读排在写后面才有 read-after-write；写与写之间保序。
    let tail = ready;
    /**
     * 一个排队的写操作结束了。
     *
     * 这次复位的读者只有 open 完成时那一次判断，而队列是从 ready 起算的——那一刻
     * 队列里的工作还没开始跑，所以它读到的必然是 true。保留是为了让「有没有排队
     * 工作」这个状态本身始终正确，而不是为了那一次判断。
     */
    // Stryker disable next-line BlockStatement: 见上——清空函数体（不复位）对那次判断无法观测
    function settle() {
        // Stryker disable next-line BooleanLiteral: 复位成 true 等于不复位，同上
        queuedWork = false;
    }
    function enqueue(op) {
        // 关闭之后新来的批次丢弃；但**已排队**的必须写下去——logger.dispose 是
        // 「先 flush（此时入队）再 close」，在这里判 closed 会把最后一批静默吞掉。
        // 所以 closed 只在入队时刻检查一次，不在出队时再查。
        // Stryker disable next-line ConditionalExpression,BlockStatement: close() 会把自己的「关连接」排在队尾，出队时 db 已经是 null，这个判断只是少排一次队
        if (closed) {
            return;
        }
        queuedWork = true;
        tail = tail
            .then(() => {
            // Stryker disable next-line ConditionalExpression,BlockStatement: db 为 null 时 op 必然抛错，同样落到 reportOnce（已被「只提示一次」吞掉），行为等价
            if (db === null) {
                return;
            }
            return op(db);
        })
            .catch((error) => {
            reportOnce(error);
        })
            .finally(settle);
    }
    function query(op, fallback) {
        return tail
            .then(() => {
            // Stryker disable next-line ConditionalExpression: db 为 null 时 op 必然抛错并落到下面的 catch，与这里直接返回 fallback 等价
            if (closed || db === null) {
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
        // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: overflow 为 0 时下面的 `remaining > 0` 自己就不进循环，这个提前返回只是短路
        if (overflow <= 0) {
            return;
        }
        let remaining = overflow;
        // 游标翻页的正解是复用同一个 request：continue() 之后它的 success 会再响一次。
        // 必须挂 onerror：事务中途 abort 时 success 不会再来，promise 永不落地
        // 会把整条 tail 链永久卡死。
        const cursorRequest = store.openCursor();
        let cursor = await awaitRequest(cursorRequest);
        // Stryker disable next-line ConditionalExpression: remaining 由「总数 - 上限」算出，删到这里游标必然还没走完，`cursor !== null` 只是防御
        while (cursor !== null && remaining > 0) {
            cursor.delete();
            remaining -= 1;
            cursor.continue();
            cursor = await nextCursor(cursorRequest);
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
        // Stryker disable next-line ConditionalExpression,BlockStatement: level 为 null 时下面的 `LEVELS[null]` 是 undefined，过滤后必为空，仍然返回 null
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
        // Stryker disable next-line ConditionalExpression,BlockStatement: 重复 close 只是再往队尾排一个「把已经是 null 的 db 关掉」的空操作
        if (closed) {
            return;
        }
        closed = true;
        // 关连接排在队列末尾：已入队的批次先落库。close() 是同步签名，
        // 所以关连接顺着链走，不阻塞调用方。
        tail = tail
            .then(() => {
            // Stryker disable next-line OptionalChaining: db 为 null 时 `db.close()` 会抛错，同样被下面的 catch 吞掉，结果一致
            db?.close();
            db = null;
        })
            .catch(() => { });
    };
    return sink;
}
