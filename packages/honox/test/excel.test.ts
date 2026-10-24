import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeXlsxObjects } from "hucre/xlsx";
import { defineSheet, loadSheets } from "@needle/honox/excel";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function fixture(sheetName: string, rows: Record<string, unknown>[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "honox-excel-"));
  dirs.push(dir);
  const file = join(dir, `${sheetName}.xlsx`);
  writeFileSync(file, await writeXlsxObjects(rows as never, { sheetName }));
  return file;
}

describe("defineSheet", () => {
  test("按 id 取单条与全表", async () => {
    const file = await fixture("PlanA", [
      { id: 1, name: "basic", quota: 10 },
      { id: 2, name: "pro", quota: 100 },
    ]);
    const sheet = defineSheet<{ id: number; name: string; quota: number }>({
      file,
      sheet: "PlanA",
    });
    await sheet.load();
    expect(sheet.get(2)).toEqual({ id: 2, name: "pro", quota: 100 });
    expect(sheet.get(99)).toBeUndefined();
    expect(sheet.all()).toHaveLength(2);
  });

  test("表头大写与空格归一成小写 trim", async () => {
    const file = await fixture("PlanB", [{ id: 1, Name: "x" }]);
    const sheet = defineSheet<Record<string, unknown>>({ file, sheet: "PlanB" });
    await sheet.load();
    expect(Object.keys(sheet.get(1) ?? {})).toContain("name");
  });

  test("空行跳过", async () => {
    const file = await fixture("PlanK", [{ id: 1, name: "a" }, {}, { id: 2, name: "b" }]);
    const sheet = defineSheet({ file, sheet: "PlanK" });
    await sheet.load();
    expect(sheet.all()).toHaveLength(2);
  });

  test("缺 id 的行抛错并带行号", async () => {
    const file = await fixture("PlanC", [{ id: 1, name: "a" }, { name: "no-id" }]);
    const sheet = defineSheet({ file, sheet: "PlanC" });
    await expect(sheet.load()).rejects.toThrow(/第 3 行/);
  });

  test("非数字 id 抛错", async () => {
    const file = await fixture("PlanD", [{ id: "a1", name: "x" }]);
    const sheet = defineSheet({ file, sheet: "PlanD" });
    await expect(sheet.load()).rejects.toThrow(/id/);
  });

  test("重复 id 抛错", async () => {
    const file = await fixture("PlanE", [
      { id: 1, name: "a" },
      { id: 1, name: "b" },
    ]);
    const sheet = defineSheet({ file, sheet: "PlanE" });
    await expect(sheet.load()).rejects.toThrow(/重复 id/);
  });

  test("未加载时 get / all 抛错", async () => {
    const file = await fixture("PlanF", [{ id: 1 }]);
    const sheet = defineSheet({ file, sheet: "PlanF" });
    expect(() => sheet.get(1)).toThrow(/loadSheets/);
    expect(() => sheet.all()).toThrow(/loadSheets/);
  });

  test("sheet 名默认取文件名", async () => {
    const file = await fixture("PlanG", [{ id: 1 }]);
    const sheet = defineSheet({ file });
    expect(sheet.name).toBe("PlanG");
    await sheet.load();
    expect(sheet.get(1)).toBeDefined();
  });

  test("注册不存在的 sheet 抛错", async () => {
    const file = await fixture("PlanH", [{ id: 1 }]);
    const sheet = defineSheet({ file, sheet: "NoSuchSheet" });
    await expect(sheet.load()).rejects.toThrow(/NoSuchSheet/);
  });

  test("文件缺失时 load 抛错带路径", async () => {
    const sheet = defineSheet({ file: join(tmpdir(), "honox-missing.xlsx"), sheet: "Missing" });
    await expect(sheet.load()).rejects.toThrow(/honox-missing\.xlsx/);
  });

  test("loadSheets 批量预载，任一失败就抛", async () => {
    const file = await fixture("PlanJ", [{ id: 7, name: "j" }]);
    const sheet = defineSheet({ file, sheet: "PlanJ" });
    await loadSheets([sheet]);
    expect(sheet.get(7)).toBeDefined();
    await loadSheets([sheet]);
    const bad = defineSheet({ file: join(tmpdir(), "honox-nope.xlsx"), sheet: "Nope" });
    await expect(loadSheets([sheet, bad])).rejects.toThrow(/honox-nope\.xlsx/);
  });

  test("同一文件的两个 sheet 都能读", async () => {
    const dir = mkdtempSync(join(tmpdir(), "honox-excel-"));
    dirs.push(dir);
    const file = join(dir, "multi.xlsx");
    writeFileSync(file, await writeXlsxObjects([{ id: 1, a: "x" }], { sheetName: "First" }));
    const first = defineSheet({ file, sheet: "First" });
    await first.load();
    expect(first.get(1)).toBeDefined();
  });
});
