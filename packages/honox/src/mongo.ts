import { MongoClient, type ClientSession, type Db } from "mongodb";

export interface MongoOptions {
  uri: string;
  /** 不传就用连接串里的库名（driver 默认行为）。 */
  db?: string;
  /** 复用宿主已有的连接池；传了就不由这里关。 */
  client?: MongoClient;
}

export interface Mongo {
  readonly client: MongoClient;
  db(): Db;
  withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * 连接由 driver 自己管：`MongoClient` 在第一次操作时才建连，这里不调 `connect()`。
 * 好处是启动不依赖 Mongo 可不可达——连不上时错在读它的那次请求上，而不是启动时。
 *
 * 事务边界由业务决定，所以没有"每请求自动开事务"的中间件：
 * 事务范围跟业务操作绑定，库猜不出来。
 */
export function createMongo(options: MongoOptions): Mongo {
  const client = options.client ?? new MongoClient(options.uri);
  const owned = options.client === undefined;
  let closed = false;

  return {
    client,
    db(): Db {
      return options.db === undefined ? client.db() : client.db(options.db);
    },
    withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
      // driver 的 withTransaction 自带 transient / unknown-commit 重试，不再包一层。
      return client.withSession((session) => session.withTransaction(() => fn(session)));
    },
    async close(): Promise<void> {
      if (closed || !owned) {
        return;
      }

      closed = true;
      await client.close();
    },
  };
}
