import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { applyEnv, assertRequired, deepMerge, type EnvLike } from "./config.js";

export interface LoadConfigOptions {
  /** 配置目录，默认 "config"（相对 process.cwd()）。 */
  dir?: string;
  /** 环境名，默认 process.env.ENV ?? "dev"；转小写后拼文件名。 */
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
 * env 不做白名单：工具库硬编码业务环境名（DEV/FAT/UAT…）会把别处的约定带进来，
 * 写错环境名的表现就是文件不存在，报错里带 ENV 值足够定位。
 */
export function loadConfig<C extends Record<string, unknown>>(options: LoadConfigOptions = {}): C {
  const dir = resolve(process.cwd(), options.dir ?? "config");
  const env = (options.env ?? process.env.ENV ?? "dev").toLowerCase();

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
  return withEnv as C;
}
