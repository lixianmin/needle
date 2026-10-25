import { join, resolve } from "node:path";

/**
 * 打包示例，并把 git 版本烘焙进 dist。
 *
 * 版本只在这里进产物一次：`--define` 把 `__GIT_SHA__` 换成字符串字面量，运行时不读
 * 环境变量——镜像里的 `ENV` 谁都能改，dist 里的字节改不了。
 *
 * 镜像构建时代码是从宿主机 COPY 进去的，`.git` 被根 `.dockerignore` 排掉了，所以
 * Dockerfile 用 `--build-arg GIT_SHA=` 传进来；本地构建没有这个变量，现跑 git。
 * 两条路都拿不到就失败，不生成一个版本为 unknown 的产物。
 */

const APP_DIR = join(import.meta.dir, "..");

/** 与 app/version.ts 的 dev 回落同一条命令，两个来源的格式必须一致。 */
const GIT_DESCRIBE = ["git", "describe", "--tags", "--always", "--dirty"];

function readVersion(): string {
  const injected = process.env.GIT_SHA?.trim();
  if (injected) {
    return injected;
  }

  const hint = `镜像构建请传 --build-arg GIT_SHA=$(${GIT_DESCRIBE.join(" ")})`;
  let stdout: string;
  try {
    const result = Bun.spawnSync(GIT_DESCRIBE, { cwd: APP_DIR, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString().trim() || `exit ${result.exitCode}`);
    }

    stdout = result.stdout.toString();
  } catch (error) {
    throw new Error(`拿不到 git 版本（${GIT_DESCRIBE.join(" ")}）：${String(error)}。${hint}`);
  }

  const value = stdout.trim();
  if (value === "") {
    throw new Error(`git describe 返回空字符串。${hint}`);
  }

  return value;
}

const version = readVersion();
// OUTFILE 只给测试用：跑测试时不许覆盖开发用的 dist
const outfile = resolve(APP_DIR, process.env.OUTFILE?.trim() || "dist/index.js");

const built = Bun.spawnSync(
  [process.execPath, "build", "app/main.ts", "--target=bun", `--outfile=${outfile}`, "--define", `__GIT_SHA__=${JSON.stringify(version)}`],
  { cwd: APP_DIR, stdout: "inherit", stderr: "inherit" },
);
if (built.exitCode !== 0) {
  throw new Error(`bun build 失败，exit ${built.exitCode}`);
}
