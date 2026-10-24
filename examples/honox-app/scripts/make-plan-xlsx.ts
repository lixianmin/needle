import { writeFileSync } from "node:fs";
import { writeXlsxObjects } from "hucre/xlsx";

const rows = [
  { id: 1, name: "basic", quota: 10 },
  { id: 2, name: "pro", quota: 100 },
];

writeFileSync("res/metadata/Plan.xlsx", await writeXlsxObjects(rows, { sheetName: "Plan" }));
console.log("res/metadata/Plan.xlsx 已生成");
