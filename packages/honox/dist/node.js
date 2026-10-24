import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { applyEnv, assertRequired, deepMerge } from "./config.js";
function parseYamlFile(path) {
    const parsed = parse(readFileSync(path, "utf8"));
    if (parsed === null || parsed === undefined) {
        // 空文件是合法的：环境文件只写差异项时可能是空集。
        return {};
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${path}: 配置顶层必须是对象`);
    }
    return parsed;
}
/** 通用配置缺失是常态（新项目只写环境文件），环境文件缺失则是配置错。 */
function readCommon(path) {
    try {
        return parseYamlFile(path);
    }
    catch (error) {
        if (error.code === "ENOENT") {
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
export function loadConfig(options = {}) {
    const dir = resolve(process.cwd(), options.dir ?? "config");
    const env = (options.env ?? process.env.ENV ?? "dev").toLowerCase();
    const common = readCommon(join(dir, "common.yml"));
    const envPath = join(dir, `app_${env}.yml`);
    let envConfig;
    try {
        envConfig = parseYamlFile(envPath);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`找不到环境配置：${envPath}（ENV=${env}）`);
        }
        throw error;
    }
    const merged = deepMerge(common, envConfig);
    const withEnv = applyEnv(merged, options.envVars ?? process.env, options.envPrefix ?? "APP_");
    assertRequired(withEnv, options.required ?? []);
    return withEnv;
}
