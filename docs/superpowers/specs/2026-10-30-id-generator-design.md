# id 生成：UUIDv7 位布局 + Crockford Base32

日期：2026-10-30
状态：已批准（人类口头指示：26 位、Crockford Base32 编码 UUIDv7、不要 ULID、不要机器号）

## 1. 意图

`@needle/got` 里原来有两套 id 生成（`nextUlid()` 与 `nextSnowflakeId()` / `createSnowflake()` / `parseSnowflake()`）。用户给的需求是**一套 id 覆盖全部场景**：

- 尽量短；
- 不依赖机器号（Snowflake 的 `nodeId` 要靠部署配置保证唯一，38 个实例撞号概率就过半）；
- 能当请求 id（rid / trace id）；
- 能当数据库主键：时间在最前，B-tree 只追加、不回头插页；
- 能当用户 id 分享、口头念、贴 URL；
- 多机器之间重号概率极低。

结论：**128 位 UUIDv7 位布局 + 26 位大写 Crockford Base32 文本 + 同一毫秒内随机段当计数器**。ULID 与 Snowflake 从 `@needle/got` 删除。

## 2. 候选方案与取舍

| 方案 | 位数 / 长度 | 随机位 | 无机器号 | 可排序 | 结论 |
|---|---|---|---|---|---|
| 纯随机 ULID（原 `nextUlid`） | 128 / 26 | 80 | ✓ | 仅跨毫秒 | 否：同一毫秒内约一半 id 比前一个小（实测 20 万次倒退 99818 次），不能当主键 |
| Snowflake（原 `nextSnowflakeId`） | 63 / 13 | 0（序列） | ✗ | ✓ | 否：要机器号，撞号即同毫秒重号 |
| ObjectId | 96 / 24 hex | 40 + 24 位计数器 | ✓ | 仅秒级 | 否：同一秒内 100 万个 id 时跨进程撞号概率约 0.45 |
| CUID2 | 192 / 24+ | 全部 | ✓ | ✗ | 否：不可排序，作主键等于 UUIDv4 的随机插页 |
| **UUIDv7 + Base32（选定）** | 128 / 26 | 74 | ✓ | ✓ | 选定 |

为什么保留 UUIDv7 的 version / variant 两位段（共 6 位不参与熵）：换来的是同样的 16 字节能直接写进 UUID 列、和外部系统对接（`nextIdUuid()` / `idToUuid()`）。代价是随机段 74 位而不是 ULID 的 80 位——跨机器同毫秒撞号要两台机器抽出同一个 74 位随机数，2⁻⁷⁴ 量级，任何真实流量都可以忽略。

为什么用 Crockford Base32 而不是 base62 / base64：`0-9A-Z` 去掉 `I L O U` 后大小写不敏感、不含易混字符、URL 安全，5 位/字符正好把 128 位装进 26 个字符（130 位容量里高 2 位补零）。

## 3. 位布局

```
128 位 = 48 位毫秒 | 4 位 version(=7) | 12 位 rand_a | 2 位 variant(=10) | 62 位 rand_b
                    └── 时间，可排序 ──┘└──────── 随机段 74 位，同毫秒单调 ────────┘
```

文本：26 位大写 Crockford Base32。130 位字符容量 = 2 位补零 + 128 位值，所以时间位落在最前面，跨毫秒字典序 = 时间序；同一毫秒内随机段 +1，所以**同毫秒也严格递增**。

## 4. 算法不变量

1. **同毫秒单调**：同一毫秒内每次调用把 74 位随机段当计数器 +1（带进位），不是重抽随机（RFC 9562 §6.2 Method 2）。
2. **随机段耗尽**：74 位全满（同一毫秒 2⁷⁴ 个 id，实际不可达）→ 时间前进 1ms 并重抽随机段，不重号。
3. **时钟回拨**：按「同一毫秒」处理，继续 +1，不抛错。id 生成不该因为 NTP 抖动让业务失败；单调性比时间精确更重要。48 位时间已到上限再耗尽才抛错（不静默回绕）。
4. **状态在生成器上**：模块级单例 `nextId()` 保证单调；`createIdGenerator()` 每次新建等于每次重抽随机段，**只用于测试或需要独立序列的场合**。
5. **不 import `node:`**：随机源用 `globalThis.crypto.getRandomValues`，浏览器 / Workers 同样可用。

## 5. API（`@needle/got` 根入口）

```ts
createIdGenerator({ now?, random? }): { next(), nextBytes(), nextUuid() }
nextId(): string           // 26 位大写 Crockford，主键 / rid / 用户 id
nextIdBytes(): Uint8Array  // 16 字节，BINARY(16) 主键
nextIdUuid(): string       // UUIDv7 规范文本，给只收 UUID 的外部系统
nextRandomId(): string     // 纯随机 26 位，只给「id 本身就是凭据」的场景
parseId(id): { timeMs }    // 排障：从 id 里读回毫秒
idToUuid(id): string       // 26 位 → UUIDv7 文本
```

**`nextRandomId()` 存在的唯一理由**：`nextId()` 同一毫秒内是连续 +1，拿到一个 id 就能推出相邻 id——免鉴权的图片 URL、一次性下载链接这类「id 即凭据」的场景不能用它。普通主键、日志 rid、用户 id 一律 `nextId()`。

## 6. 性能

实现全程 number 运算 + 复用缓冲，不碰 `bigint`：时间用除法/取模写进 6 字节，随机段是 10 字节计数器，编码按 5 位一组落进复用的 `Uint8Array(26)`。

实测（`/tmp/bench-id.ts`，50 万次/轮，warmup 后，bun 1.4.4）：

| 实现 | 单次耗时 | 同毫秒倒退（20 万次） |
|---|---|---|
| 原 `nextUlid()` | 5 ns | 99,818 |
| 原 `nextSnowflakeId()` | 1 ns | 0 |
| bigint 版 `MonotonicUuidV7.next()` | 14 ns | 0 |
| 本方案 `nextId()` | 6 ns | 0 |

bigint 版慢在每次调用都分配：bigint 中间值、`Uint8Array(16)`、26 元素数组 + `join`。

## 7. 影响范围

- `@needle/got`：删 `nextUlid` / `nextSnowflakeId` / `createSnowflake` / `parseSnowflake`，新增 `src/id.ts`；`package.json` 描述同步。
- `@needle/honox`：`middleware.ts` 的 rid 生成改 `nextId()`，其余不变（白名单 `^[0-9A-Za-z._-]{1,64}$` 照旧）。
- `examples/honox-app`：`main.ts` 注释与 README 的 rid 说明。
- 下游 `my.jarvis`：全部 `crypto.randomUUID()` 换 `nextId()`；图片 id（免鉴权 URL，属「id 即凭据」）换 `nextRandomId()`。

## 8. 验收

- `packages/got/test/id.test.ts`：位布局（时间 / version / variant）、跨毫秒有序、同毫秒 20 万个严格递增且不重号、进位、随机段耗尽、时钟回拨、时间越界、三种形态（串 / 字节 / UUID）指向同一个 128 位值、非法输入拒绝、`nextRandomId` 不重号。
- 门禁：`bun install && bun run example:install && bun run build && bunx tsc --noEmit && bun test && bun run coverage && bun run example:typecheck && node test/smoke/node.mjs`。
