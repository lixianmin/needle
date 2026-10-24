import { readFileSync } from "node:fs";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { applyEnv, assertRequired, createConfig, deepMerge, type Config, type EnvLike } from "./config.js";

export type { Config } from "./config.js";

/** 只认这三种环境；写错的 ENV 会在启动时直接报错，而不是变成"找不到文件"。 */
export const SUPPORTED_ENVS = ["dev", "fat", "pro"] as const;

export interface LoadConfigOptions {
  /** 配置目录，默认 "config"（相对 process.cwd()）。 */
  dir?: string;
  /** 环境名，默认 process.env.ENV ?? "dev"；必须是 dev / fat / pro。 */
  env?: string;
  /** 环境变量源，默认 process.env。 */
  envVars?: EnvLike;
  /** 环境变量前缀，默认 "APP_"。 */
  envPrefix?: string;
  /** 必填的点分路径，如 ["auth.secret"]。 */
  required?: readonly string[];
}

function parseYamlFile(path: string): Record<string, unknown> {
  const parsed: unknown = parse(readFileSync(path, "utf8"));
  if (parsed === null || parsed === undefined) {
    // 空文件是合法的：环境文件只写差异项时可能是空集。
    return {};
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: 配置顶层必须是对象`);
  }
  return parsed as Record<string, unknown>;
}

/** 通用配置缺失是常态（新项目只写环境文件），环境文件缺失则是配置错。 */
function readCommon(path: string): Record<string, unknown> {
  try {
    return parseYamlFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/**
 * 加载顺序：`<dir>/common.yml` → `<dir>/app_<env>.yml` → `APP_*` 环境变量 → 必填检查。
 *
 * 环境名取 `ENV`（照 rim.server：默认 DEV），只接受 dev / fat / pro。
 * 这是**唯一**读 `process.env.ENV` 的地方；业务侧一律用 `config.isPro()` 这类方法判断，
 * 不要再自己去看环境变量。
 *
 * 返回值是 viper 风格的取值器（`config.getInt("server.web_port")`），不是裸对象：
 * 点分路径的兼容、缺值报错、`APP_SERVER__WEB_PORT` 这类覆盖都收在这一层。
 */
export function loadConfig<C extends Record<string, unknown>>(
  options: LoadConfigOptions = {},
): Config<C> {
  const dir = resolve(process.cwd(), options.dir ?? "config");
  const env = String(options.env ?? process.env.ENV ?? "dev").toLowerCase();
  if (!(SUPPORTED_ENVS as readonly string[]).includes(env)) {
    throw new Error(`ENV 只支持 ${SUPPORTED_ENVS.join(" / ")}：${env}`);
  }

  const common = readCommon(join(dir, "common.yml"));

  const envPath = join(dir, `app_${env}.yml`);
  let envConfig: Record<string, unknown>;
  try {
    envConfig = parseYamlFile(envPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`找不到环境配置：${envPath}（ENV=${env}）`);
    }
    throw error;
  }

  const merged = deepMerge(common, envConfig);
  const withEnv = applyEnv(merged, options.envVars ?? process.env, options.envPrefix ?? "APP_");
  assertRequired(withEnv, options.required ?? []);
  return createConfig(withEnv as C, env);
}

/**
 * 从网卡 MAC 派生 10 位机器号（0..1023）。
 *
 * 取所有非内部的 MAC，排序后 FNV-1a 哈希：同一台机器每次算出同一个号，
 * 不用配置。注意容器（Docker 默认）每次重建 MAC 都会变——多实例部署请显式
 * 配 nodeId，别依赖这里。
 */
export function nodeIdFromMac(): number {
  const macs = Object.values(networkInterfaces())
    .flat()
    .filter(
      (entry): entry is NetworkInterfaceInfo =>
        entry !== undefined && !entry.internal && entry.mac !== "" && entry.mac !== "00:00:00:00:00:00",
    )
    .map((entry) => entry.mac)
    .sort();
  if (macs.length === 0) {
    throw new Error("找不到可用的网卡 MAC：请显式配置 nodeId");
  }

  // FNV-1a 32 位：够把 MAC 摊开，也不引依赖。
  let hash = 0x811c9dc5;
  for (const char of macs.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & 0x3ff;
}
