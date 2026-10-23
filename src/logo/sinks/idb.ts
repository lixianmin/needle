import { formatLine } from "../line.js";
import { LEVELS, type Level, type LogFileEntry, type LogFiles, type LogRecord, type Sink } from "../types.js";

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

/** 级联虚拟文件候选（低 → 高），语义与 createFileSink 一致。 */
const CASCADE_LEVELS: readonly Level[] = ["debug", "info", "warn", "error"];

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
export type LogStore = Sink & LogFiles & { close(): void };

/** 把 IDBRequest 变成 Promise，事务内的连续请求用 await 串起来。 */
function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 事务完成（或失败）的 Promise。失败走 reject，让上层统一报错。 */
function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

function clipLine(line: string): string {
  return line.length > SAMPLE_LINE_MAX_CHARS ? line.slice(0, SAMPLE_LINE_MAX_CHARS) : line;
}

/** 把记录按级联规则分桶并格式化成行——list 与 read 共用这一趟。 */
function bucketize(records: readonly LogRecord[], minLevel: Level): Map<Level, string[]> {
  const buckets = new Map<Level, string[]>();
  for (const level of CASCADE_LEVELS) {
    if (LEVELS[level] < LEVELS[minLevel]) {
      continue;
    }
    const lines: string[] = [];
    for (const record of records) {
      if (LEVELS[record.level] >= LEVELS[level]) {
        lines.push(formatLine(record));
      }
    }
    if (lines.length > 0) {
      buckets.set(level, lines);
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
export function createIndexedDbStore(options: IndexedDbStoreOptions = {}): LogStore {
  const name = options.name ?? DEFAULT_DB_NAME;
  const keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const minLevel = options.minLevel ?? "info";
  const now = options.now ?? Date.now;

  let closed = false;
  let failed = false;
  let failureReported = false;
  let db: IDBDatabase | null = null;

  // 对齐 logo.ts 的 reportSinkError：只提示一次，刷屏比沉默更糟。
  function reportOnce(error: unknown): void {
    if (failureReported) {
      return;
    }
    failureReported = true;
    console.error("[logo] IndexedDB store 不可用，日志不再落本机:", error);
  }

  const ready = new Promise<void>((resolve) => {
    const factory = globalThis.indexedDB;
    // 无痕模式 / 部分 WebView 里全局直接缺失：降级成空 store，不打扰业务。
    if (factory === undefined) {
      failed = true;
      resolve();
      return;
    }
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      store.createIndex(TIME_INDEX, "time");
    };
    request.onsuccess = () => {
      db = request.result;
      resolve();
    };
    request.onerror = () => {
      failed = true;
      resolve();
    };
    request.onblocked = () => {
      // 旧版本连接被别的上下文占着：按失败处理，别把整条 promise 链卡死。
      failed = true;
      resolve();
    };
  });

  // 所有操作串在一条链上：读排在写后面才有 read-after-write；写与写之间保序。
  let tail: Promise<void> = ready;

  function enqueue(op: (database: IDBDatabase) => Promise<void>): void {
    tail = tail
      .then(() => {
        if (closed || failed || db === null) {
          return;
        }
        return op(db);
      })
      .catch((error: unknown) => {
        reportOnce(error);
      });
  }

  function query<T>(op: (database: IDBDatabase) => Promise<T>, fallback: T): Promise<T> {
    return tail
      .then(() => {
        if (closed || failed || db === null) {
          return fallback;
        }
        return op(db as IDBDatabase);
      })
      .catch(() => fallback);
  }

  function readAll(database: IDBDatabase): Promise<LogRecord[]> {
    const tx = database.transaction(STORE_NAME, "readonly");
    return awaitRequest(tx.objectStore(STORE_NAME).getAll() as IDBRequest<unknown[]>).then((all) =>
      all as LogRecord[],
    );
  }

  /** 与写同一事务的清理：过期按时间索引删，超限按主键（入库顺序）删最旧。 */
  async function prune(store: IDBObjectStore): Promise<void> {
    const cutoff = now() - keepDays * MS_PER_DAY;
    const expiredKeys = await awaitRequest(
      store.index(TIME_INDEX).getAllKeys(IDBKeyRange.upperBound(cutoff, true)),
    );
    for (const key of expiredKeys) {
      store.delete(key);
    }

    const total = (await awaitRequest(store.count())) - expiredKeys.length;
    const overflow = total - maxRecords;
    if (overflow <= 0) {
      return;
    }
    let remaining = overflow;
    // 游标翻页的正解是复用同一个 request：continue() 之后它的 success 会再响一次。
    const cursorRequest = store.openCursor();
    let cursor = await awaitRequest(cursorRequest);
    while (cursor !== null && remaining > 0) {
      cursor.delete();
      remaining -= 1;
      cursor.continue();
      cursor = await new Promise<IDBCursorWithValue | null>((resolve) => {
        cursorRequest.onsuccess = () => resolve(cursorRequest.result);
      });
    }
  }

  const sink = ((batch: readonly LogRecord[]): void => {
    if (closed || batch.length === 0) {
      return;
    }
    const records = batch.filter((record) => LEVELS[record.level] >= LEVELS[minLevel]);
    if (records.length === 0) {
      return;
    }
    enqueue(async (database) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const record of records) {
        store.put(record);
      }
      await prune(store);
      await awaitTransaction(tx);
    });
  }) as LogStore;

  sink.list = (): Promise<LogFileEntry[]> =>
    query(async (database) => {
      const records = await readAll(database);
      const entries: LogFileEntry[] = [];
      for (const [level, lines] of bucketize(records, minLevel)) {
        // modified 取该文件最新一行的时间；size 按「行 + 换行」估字节，展示用。
        const lastLine = lines[lines.length - 1];
        entries.push({
          name: `${level}.log`,
          size: lines.reduce((total, line) => total + line.length + 1, 0),
          modified: lastLine === undefined ? 0 : parseTime(lastLine),
          sample: lines.slice(-SAMPLE_LINES).map(clipLine).join("\n"),
        });
      }
      return entries;
    }, []);

  sink.read = (logName: string): Promise<string | null> =>
    query(async (database) => {
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
  function levelOfName(logName: string): Level | null {
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

  /** 行前缀是秒级时间戳 `2026-10-22T15:04:05`（东八区），反解回 epoch 毫秒展示用。 */
  function parseTime(line: string): number {
    const stamp = line.slice(0, line.indexOf(" "));
    const parsed = Date.parse(`${stamp}+08:00`);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  sink.close = (): void => {
    closed = true;
    db?.close();
    db = null;
  };

  return sink;
}
