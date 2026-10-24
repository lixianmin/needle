import { MongoClient } from "mongodb";
/**
 * 连接由 driver 自己管：`MongoClient` 在第一次操作时才建连，这里不调 `connect()`。
 * 好处是启动不依赖 Mongo 可不可达——连不上时错在读它的那次请求上，而不是启动时。
 *
 * 事务边界由业务决定，所以没有"每请求自动开事务"的中间件：
 * 事务范围跟业务操作绑定，库猜不出来。
 */
export function createMongo(options) {
    const client = options.client ?? new MongoClient(options.uri);
    const owned = options.client === undefined;
    let closed = false;
    return {
        client,
        db() {
            return options.db === undefined ? client.db() : client.db(options.db);
        },
        withTransaction(fn) {
            // driver 的 withTransaction 自带 transient / unknown-commit 重试，不再包一层。
            return client.withSession((session) => session.withTransaction(() => fn(session)));
        },
        async close() {
            if (closed || !owned) {
                return;
            }
            closed = true;
            await client.close();
        },
    };
}
