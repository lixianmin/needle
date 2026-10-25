/**
 * 应用版本 = git 版本，不是手写的常量。
 *
 * 两条来源，按可信度排：
 * 1. 打包时烘焙：`bun run build` 跑 scripts/build.ts，把 `git describe --tags --always --dirty`
 *    的结果用 `--define` 写死进 dist。产物自描述，镜像里没有 `.git` 也不影响。
 * 2. dev 现跑：`bun --watch app/main.ts` 不经过打包，这里直接跑一次 git。
 *
 * 两个都没有（把 dist 搬到没装 git 的机器上又没走构建）才回 `unknown`——Shell 面板
 * 本来就认这个值，但不编造一个像版本号的假货。
 */
declare const __GIT_SHA__: string | undefined;

/**
 * 现跑 git 取版本。
 *
 * `--dirty` 让「构建/启动时带着未提交改动」这件事显式可见，否则镜像和源码对不上
 * 时没有任何线索。任何失败（没装 git、目录不是仓库）都退化成 undefined，由调用方
 * 决定下一步，不在这里抛。
 */
function fromGit(): string | undefined {
  try {
    const result = Bun.spawnSync(["git", "describe", "--tags", "--always", "--dirty"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "ignore",
    });
    const value = result.stdout.toString().trim();
    if (result.exitCode !== 0 || value === "") {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

export const APP_VERSION = typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : (fromGit() ?? "unknown");
