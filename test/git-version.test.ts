import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 示例的版本号来自 git，不是一个手写的常量。
 *
 * 三条路径各一个用例：构建时注入（镜像里没有 git）、本地构建现跑 git、
 * 两者都没有时必须炸 / 退回 "unknown"。全是真跑进程，不打桩。
 */

const ROOT = join(import.meta.dir, "..");
const EXAMPLE = join(ROOT, "examples", "honox-app");
// 用当前 Bun 的绝对路径：下面有两个用例会把 PATH 清空，靠 PATH 找 bun 会先挂
const BUN = process.execPath;

function run(cwd: string, args: string[], env: Record<string, string>) {
  const result = Bun.spawnSync(args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** 仓库里的 git 版本口径，与产品口径共用一条命令。 */
function gitDescribe(): string {
  const result = Bun.spawnSync(["git", "describe", "--tags", "--always", "--dirty"], {
    cwd: ROOT,
    stdout: "pipe",
  });
  return result.stdout.toString().trim();
}

function tempOutfile(): string {
  return join(mkdtempSync(join(tmpdir(), "honox-version-")), "index.js");
}

describe("构建时把 git 版本烘焙进产物", () => {
  test("GIT_SHA 注入优先于本地 git", () => {
    const outfile = tempOutfile();
    const built = run(EXAMPLE, [BUN, "scripts/build.ts"], { GIT_SHA: "deadbee-injected", OUTFILE: outfile });
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(readFileSync(outfile, "utf8")).toContain("deadbee-injected");
  });

  test("没注入时用当前 HEAD", () => {
    const outfile = tempOutfile();
    const built = run(EXAMPLE, [BUN, "scripts/build.ts"], { GIT_SHA: "", OUTFILE: outfile });
    expect(built.exitCode).toBe(0);
    expect(readFileSync(outfile, "utf8")).toContain(gitDescribe());
  });

  test("既没注入也没有 git：构建失败，不产出 unknown 镜像", () => {
    const outfile = tempOutfile();
    const built = run(EXAMPLE, [BUN, "scripts/build.ts"], { GIT_SHA: "", OUTFILE: outfile, PATH: "/nonexistent" });
    expect(built.exitCode).not.toBe(0);
    expect(built.stderr).toContain("GIT_SHA");
  });
});

describe("dev 直跑（不打包）时现取 git 版本", () => {
  const probe = (env: Record<string, string>) =>
    run(EXAMPLE, [BUN, "-e", `import { APP_VERSION } from ${JSON.stringify(join(EXAMPLE, "app/version.ts"))}; console.log(APP_VERSION);`], env);

  test("拿得到 git 就显示 HEAD", () => {
    const result = probe({});
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(gitDescribe());
  });

  test("拿不到 git 才回 unknown", () => {
    const result = probe({ PATH: "/nonexistent" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("unknown");
  });
});
