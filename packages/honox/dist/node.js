import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { applyEnv, assertRequired, createConfig, deepMerge } from "./config.js";
/** 只认这三种环境；写错的 ENV 会在启动时直接报错，而不是变成"找不到文件"。 */
export const SUPPORTED_ENVS = ["dev", "fat", "pro"];
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
 * 环境名取 `ENV`（照 rim.server：默认 DEV），只接受 dev / fat / pro。
 * 这是**唯一**读 `process.env.ENV` 的地方；业务侧一律用 `config.isPro()` 这类方法判断，
 * 不要再自己去看环境变量。
 *
 * 返回值是 viper 风格的取值器（`config.getInt("server.web_port")`），不是裸对象：
 * 点分路径的兼容、缺值报错、`APP_SERVER__WEB_PORT` 这类覆盖都收在这一层。
 */
export function loadConfig(options = {}) {
    const dir = resolve(process.cwd(), options.dir ?? "config");
    const env = String(options.env ?? process.env.ENV ?? "dev").toLowerCase();
    if (!SUPPORTED_ENVS.includes(env)) {
        throw new Error(`ENV 只支持 ${SUPPORTED_ENVS.join(" / ")}：${env}`);
    }
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
    return createConfig(withEnv, env);
}
