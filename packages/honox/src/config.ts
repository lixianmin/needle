/** 环境变量源。测试注入用，生产就是 process.env。 */
export interface EnvLike {
  readonly [key: string]: string | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 环境变量只有字符串；`true/false` 与纯数字要还原成布尔/数字，
 * 否则配置在不同来源下的类型不一致，业务代码得自己再转一遍。
 */
export function coerceValue(raw: string): unknown {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  const trimmed = raw.trim();
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return raw;
}

/**
 * 对象递归合并、数组整体替换——与 rim.proxy 的 `_deepMerge` 同语义。
 * 返回新对象，不改入参：调用方可能共用一份基础配置。
 */
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

/** 按点分路径写值，中间层不存在就建对象。 */
function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    if (!isPlainObject(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]!] = value;
}

/**
 * 环境变量覆盖：`APP_AUTH__SECRET` → `auth.secret`。
 * 用双下划线分隔路径，因为单个下划线在变量名里太常见。
 */
export function applyEnv(
  base: Record<string, unknown>,
  env: EnvLike,
  prefix: string,
): Record<string, unknown> {
  const result = deepMerge(base, {});
  for (const [key, raw] of Object.entries(env)) {
    if (raw === undefined || !key.startsWith(prefix)) {
      continue;
    }
    const name = key.slice(prefix.length);
    if (name === "") {
      continue;
    }
    setPath(result, name.toLowerCase().split("__"), coerceValue(raw));
  }
  return result;
}

/** 必填项检查：缺失、或值是空字符串，都算没配。 */
export function assertRequired(config: Record<string, unknown>, required: readonly string[]): void {
  const missing = required.filter((path) => {
    let value: unknown = config;
    for (const key of path.split(".")) {
      if (!isPlainObject(value) || !(key in value)) {
        return true;
      }
      value = value[key];
    }
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw new Error(`配置缺少必填项：${missing.join("、")}（来源：config 目录 + 环境变量覆盖）`);
  }
}
