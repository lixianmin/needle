import type { LogRecord, Sink } from "../logo/types.js";

/** 既是 sink（能被 logger 收下），又能被控制台按时间顺序读出来。 */
export type RingSink = Sink & { read(count?: number): LogRecord[] };

/**
 * 定长环形缓冲。
 *
 * 用写指针而不是数组 shift()：shift 每次搬动整个数组，写满一次就是 O(n²)，
 * 而这里正是"日志很多"的场景。指针版本的写入永远是 O(1)。
 */
export function createRingSink(size: number): RingSink {
  if (size <= 0) throw new RangeError("ring 容量必须为正数");

  const slots: LogRecord[] = new Array(size);
  let next = 0;
  let total = 0;

  const sink = ((batch: readonly LogRecord[]) => {
    for (const record of batch) {
      slots[next] = record;
      next = (next + 1) % size;
      total = Math.min(total + 1, size);
    }
  }) as RingSink;

  sink.read = (count = size) => {
    const take = Math.min(count, total);
    const oldest = (next - total + size * 2) % size;
    const from = (oldest + total - take) % size;

    const out: LogRecord[] = [];
    for (let i = 0; i < take; i += 1) {
      out.push(slots[(from + i) % size] as LogRecord);
    }
    return out;
  };

  return sink;
}
