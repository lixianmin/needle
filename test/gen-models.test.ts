import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TMP = join(import.meta.dir, ".tmp-gen");
const GEN = join(ROOT, "scripts", "gen-models.ts");

function run(args: string[]) {
  const result = Bun.spawnSync(["bun", GEN, ...args], { cwd: ROOT });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function write(file: string, content: string): string {
  const path = join(TMP, file);
  writeFileSync(path, content);
  return path;
}

function reset(): void {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("gen-models", () => {
  test("标量 / 数组 / 可选 / 嵌套 / Date 都按类型生成", () => {
    reset();
    const file = write(
      "models.ts",
      `export class Boss {
  name: string = "";
  level: number = 0;
}

export class BotsBody {
  ids: number[] = [];
  note?: string;
  boss?: Boss;
  at?: Date;
}
`,
    );

    expect(run([file]).code).toBe(0);
    const out = readFileSync(join(TMP, "models.generated.ts"), "utf8");
    expect(out).toContain("ids: Type.Array(Type.Number())");
    expect(out).toContain("note: Type.Optional(Type.String())");
    expect(out).toContain("boss: Type.Optional(BossSchema)");
    expect(out).toContain('at: Type.Optional(Type.String({ format: "date-time" }))');
    // 依赖在前：Boss 的 const 必须在 BotsBody 之前（TDZ）
    expect(out.indexOf("export const BossSchema")).toBeLessThan(out.indexOf("export const BotsBodySchema"));
    expect(out).toContain('registerModel("BotsBody", BotsBodySchema);');
  });

  test("跨文件嵌套自动 import 对方的生成物", () => {
    reset();
    const models = write("models.ts", 'export class Boss {\n  name: string = "";\n}\n');
    const team = write("team.ts", 'import { Boss } from "./models.js";\n\nexport class Team {\n  lead: Boss = new Boss();\n}\n');

    expect(run([models, team]).code).toBe(0);
    const out = readFileSync(join(TMP, "team.generated.ts"), "utf8");
    expect(out).toContain('import { BossSchema } from "./models.generated.js"');
  });

  test("漂移断言：class 改了没重新生成，tsc 报错", () => {
    reset();
    const file = write("models.ts", 'export class BotsBody {\n  ids: number[] = [];\n}\n');
    writeFileSync(
      join(TMP, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["models.ts", "models.generated.ts"],
      }),
    );
    expect(run([file]).code).toBe(0);

    const tsc = (extra?: string) => {
      writeFileSync(file, `export class BotsBody {\n  ids: number[] = [];\n${extra ?? ""}}\n`);
      return Bun.spawnSync(["bunx", "tsc", "-p", join(TMP, "tsconfig.json")], { cwd: ROOT }).exitCode;
    };

    expect(tsc()).toBe(0);
    const stale = tsc('  extra: string = "";\n');
    expect(stale).toBe(1);
  });

  test("循环引用 / 方法 / 缺类型标注 / 未知类型 / 重名 都硬报错", () => {
    const cases = [
      { label: "循环引用", content: "export class Node {\n  name: string = \"\";\n  parent?: Node;\n}\n", pattern: /循环引用/ },
      { label: "方法", content: "export class A {\n  x: number = 0;\n  run(): void {}\n}\n", pattern: /只支持字段声明/ },
      { label: "缺类型标注", content: "export class A {\n  x = 0;\n}\n", pattern: /必须有类型标注/ },
      { label: "未知类型", content: "export class A {\n  x: Unknown = null;\n}\n", pattern: /未知类型 Unknown/ },
    ];
    for (const { label, content, pattern } of cases) {
      reset();
      const file = write("models.ts", content);
      const result = run([file]);
      expect(result.code, label).toBe(1);
      expect(result.stderr, label).toMatch(pattern);
    }

    reset();
    const a = write("a.ts", 'export class Same {\n  x: number = 0;\n}\n');
    const b = write("b.ts", 'export class Same {\n  y: number = 0;\n}\n');
    const dup = run([a, b]);
    expect(dup.code).toBe(1);
    expect(dup.stderr).toMatch(/模型重名：Same/);
  });
});
