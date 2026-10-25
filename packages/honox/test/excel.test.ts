import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeXlsx } from "hucre/xlsx";
import { createMetadata } from "../src/excel.js";

type Cell = string | number | null;

interface FakeSheet {
  name: string;
  rows: Cell[][];
}

interface FakeFile {
  file: string;
  sheets: FakeSheet[];
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 造一个元数据目录：每个 file 一个 xlsx，一个 xlsx 里可以有多张 sheet。 */
async function metadataDir(files: FakeFile[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "honox-md-"));
  dirs.push(dir);
  for (const entry of files) {
    const output = await writeXlsx({ sheets: entry.sheets });
    const target = join(dir, entry.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
  }

  return dir;
}

/** 单文件单表的简写。 */
async function oneFile(name: string, rows: Cell[][], file = `${name}.xlsx`): Promise<string> {
  return metadataDir([{ file, sheets: [{ name, rows }] }]);
}

describe("重复 load 读磁盘上的新内容", () => {
  // workbook 曾按绝对路径做进进程级缓存，只有 zip 解不开才失效：改完 Excel 再 load
  // 读到的还是旧内容，修好一个坏 id 再 load 也永远抛同一个错（spec 说「可重试」）。
  test("同一目录改完文件重新 load，取到的是新内容", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "name"],
      [1, "旧"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.template<{ id: number; name: string }>("BotTemplate").get(1)?.name).toBe("旧");

    const updated = await writeXlsx({
      sheets: [{ name: "BotTemplate", rows: [["id", "name"], [1, "新"]] }],
    });
    writeFileSync(join(dir, "BotTemplate.xlsx"), updated);
    await metadata.load(dir);

    expect(metadata.template<{ id: number; name: string }>("BotTemplate").get(1)?.name).toBe("新");
  });

  test("坏 id 修好后重试能成功", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "name"],
      ["abc", "x"],
    ]);
    const metadata = createMetadata();
    await expect(metadata.load(dir)).rejects.toThrow(/id 不是数字/);

    const fixed = await writeXlsx({
      sheets: [{ name: "BotTemplate", rows: [["id", "name"], [1, "ok"]] }],
    });
    writeFileSync(join(dir, "BotTemplate.xlsx"), fixed);
    await metadata.load(dir);

    expect(metadata.template<{ id: number; name: string }>("BotTemplate").get(1)?.name).toBe("ok");
  });
});

describe("Template：按 sheet 名 + id 两级取数", () => {
  test("按 id 取单条与全表", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "name", "prompt"],
      [1, "苏苏", "你是苏苏"],
      [2, "毛毛", "你是大头的"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);

    const bots = metadata.template<{ id: number; name: string; prompt: string }>("BotTemplate");
    expect(bots.get(2)).toEqual({ id: 2, name: "毛毛", prompt: "你是大头的" });
    expect(bots.get(99)).toBeUndefined();
    expect(bots.all()).toHaveLength(2);
  });

  test("表头大写与空格归一成小写 trim", async () => {
    const dir = await oneFile("BotTemplate", [
      [" Id ", " Name "],
      [1, "x"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(Object.keys(metadata.template("BotTemplate").get(1) ?? {})).toEqual(["id", "name"]);
  });

  test("空行跳过", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "name"],
      [1, "a"],
      [null, null],
      [2, "b"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.template("BotTemplate").all()).toHaveLength(2);
  });

  test("缺 id 的行抛错，带文件#sheet 与行号", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "name"],
      [1, "a"],
      [null, "no-id"],
    ]);
    const metadata = createMetadata();
    await expect(metadata.load(dir)).rejects.toThrow(/BotTemplate\.xlsx#BotTemplate 第 3 行 id 不是数字/);
  });

  test("非数字 id 抛错", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "name"],
      ["a1", "x"],
    ]);
    const metadata = createMetadata();
    await expect(metadata.load(dir)).rejects.toThrow(/第 2 行 id 不是数字/);
  });

  test("重复 id 抛错", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "name"],
      [1, "a"],
      [1, "b"],
    ]);
    const metadata = createMetadata();
    await expect(metadata.load(dir)).rejects.toThrow(/重复 id：1（第 3 行）/);
  });

  test("同一文件里两张 Template 都能读", async () => {
    const dir = await metadataDir([
      {
        file: "Templates.xlsx",
        sheets: [
          { name: "BotTemplate", rows: [["id", "name"], [1, "苏苏"]] },
          { name: "ApcTemplate", rows: [["id", "name"], [7, "哪里桃"]] },
        ],
      },
    ]);
    const metadata = createMetadata();
    const report = await metadata.load(dir);
    expect(report.templates).toEqual(["BotTemplate", "ApcTemplate"]);
    expect(metadata.template("BotTemplate").get(1)).toEqual({ id: 1, name: "苏苏" });
    expect(metadata.template("ApcTemplate").get(7)).toEqual({ id: 7, name: "哪里桃" });
  });
});

describe("类即 schema：数组字段自动拆列", () => {
  class ApcTemplate {
    id = 0;
    equips: string[] = [];
    name = "";
  }

  test("默认值写 [] 的字段按 | 拆成 string[]", async () => {
    const dir = await oneFile("ApcTemplate", [
      ["id", "equips", "name"],
      [1, "503048| 508012 |0", "哪里桃"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    const apc = metadata.template(ApcTemplate);
    expect(apc.get(1)).toEqual({
      id: 1,
      equips: ["503048", "508012", "0"],
      name: "哪里桃",
    });
    expect(apc.all()[0]?.equips).toEqual(["503048", "508012", "0"]);
  });

  test("不是数组的字段不拆（值里带 | 也原样）", async () => {
    const dir = await oneFile("ApcTemplate", [
      ["id", "equips", "name"],
      [1, "1|2", "a|b"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.template(ApcTemplate).get(1)).toEqual({
      id: 1,
      equips: ["1", "2"],
      name: "a|b",
    });
  });

  test("空单元格拆成空数组", async () => {
    const dir = await oneFile("ApcTemplate", [
      ["id", "equips"],
      [1, null],
      [2, ""],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    const apc = metadata.template(ApcTemplate);
    expect(apc.get(1)?.equips).toEqual([]);
    expect(apc.get(2)?.equips).toEqual([]);
  });

  test("static separators 逐列换分隔符", async () => {
    class BotTemplate {
      static separators = { tags: "," };
      id = 0;
      tags: string[] = [];
      prompt = "";
    }
    const dir = await oneFile("BotTemplate", [
      ["id", "tags", "prompt"],
      [1, "a,b, ctx", "x|y"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.template(BotTemplate).get(1)).toEqual({
      id: 1,
      tags: ["a", "b", "ctx"],
      prompt: "x|y",
    });
  });

  test("只传 sheet 名（不带 schema）时原样返回字符串", async () => {
    const dir = await oneFile("ApcTemplate", [
      ["id", "equips"],
      [1, "1|2"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.template("ApcTemplate").get(1)).toEqual({ id: 1, equips: "1|2" });
  });

  test("Config 类同样按 [] 拆", async () => {
    class SelectApcConfig {
      select_apc1: string[] = [];
      select_apc2: string[] = [];
    }
    const dir = await oneFile("SelectApcConfig", [
      ["select_apc1", "select_apc2"],
      ["10|11|26", "1|9"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.config(SelectApcConfig).get()).toEqual({
      select_apc1: ["10", "11", "26"],
      select_apc2: ["1", "9"],
    });
  });

  test("重新 load 后句柄的拆列视图跟着换", async () => {
    const first = await oneFile("ApcTemplate", [["id", "equips"], [1, "1|2"]]);
    const second = await oneFile("ApcTemplate", [["id", "equips"], [1, "9|8|7"]]);
    const metadata = createMetadata();
    const apc = metadata.template(ApcTemplate);
    await metadata.load(first);
    expect(apc.get(1)?.equips).toEqual(["1", "2"]);
    await metadata.load(second);
    expect(apc.get(1)?.equips).toEqual(["9", "8", "7"]);
  });
});

describe("Config：全局一份", () => {
  test("取第一个非空数据行", async () => {
    const dir = await oneFile("SelectApcConfig", [
      ["select_apc1", "select_apc2"],
      ["10|11", "1|9"],
      ["不许用第二行", "x"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.config("SelectApcConfig").get()).toEqual({
      select_apc1: "10|11",
      select_apc2: "1|9",
    });
  });

  test("跳过空行取第一条有内容的", async () => {
    const dir = await oneFile("GameConfig", [
      ["online_limit"],
      [null],
      [30],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(metadata.config("GameConfig").get()).toEqual({ online_limit: 30 });
  });

  test("没有数据行抛错", async () => {
    const dir = await oneFile("EmptyConfig", [["online_limit"]]);
    const metadata = createMetadata();
    await expect(metadata.load(dir)).rejects.toThrow(/EmptyConfig.*没有数据行/s);
  });
});

describe("目录扫描与后缀分派", () => {
  test("非 Template/Config 结尾的 sheet 跳过，并出现在 report.skipped", async () => {
    const dir = await metadataDir([
      {
        file: "Mixed.xlsx",
        sheets: [
          { name: "BotTemplate", rows: [["id", "name"], [1, "苏苏"]] },
          { name: "SelectApcConfig", rows: [["select_apc1"], ["10|11"]] },
          { name: "Readme", rows: [["note"], ["说明文字"]] },
        ],
      },
    ]);
    const metadata = createMetadata();
    const report = await metadata.load(dir);
    expect(report.templates).toEqual(["BotTemplate"]);
    expect(report.configs).toEqual(["SelectApcConfig"]);
    expect(report.skipped).toEqual(["Mixed.xlsx#Readme"]);
  });

  test("只扫目录本身，不看子目录里的表", async () => {
    const dir = await metadataDir([
      { file: "Top.xlsx", sheets: [{ name: "BotTemplate", rows: [["id"], [1]] }] },
      { file: "sub/Nested.xlsx", sheets: [{ name: "ApcTemplate", rows: [["id"], [7]] }] },
    ]);
    const metadata = createMetadata();
    const report = await metadata.load(dir);
    expect(report.templates).toEqual(["BotTemplate"]);
  });

  test("同名 sheet 出现在两个文件里直接报错", async () => {
    const dir = await metadataDir([
      { file: "A.xlsx", sheets: [{ name: "BotTemplate", rows: [["id"], [1]] }] },
      { file: "B.xlsx", sheets: [{ name: "BotTemplate", rows: [["id"], [2]] }] },
    ]);
    const metadata = createMetadata();
    await expect(metadata.load(dir)).rejects.toThrow(/sheet 名重复：BotTemplate/);
  });

  test("目录不存在抛错带路径", async () => {
    const missing = join(tmpdir(), "honox-md-does-not-exist");
    const metadata = createMetadata();
    await expect(metadata.load(missing)).rejects.toThrow(/元数据目录不存在或读不了/);
  });
});

describe("句柄", () => {
  test("未加载时取数据抛错", () => {
    const metadata = createMetadata();
    expect(() => metadata.template("BotTemplate").get(1)).toThrow(/尚未加载/);
    expect(() => metadata.template("BotTemplate").all()).toThrow(/尚未加载/);
    expect(() => metadata.config("SelectApcConfig").get()).toThrow(/尚未加载/);
  });

  test("名字写错时抛错，并列出已加载的 sheet", async () => {
    const dir = await oneFile("BotTemplate", [["id"], [1]]);
    const metadata = createMetadata();
    await metadata.load(dir);
    expect(() => metadata.template("BotTemplates").get(1)).toThrow(/没有 Template 表：BotTemplates.*BotTemplate/s);
    expect(() => metadata.config("SelectApcConfig").get()).toThrow(/没有 Config 表：SelectApcConfig/);
  });

  test("句柄可以比 load 先建（md 文件在导入期就定义）", async () => {
    const dir = await oneFile("BotTemplate", [["id", "name"], [1, "苏苏"]]);
    const metadata = createMetadata();
    const bots = metadata.template<{ id: number; name: string }>("BotTemplate");
    await metadata.load(dir);
    expect(bots.get(1)?.name).toBe("苏苏");
  });

  test("重复 load 整体替换，不残留上一份数据", async () => {
    const first = await oneFile("BotTemplate", [["id", "name"], [1, "旧"]]);
    const second = await metadataDir([
      { file: "Other.xlsx", sheets: [{ name: "ApcTemplate", rows: [["id"], [7]] }] },
    ]);
    const metadata = createMetadata();
    const bots = metadata.template("BotTemplate");
    await metadata.load(first);
    expect(bots.get(1)).toBeDefined();

    const report = await metadata.load(second);
    expect(report.templates).toEqual(["ApcTemplate"]);
    expect(() => bots.get(1)).toThrow(/没有 Template 表：BotTemplate/);
  });
});

describe("表头与行归一（变异测试压出来的）", () => {
  test("表头会 trim + 小写，数字表头转字符串，空表头列整列丢掉", async () => {
    const dir = await oneFile("BotTemplate", [
      [" ID ", "Name", "", 42],
      [1, "苏苏", "被丢掉", "x"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);

    expect(metadata.template("BotTemplate").get(1)).toEqual({ id: 1, name: "苏苏", "42": "x" });
  });

  test("缺列与短行的单元格补 null，不会变成 undefined", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "a", "b"],
      [1, "x"],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);

    const row = metadata.template<{ id: number; a: string; b: unknown }>("BotTemplate").get(1);
    expect(row).toStrictEqual({ id: 1, a: "x", b: null });
    expect("b" in (row as object)).toBe(true);
  });

  test("整行为空跳过；0 与 false 不算空", async () => {
    const dir = await oneFile("BotTemplate", [
      ["id", "flag", "note"],
      [null, null, null],
      [1, 0, ""],
    ]);
    const metadata = createMetadata();
    await metadata.load(dir);

    const table = metadata.template<{ id: number; flag: number; note: string }>("BotTemplate");
    expect(table.all()).toHaveLength(1);
    expect(table.get(1)).toStrictEqual({ id: 1, flag: 0, note: "" });
  });

  test("完全没有数据行的表：不报错，取不到东西", async () => {
    const dir = await oneFile("BotTemplate", [["id", "name"]]);
    const metadata = createMetadata();
    await metadata.load(dir);

    expect(metadata.template("BotTemplate").all()).toEqual([]);
    expect(metadata.template("BotTemplate").get(1)).toBeUndefined();
  });
});

describe("id 校验与报错文案", () => {
  test("id 缺列 / 非数字 / 重复，各给一条指得出来的错", async () => {
    const noColumn = await oneFile("BotTemplate", [["name"], ["x"]]);
    await expect(createMetadata().load(noColumn)).rejects.toThrow(
      /第 2 行 id 不是数字：.*缺列.*/,
    );

    const notNumber = await oneFile("BotTemplate", [["id"], ["abc"]]);
    await expect(createMetadata().load(notNumber)).rejects.toThrow(/id 不是数字：abc/);

    const duplicated = await oneFile("BotTemplate", [["id"], [1], [1]]);
    await expect(createMetadata().load(duplicated)).rejects.toThrow(/重复 id：1（第 3 行）/);
  });
});

describe("selector 与文案", () => {
  test("类名取不到时要显式传 sheet 名，否则报错指路", async () => {
    const anonymized = class {
      id = 0;
    };
    Object.defineProperty(anonymized, "name", { value: "" });

    const dir = await oneFile("BotTemplate", [["id"], [1]]);
    const metadata = createMetadata();
    await metadata.load(dir);

    expect(() => metadata.template(anonymized)).toThrow(/没有类名/);
    expect(metadata.template(anonymized, "BotTemplate").get(1)).toStrictEqual({ id: 1 });
  });

  test("找不到表时列出已加载的名字；一个都没有时写 (无)", async () => {
    const dir = await oneFile("BotTemplate", [["id"], [1]]);
    const metadata = createMetadata();
    await metadata.load(dir);

    expect(() => metadata.template("OtherTemplate").get(1)).toThrow(/已加载：BotTemplate/);

    const empty = await oneFile("OnlyTemplate", [["id"], [1]]);
    const other = createMetadata();
    await other.load(empty);
    expect(() => other.config("MissingConfig").get()).toThrow(/已加载：\(无\)/);
  });
});
